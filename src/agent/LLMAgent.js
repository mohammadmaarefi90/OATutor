import { cleanArray } from "../util/cleanObject.js";
import { AGENT_TYPES } from "./agentTypes.js";
import BaseAgent from "./BaseAgent.js";
import AgentPerformanceTracker from "./AgentPerformanceTracker.js";
import ReasoningGraph from "./ReasoningGraph.js";
import { AGENT_PERFORMANCE_STORAGE_KEY, AGENT_REASONING_STORAGE_KEY } from "./storageKeys.js";
import { DYNAMIC_HINT_URL } from "../config/config.js";
import { fetchDynamicHint } from "../components/problem-layout/DynamicHintHelper.js";
import {
    buildLLMAfterSnapshot,
    buildLLMStepSnapshot,
    getExpectedAnswerDisplay,
} from "./llm/llmStepTrace.js";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export default class LLMAgent extends BaseAgent {
    constructor(options) {
        super({ ...options, agentType: AGENT_TYPES.LLM });
        this.performance = new AgentPerformanceTracker(this.lesson.id, AGENT_TYPES.LLM);
        this.llmCalls = 0;
        this.llmSuccesses = 0;
        this.llmFallbacks = 0;
        this.llmAvailable = !!DYNAMIC_HINT_URL;
        this.reasoningGraph = new ReasoningGraph(this.lesson.id, AGENT_TYPES.LLM);
    }

    getReasoningGraph() {
        return this.reasoningGraph;
    }

    async saveReasoningGraph() {
        if (!this._persist) return;
        await this._persist.setByKey(
            AGENT_REASONING_STORAGE_KEY(this.lesson.id, AGENT_TYPES.LLM),
            this.reasoningGraph.toJSON()
        );
    }

    async loadPersistedState() {
        if (!this.browserStorage) return;
        const { getByKey, setByKey } = this.browserStorage;
        const perfData = await getByKey(
            AGENT_PERFORMANCE_STORAGE_KEY(this.lesson.id, AGENT_TYPES.LLM)
        ).catch(() => null);
        const reasoningData = await getByKey(
            AGENT_REASONING_STORAGE_KEY(this.lesson.id, AGENT_TYPES.LLM)
        ).catch(() => null);
        if (AgentPerformanceTracker.fromJSON(perfData))
            this.performance = AgentPerformanceTracker.fromJSON(perfData);
        if (ReasoningGraph.fromJSON(reasoningData))
            this.reasoningGraph = ReasoningGraph.fromJSON(reasoningData);
        this._persist = { getByKey, setByKey };
    }

    async savePersistedState() {
        if (!this._persist) return;
        await this._persist.setByKey(
            AGENT_PERFORMANCE_STORAGE_KEY(this.lesson.id, AGENT_TYPES.LLM),
            this.performance.toJSON()
        );
        await this._persist.setByKey(
            AGENT_REASONING_STORAGE_KEY(this.lesson.id, AGENT_TYPES.LLM),
            this.reasoningGraph.toJSON()
        );
    }

    getMemoryStats() {
        return { entryCount: this.llmSuccesses, avgStrength: 0, llmCalls: this.llmCalls };
    }

    getGraphStats() {
        return { nodeCount: 0, edgeCount: 0 };
    }

    getGrowthSummary() {
        return this.performance.getGrowthSummary();
    }

    createRun() {
        const run = this.performance.startRun();
        run.agentType = AGENT_TYPES.LLM;
        this.llmCalls = 0;
        this.llmSuccesses = 0;
        this.llmFallbacks = 0;
        return run;
    }

    finalizeRun(run, reason) {
        run.llmCalls = this.llmCalls;
        run.llmSuccesses = this.llmSuccesses;
        run.llmFallbacks = this.llmFallbacks;
        run.endedAt = Date.now();
        run.status = reason;
        run.durationMs = run.endedAt - run.startedAt;
        this.performance.finalizeRun(run, reason);
    }

    _buildPrompt(step, problem) {
        const template =
            "You are a math tutor agent. Solve the step and respond with ONLY the final answer " +
            "in LaTeX wrapped in $$...$$ with no explanation.\n\n" +
            "Problem title: {problem_title}\n" +
            "Problem body: {problem_body}\n" +
            "Step: {problem_step}\n" +
            "Step body: {problem_step_body}\n\n" +
            "Final answer:";

        return template
            .replace("{problem_title}", problem.title || "")
            .replace("{problem_body}", problem.body || "")
            .replace("{problem_step}", step.stepTitle || "")
            .replace("{problem_step_body}", step.stepBody || "");
    }

    _extractAnswerFromLLM(text) {
        if (!text) return null;
        const dollarMatch = text.match(/\$\$([^$]+)\$\$/);
        if (dollarMatch) return `$$${dollarMatch[1].trim()}$$`;
        const line = text.trim().split("\n").pop()?.trim();
        return line || null;
    }

    _queryLLM(step, problem) {
        if (!this.llmAvailable) return Promise.resolve(null);

        return new Promise((resolve) => {
            let resolved = false;
            let streamed = "";
            const timeout = setTimeout(() => {
                if (!resolved) {
                    resolved = true;
                    const answer = this._extractAnswerFromLLM(streamed);
                    resolve(
                        streamed
                            ? {
                                  parsedAttempt: answer,
                                  rawText: streamed,
                                  reasoning: null,
                                  content: streamed,
                                  provider: "cloud-gpt4",
                              }
                            : null
                    );
                }
            }, 15000);

            const prompt = this._buildPrompt(step, problem);
            this.llmCalls += 1;

            fetchDynamicHint(
                DYNAMIC_HINT_URL,
                { role: "user", message: prompt },
                (chunk) => {
                    streamed = chunk || streamed;
                },
                () => {
                    if (!resolved) {
                        resolved = true;
                        clearTimeout(timeout);
                        const answer = this._extractAnswerFromLLM(streamed);
                        if (answer) this.llmSuccesses += 1;
                        resolve(
                            streamed
                                ? {
                                      parsedAttempt: answer,
                                      rawText: streamed,
                                      reasoning: null,
                                      content: streamed,
                                      provider: "cloud-gpt4",
                                  }
                                : null
                        );
                    }
                },
                () => {
                    if (!resolved) {
                        resolved = true;
                        clearTimeout(timeout);
                        resolve(null);
                    }
                },
                problem.id,
                step.variabilization || {},
                {}
            ).catch(() => {
                if (!resolved) {
                    resolved = true;
                    clearTimeout(timeout);
                    resolve(null);
                }
            });
        });
    }

    async _solveStep(step, problem, seed, run) {
        const skills = cleanArray(step.knowledgeComponents || []);
        run.stepsTotal += 1;

        this._startStepReasoning(step, problem);
        this._emit("step-start", { stepId: step.id, problemId: problem.id, skills });

        let attempt = null;
        let firstTry = false;
        let source = "none";

        let llmBefore = null;
        let llmAfter = null;
        let finalAttemptAfter = null;
        let usedHints = false;

        if (this.llmAvailable) {
            this._recordReasoningAction("llm-query", "requesting GPT answer");
            const llmResult = await this._queryLLM(step, problem);
            attempt = llmResult?.parsedAttempt ?? null;
            const llmCorrectBefore = attempt ? this._checkStepAnswer(step, attempt, seed) : false;
            llmBefore = buildLLMStepSnapshot(llmResult, { correct: llmCorrectBefore });
            if (attempt) {
                firstTry = true;
                source = "llm";
                this._recordReasoningAction("llm-response", attempt.slice(0, 50));
                this._emit("llm-response", {
                    stepId: step.id,
                    attempt,
                    rawText: llmBefore?.rawText,
                });
            }
        } else {
            this._recordReasoningAction("llm-unavailable", "fallback to hints");
        }

        let isCorrect = attempt ? this._checkStepAnswer(step, attempt, seed) : false;
        finalAttemptAfter = attempt;

        if (!isCorrect && this._shouldAllowHints()) {
            firstTry = false;
            this.llmFallbacks += 1;
            usedHints = true;
            this._traceHintPathway(step);
            attempt = await this._learnFromHints(step, problem, seed, run);
            finalAttemptAfter = attempt;
            source = this.llmAvailable ? "llm-fallback-hints" : "hints-no-llm";
            this._recordReasoningAction("hint-fallback", source);
            if (attempt) isCorrect = this._checkStepAnswer(step, attempt, seed);
        } else if (!isCorrect && this._strictNoClues) {
            firstTry = false;
            source = "strict-no-clue";
        }

        llmAfter = buildLLMAfterSnapshot({
            attempt: finalAttemptAfter,
            correct: isCorrect,
            usedHints,
            source,
        });

        if (isCorrect) {
            if (firstTry) run.stepsCorrectFirstTry += 1;
            else run.stepsCorrectAfterLearning += 1;
            this._updateBKT(skills, true);
        } else {
            this._updateBKT(skills, false);
        }

        this._recordReasoningAnswer(attempt, isCorrect);
        this._emit("step-complete", {
            stepId: step.id,
            isCorrect,
            firstTry,
            attempt,
            source,
            llmBefore,
            llmAfter,
            expectedAnswer: getExpectedAnswerDisplay(step, seed),
        });
        await sleep(this.stepDelayMs);
        return isCorrect;
    }

    async _solveProblem(problem, run) {
        const seed = Date.now().toString();
        run.problemsAttempted += 1;

        this._emit("problem-start", {
            problemId: problem.id,
            title: problem.title,
            stepCount: problem.steps.length,
        });

        for (const step of problem.steps) {
            if (this.cancelled) return false;
            await this._solveStep(step, problem, seed, run);
        }

        run.problemsCompleted += 1;
        this.completedProbs.add(problem.id);
        this._emit("problem-complete", { problemId: problem.id });
        return true;
    }

    getAgentExtras() {
        return {
            strategy: "llm-with-hint-fallback",
            llmAvailable: this.llmAvailable,
            llmCalls: this.llmCalls,
            llmSuccesses: this.llmSuccesses,
            llmFallbacks: this.llmFallbacks,
            llmEndpoint: DYNAMIC_HINT_URL ? "configured" : "not-configured",
        };
    }
}
