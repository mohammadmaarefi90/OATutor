import { checkAnswer } from "../platform-logic/checkAnswer.js";
import { chooseVariables } from "../platform-logic/renderText.js";
import updateBKT from "../models/BKT/BKT-brain.js";
import { cleanArray } from "../util/cleanObject.js";
import { computeLessonMastery, selectNextProblem } from "./problemSelection.js";
import ReasoningSession, { mergeSessionIntoGraph } from "./ReasoningSession.js";
import { buildSolveTrace } from "./buildSolveTrace.js";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export default class BaseAgent {
    constructor({
        agentType,
        lesson,
        problems,
        bktParams,
        heuristic,
        hintPathway = "DefaultPathway",
        browserStorage = null,
        onEvent = () => {},
        onMasteryUpdate = () => {},
        stepDelayMs = 250,
    }) {
        this.agentType = agentType;
        this.lesson = lesson;
        this.problems = problems;
        this.bktParams = bktParams;
        this.heuristic = heuristic;
        this.hintPathway = hintPathway;
        this.browserStorage = browserStorage;
        this.onEvent = onEvent;
        this.onMasteryUpdate = onMasteryUpdate;
        this.stepDelayMs = stepDelayMs;
        this.cancelled = false;
        this.completedProbs = new Set();
        this._currentRun = null;
        this.reasoningSession = null;
    }

    cancel() {
        this.cancelled = true;
    }

    _emit(type, payload) {
        const event = { agentType: this.agentType, type, timestamp: Date.now(), ...payload };
        this.onEvent(event);
        if (this._currentRun) {
            this._currentRun.events.push(event);
        }
        return event;
    }

    _lessonMastery() {
        return computeLessonMastery(this.lesson, this.bktParams, this.problems);
    }

    _updateBKT(kcArray, isCorrect) {
        const skills = cleanArray(kcArray || []);
        for (const kc of skills) {
            if (this.bktParams[kc]) {
                updateBKT(this.bktParams[kc], isCorrect);
            }
        }
        const mastery = this._lessonMastery();
        this.onMasteryUpdate(mastery);
        return mastery;
    }

    _resolveHintPathway(step) {
        const hints = step.hints || {};
        return hints[this.hintPathway] || hints[Object.keys(hints)[0]] || [];
    }

    _getAnswerFromHints(pathway) {
        for (let i = pathway.length - 1; i >= 0; i--) {
            const hint = pathway[i];
            if (hint.hintAnswer?.length > 0) {
                return { answer: hint.hintAnswer[0], hint, hintIndex: i };
            }
            if (hint.subHints) {
                for (const sub of hint.subHints) {
                    if (sub.hintAnswer?.length > 0) {
                        return { answer: sub.hintAnswer[0], hint: sub, hintIndex: i };
                    }
                }
            }
        }
        return null;
    }

    _checkStepAnswer(step, attempt, seed) {
        const variabilization = chooseVariables(step.variabilization || {}, seed);
        const [, correctAnswer] = checkAnswer({
            attempt,
            actual: step.stepAnswer,
            answerType: step.answerType,
            precision: step.precision,
            variabilization,
            questionText: step.stepTitle || step.stepBody || "",
            choices: step.choices,
            answerValidator: step.answerValidator,
        });
        return !!correctAnswer;
    }

    async _learnFromHints(step, problem, seed, run) {
        const pathway = this._resolveHintPathway(step);
        run.hintsConsumed += pathway.length;
        for (const hint of pathway) {
            await sleep(this.stepDelayMs / 3);
            if (this.cancelled) return null;
        }
        const learned = this._getAnswerFromHints(pathway);
        return learned?.answer || step.stepAnswer?.[0] || null;
    }

    _startStepReasoning(step, problem) {
        if (this.reasoningSession) {
            this.reasoningSession.startStep(step);
        }
    }

    _recordReasoningAction(action, detail = "") {
        if (this.reasoningSession) {
            this.reasoningSession.recordAction(action, detail);
        }
    }

    _recordReasoningAnswer(attempt, isCorrect) {
        if (this.reasoningSession) {
            this.reasoningSession.recordAnswer(attempt, isCorrect);
        }
    }

    _traceHintPathway(step) {
        if (!this.reasoningSession) return;
        const pathway = this._resolveHintPathway(step);
        pathway.forEach((hint, i) => {
            this.reasoningSession.visitHint(hint, step.id, i);
        });
    }

    async evaluateProblem(problem, { persistLearning = true } = {}) {
        await this.loadPersistedState?.();

        this.reasoningSession = new ReasoningSession(problem, this.agentType);
        const run = this.createRun();
        run.events = [];
        this._currentRun = run;

        this._emit("eval-start", { problemId: problem.id, title: problem.title });

        await this._solveProblem(problem, run);

        const sessionReasoning = this.reasoningSession.toDAG();
        let reasoningDAG = sessionReasoning;

        if (persistLearning && this.getReasoningGraph) {
            mergeSessionIntoGraph(this.getReasoningGraph(), this.reasoningSession);
            reasoningDAG = this.getReasoningGraph().exportDAG();
            await this.saveReasoningGraph?.();
        }

        const stepsCorrect = run.stepsCorrectFirstTry + run.stepsCorrectAfterLearning;
        const solveTrace = buildSolveTrace(problem, run, sessionReasoning);
        const result = {
            agentType: this.agentType,
            problemId: problem.id,
            problemTitle: problem.title,
            run,
            correct: stepsCorrect === run.stepsTotal && run.stepsTotal > 0,
            stepsCorrect,
            stepsTotal: run.stepsTotal,
            firstTryRate: run.stepsTotal > 0 ? run.stepsCorrectFirstTry / run.stepsTotal : 0,
            sessionReasoning,
            reasoningDAG,
            solveTrace,
        };

        this._emit("eval-complete", result);
        this.reasoningSession = null;
        this._currentRun = null;
        return result;
    }

    async runTrainingOnProblemIds(problemIds) {
        await this.loadPersistedState?.();

        const run = this.createRun();
        run.events = [];
        run.trainingMode = "fixed-problem-set";
        run.problemIds = problemIds;
        this._currentRun = run;
        run.masteryStart = this._lessonMastery();
        run.memoryStart = this.getMemoryStats?.() || {};
        run.graphStart = this.getGraphStats?.() || {};

        this._emit("run-start", {
            runId: run.runId,
            masteryStart: run.masteryStart,
            trainingMode: run.trainingMode,
            problemCount: problemIds.length,
        });

        for (const problemId of problemIds) {
            if (this.cancelled) break;
            const problem = this.problems.find((p) => p.id === problemId);
            if (!problem) continue;

            this.reasoningSession = new ReasoningSession(problem, this.agentType);
            await this._solveProblem(problem, run);
            if (this.getReasoningGraph && this.reasoningSession) {
                mergeSessionIntoGraph(this.getReasoningGraph(), this.reasoningSession);
                await this.saveReasoningGraph?.();
            }
            this.reasoningSession = null;

            run.masteryEnd = this._lessonMastery();
            run.memoryEnd = this.getMemoryStats?.() || {};
            run.graphEnd = this.getGraphStats?.() || {};
        }

        run.masteryEnd = this._lessonMastery();
        run.memoryEnd = this.getMemoryStats?.() || {};
        run.graphEnd = this.getGraphStats?.() || {};

        const reason = this.cancelled ? "cancelled" : "completed";
        this.finalizeRun?.(run, reason);
        await this.savePersistedState?.();

        const output = this.buildOutput(run);
        this._emit("run-complete", output);
        this._currentRun = null;
        return output;
    }

    async runTrainingSession({ maxProblems = 50 } = {}) {
        await this.loadPersistedState?.();

        const run = this.createRun();
        run.events = [];
        this._currentRun = run;
        run.masteryStart = this._lessonMastery();
        run.memoryStart = this.getMemoryStats?.() || {};
        run.graphStart = this.getGraphStats?.() || {};

        this._emit("run-start", {
            runId: run.runId,
            masteryStart: run.masteryStart,
            memoryStart: run.memoryStart,
            graphStart: run.graphStart,
        });

        let problemsSolved = 0;

        while (!this.cancelled && problemsSolved < maxProblems) {
            const { problem, status } = selectNextProblem(
                this.problems,
                this.lesson,
                this.bktParams,
                this.completedProbs,
                this.heuristic
            );

            if (status === "graduated") {
                this._emit("graduated", {
                    mastery: this._lessonMastery(),
                });
                break;
            }

            if (!problem) {
                this._emit("exhausted", { status });
                break;
            }

            this.reasoningSession = new ReasoningSession(problem, this.agentType);
            await this._solveProblem(problem, run);
            if (this.getReasoningGraph && this.reasoningSession) {
                mergeSessionIntoGraph(this.getReasoningGraph(), this.reasoningSession);
                await this.saveReasoningGraph?.();
            }
            this.reasoningSession = null;
            problemsSolved += 1;

            run.masteryEnd = this._lessonMastery();
            run.memoryEnd = this.getMemoryStats?.() || {};
            run.graphEnd = this.getGraphStats?.() || {};
        }

        run.masteryEnd = this._lessonMastery();
        run.memoryEnd = this.getMemoryStats?.() || {};
        run.graphEnd = this.getGraphStats?.() || {};

        const reason = this.cancelled ? "cancelled" : "completed";
        this.finalizeRun?.(run, reason);
        await this.savePersistedState?.();

        const output = this.buildOutput(run);
        this._emit("run-complete", output);
        this._currentRun = null;
        return output;
    }

    createRun() {
        return {
            runId: `run-${this.agentType}-${Date.now()}`,
            agentType: this.agentType,
            startedAt: Date.now(),
            events: [],
            problemsAttempted: 0,
            problemsCompleted: 0,
            stepsTotal: 0,
            stepsCorrectFirstTry: 0,
            stepsCorrectAfterLearning: 0,
            hintsConsumed: 0,
        };
    }

    buildOutput(run) {
        return {
            agentType: this.agentType,
            run,
            memoryStats: this.getMemoryStats?.() || { entryCount: 0, avgStrength: 0 },
            graphStats: this.getGraphStats?.() || { nodeCount: 0, edgeCount: 0 },
            memory: this.getMemorySnapshot?.() || {},
            graph: this.getGraphSnapshot?.() || {},
            growth: this.getGrowthSummary?.() || null,
            bktSnapshot: Object.fromEntries(
                Object.entries(this.bktParams)
                    .filter(([k]) => k in (this.lesson.learningObjectives || {}))
                    .map(([k, v]) => [k, v.probMastery])
            ),
            agentExtras: this.getAgentExtras?.() || {},
        };
    }
}
