import { cleanArray } from "../util/cleanObject.js";
import { AGENT_TYPES } from "./agentTypes.js";
import BaseAgent from "./BaseAgent.js";
import AgentPerformanceTracker from "./AgentPerformanceTracker.js";
import ReasoningGraph from "./ReasoningGraph.js";
import LLMBeliefStore from "./llm/LLMBeliefStore.js";
import { completeChat } from "./llm/llmClient.js";
import { getLLMSettingsSync, LLM_PROVIDER } from "./llm/llmSettings.js";
import {
    getSkillHintsForPrompt,
    formatSkillHintsForPrompt,
    resolveSkillHintMode,
    resolveSkillBktBackend,
} from "./llm/beliefRetrieval.js";
import PyBKTRoster from "./llm/pyBKTRoster.js";
import { SKILL_BKT_BACKEND } from "./llm/llmSettings.js";
import {
    AGENT_PERFORMANCE_STORAGE_KEY,
    AGENT_REASONING_STORAGE_KEY,
    AGENT_BELIEFS_STORAGE_KEY,
    AGENT_PYBKT_ROSTER_STORAGE_KEY,
} from "./storageKeys.js";
import {
    buildLLMAfterSnapshot,
    buildLLMStepSnapshot,
    getExpectedAnswerDisplay,
} from "./llm/llmStepTrace.js";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export default class LocalReasoningLLMAgent extends BaseAgent {
    constructor(options) {
        super({ ...options, agentType: AGENT_TYPES.LOCAL_LLM });
        this.performance = new AgentPerformanceTracker(this.lesson.id, AGENT_TYPES.LOCAL_LLM);
        this.reasoningGraph = new ReasoningGraph(this.lesson.id, AGENT_TYPES.LOCAL_LLM);
        this.beliefStore = new LLMBeliefStore(this.lesson.id);
        this.llmCalls = 0;
        this.llmSuccesses = 0;
        this.llmFallbacks = 0;
        this.beliefsLearned = 0;
        this._evaluationMode = false;
        this._currentHintRetrieval = null;
        this.pyBktRoster = null;
        this._pyBktSessionReady = false;
        this.llmSettings = options.llmSettings || getLLMSettingsSync();
    }

    _usesPyBktBackend() {
        return resolveSkillBktBackend(this.llmSettings || getLLMSettingsSync()) === SKILL_BKT_BACKEND.PYBKT;
    }

    async _ensurePyBktRoster() {
        if (!this._usesPyBktBackend()) return;
        if (!this.pyBktRoster) {
            this.pyBktRoster = new PyBKTRoster(this.lesson.id, this.lesson, this.bktParams);
        }
        if (!this._pyBktSessionReady) {
            this.llmSettings = getLLMSettingsSync();
            await this.pyBktRoster.ensureSession(this.llmSettings);
            this._pyBktSessionReady = true;
        }
    }

    _lessonMastery() {
        if (this._usesPyBktBackend() && this.pyBktRoster) {
            return this.pyBktRoster.getLessonMastery();
        }
        return super._lessonMastery();
    }

    async _applyBktUpdate(skills, isCorrect) {
        if (this._usesPyBktBackend()) {
            await this._ensurePyBktRoster();
            const mastery = await this.pyBktRoster.update(
                skills,
                isCorrect,
                this.llmSettings || getLLMSettingsSync()
            );
            this.onMasteryUpdate(mastery);
            return mastery;
        }
        return super._updateBKT(skills, isCorrect);
    }

    getReasoningGraph() {
        return this.reasoningGraph;
    }

    async saveReasoningGraph() {
        if (!this._persist) return;
        await this._persist.setByKey(
            AGENT_REASONING_STORAGE_KEY(this.lesson.id, AGENT_TYPES.LOCAL_LLM),
            this.reasoningGraph.toJSON()
        );
    }

    async loadPersistedState() {
        if (!this.browserStorage) return;
        const { getByKey, setByKey } = this.browserStorage;
        const type = AGENT_TYPES.LOCAL_LLM;
        const [perfData, reasoningData, beliefData, pyBktData] = await Promise.all([
            getByKey(AGENT_PERFORMANCE_STORAGE_KEY(this.lesson.id, type)).catch(() => null),
            getByKey(AGENT_REASONING_STORAGE_KEY(this.lesson.id, type)).catch(() => null),
            getByKey(AGENT_BELIEFS_STORAGE_KEY(this.lesson.id, type)).catch(() => null),
            getByKey(AGENT_PYBKT_ROSTER_STORAGE_KEY(this.lesson.id, type)).catch(() => null),
        ]);
        if (AgentPerformanceTracker.fromJSON(perfData))
            this.performance = AgentPerformanceTracker.fromJSON(perfData);
        if (ReasoningGraph.fromJSON(reasoningData))
            this.reasoningGraph = ReasoningGraph.fromJSON(reasoningData);
        if (LLMBeliefStore.fromJSON(beliefData)) this.beliefStore = LLMBeliefStore.fromJSON(beliefData);
        const roster = PyBKTRoster.fromJSON(pyBktData, this.lesson, this.bktParams);
        if (roster) {
            this.pyBktRoster = roster;
            this._pyBktSessionReady = false;
        }
        this._persist = { getByKey, setByKey };
    }

    async savePersistedState() {
        if (!this._persist || this._evaluationMode) return;
        const type = AGENT_TYPES.LOCAL_LLM;
        const saves = [
            this._persist.setByKey(
                AGENT_PERFORMANCE_STORAGE_KEY(this.lesson.id, type),
                this.performance.toJSON()
            ),
            this._persist.setByKey(
                AGENT_REASONING_STORAGE_KEY(this.lesson.id, type),
                this.reasoningGraph.toJSON()
            ),
            this._persist.setByKey(
                AGENT_BELIEFS_STORAGE_KEY(this.lesson.id, type),
                this.beliefStore.toJSON()
            ),
        ];
        if (this.pyBktRoster) {
            saves.push(
                this._persist.setByKey(
                    AGENT_PYBKT_ROSTER_STORAGE_KEY(this.lesson.id, type),
                    this.pyBktRoster.toJSON()
                )
            );
        }
        await Promise.all(saves);
    }

    getMemoryStats() {
        const stats = this.beliefStore.getStats();
        return {
            entryCount: stats.totalBeliefs,
            avgStrength: 0,
            llmCalls: this.llmCalls,
            beliefsLearned: this.beliefsLearned,
        };
    }

    getGraphStats() {
        const nodes = Object.keys(this.reasoningGraph.nodes || {}).length;
        const edges = Object.keys(this.reasoningGraph.transitionCounts || {}).length;
        return { nodeCount: nodes, edgeCount: edges };
    }

    getGrowthSummary() {
        return this.performance.getGrowthSummary();
    }

    createRun() {
        const run = this.performance.startRun();
        run.agentType = AGENT_TYPES.LOCAL_LLM;
        this.llmCalls = 0;
        this.llmSuccesses = 0;
        this.llmFallbacks = 0;
        this.beliefsLearned = 0;
        return run;
    }

    finalizeRun(run, reason) {
        run.llmCalls = this.llmCalls;
        run.llmSuccesses = this.llmSuccesses;
        run.llmFallbacks = this.llmFallbacks;
        run.beliefsLearned = this.beliefsLearned;
        run.beliefStats = this.beliefStore.getStats();
        run.skillHintRetrieval = resolveSkillHintMode(this.llmSettings || getLLMSettingsSync());
        run.skillBktBackend = resolveSkillBktBackend(this.llmSettings || getLLMSettingsSync());
        run.pyBktStats = this.pyBktRoster?.getStats() || null;
        run.endedAt = Date.now();
        run.status = reason;
        run.durationMs = run.endedAt - run.startedAt;
        this.performance.finalizeRun(run, reason);
    }

    _buildMessages(step, problem, { includeBeliefs = true } = {}) {
        const settings = this.llmSettings || getLLMSettingsSync();
        const maxBeliefs = settings.maxBeliefsInPrompt || 12;
        const skills = cleanArray(step.knowledgeComponents || []);
        const hintMode = resolveSkillHintMode(settings);
        const retrieval = includeBeliefs
            ? getSkillHintsForPrompt(this.beliefStore, skills, maxBeliefs, hintMode)
            : { hints: [], mode: hintMode, modeLabel: hintMode };

        this._currentHintRetrieval = retrieval;

        const beliefBlock = formatSkillHintsForPrompt(retrieval.hints);

        const systemContent =
            "You are a math tutoring agent. Use the learned hints below when relevant. " +
            "Respond with ONLY the final answer in LaTeX wrapped in $$...$$ with no explanation.";

        const userContent =
            `Learned hints from training (skills: ${skills.join(", ") || "general"}, retrieval: ${retrieval.modeLabel}):\n` +
            `${beliefBlock}\n\n` +
            `Problem title: ${problem.title || ""}\n` +
            `Problem body: ${problem.body || ""}\n` +
            `Step: ${step.stepTitle || ""}\n` +
            `Step body: ${step.stepBody || ""}\n\n` +
            "Final answer:";

        return [
            { role: "system", content: systemContent },
            { role: "user", content: userContent },
        ];
    }

    async _queryLLM(step, problem, { includeBeliefs = true } = {}) {
        this.llmCalls += 1;
        this.llmSettings = getLLMSettingsSync();
        const settings = this.llmSettings;

        try {
            const result = await completeChat(this._buildMessages(step, problem, { includeBeliefs }), {
                settings,
            });
            let parsedAttempt = result.answer || null;
            if (!parsedAttempt && result.rawText) {
                parsedAttempt = result.rawText.trim().split("\n").pop()?.trim() || null;
            }
            if (parsedAttempt) this.llmSuccesses += 1;
            return {
                parsedAttempt,
                answer: parsedAttempt,
                content: result.content,
                rawText: result.rawText,
                reasoning: result.reasoning,
                provider: result.provider || "local-gpt-oss",
            };
        } catch (err) {
            this._recordReasoningAction("llm-error", err.message?.slice(0, 80) || "error");
            this._emit("llm-error", { stepId: step.id, message: err.message });
            return {
                parsedAttempt: null,
                error: err.message,
                provider: "local-gpt-oss",
            };
        }
    }

    _learnBeliefsFromHints(step, problem) {
        if (this._evaluationMode) return 0;
        const pathway = this._resolveHintPathway(step);
        const skills = cleanArray(step.knowledgeComponents || []);
        const added = this.beliefStore.ingestHintPathway(pathway, step, problem.id, skills);
        this.beliefsLearned += added;
        return added;
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
        let usedHints = false;
        let finalAttemptAfter = null;

        const useBeliefs = true;
        this._recordReasoningAction(
            "llm-query",
            this._evaluationMode ? "local LLM + training beliefs" : "local reasoning LLM"
        );
        const llmResult = await this._queryLLM(step, problem, { includeBeliefs: useBeliefs });
        if (this._currentHintRetrieval) {
            this._emit("hint-retrieval", {
                stepId: step.id,
                agentType: AGENT_TYPES.LOCAL_LLM,
                hintRetrievalMode: this._currentHintRetrieval.mode,
                hintRetrievalLabel: this._currentHintRetrieval.modeLabel,
                hintCount: this._currentHintRetrieval.hints?.length || 0,
            });
        }
        attempt = llmResult?.parsedAttempt ?? null;
        const llmCorrectBefore = attempt ? this._checkStepAnswer(step, attempt, seed) : false;
        llmBefore = buildLLMStepSnapshot(llmResult, { correct: llmCorrectBefore });

        if (attempt) {
            firstTry = true;
            source = "local-llm";
            this._recordReasoningAction("llm-response", attempt.slice(0, 50));
            this._emit("llm-response", {
                stepId: step.id,
                attempt,
                rawText: llmBefore?.rawText,
                reasoning: llmBefore?.reasoning,
                content: llmBefore?.content,
                provider: "local-gpt-oss",
            });
        }

        let isCorrect = attempt ? this._checkStepAnswer(step, attempt, seed) : false;
        finalAttemptAfter = attempt;

        if (!isCorrect && this._shouldAllowHints()) {
            firstTry = false;
            this.llmFallbacks += 1;
            usedHints = true;
            this._traceHintPathway(step);

            if (!this._evaluationMode) {
                this._learnBeliefsFromHints(step, problem);
            }

            attempt = await this._learnFromHints(step, problem, seed, run);
            finalAttemptAfter = attempt;
            source = this._evaluationMode ? "test-hint-fallback" : "train-hint-fallback";
            this._recordReasoningAction("hint-fallback", source);
            if (attempt) isCorrect = this._checkStepAnswer(step, attempt, seed);

            if (!this._evaluationMode && isCorrect) {
                this._learnBeliefsFromHints(step, problem);
            }
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
            await this._applyBktUpdate(skills, true);
        } else {
            await this._applyBktUpdate(skills, false);
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
            hintRetrievalMode: this._currentHintRetrieval?.mode,
            hintRetrievalLabel: this._currentHintRetrieval?.modeLabel,
            skillBktBackend: resolveSkillBktBackend(this.llmSettings || getLLMSettingsSync()),
            pyBktMastery: this.pyBktRoster?.getLessonMastery(),
            strictNoClues: this._strictNoClues,
        });
        this._currentHintRetrieval = null;
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

    async evaluateProblem(problem, options = {}) {
        const persistLearning = options.persistLearning !== false;
        await this.loadPersistedState?.();
        const rosterSnapshot = this.pyBktRoster?.toJSON() || null;
        this._evaluationMode = !persistLearning;
        this._pyBktSessionReady = false;
        try {
            return await super.evaluateProblem(problem, options);
        } finally {
            if (!persistLearning && rosterSnapshot && this.pyBktRoster) {
                this.pyBktRoster = PyBKTRoster.fromJSON(
                    rosterSnapshot,
                    this.lesson,
                    this.bktParams
                );
            }
            this._evaluationMode = false;
            this._pyBktSessionReady = false;
        }
    }

    getAgentExtras() {
        const settings = this.llmSettings || getLLMSettingsSync();
        return {
            strategy: "local-reasoning-llm-with-belief-bkt",
            provider: settings.provider,
            localBaseUrl: settings.localBaseUrl,
            localModel: settings.localModel,
            reasoningEffort: settings.reasoningEffort,
            llmCalls: this.llmCalls,
            llmSuccesses: this.llmSuccesses,
            llmFallbacks: this.llmFallbacks,
            beliefStats: this.beliefStore.getStats(),
            isLocalGptOss: settings.provider === LLM_PROVIDER.LOCAL_GPT_OSS,
            skillHintRetrieval: resolveSkillHintMode(settings),
            skillBktBackend: resolveSkillBktBackend(settings),
            pyBktStats: this.pyBktRoster?.getStats() || null,
        };
    }
}
