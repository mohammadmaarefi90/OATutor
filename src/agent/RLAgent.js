import { cleanArray } from "../util/cleanObject.js";
import { AGENT_TYPES } from "./agentTypes.js";
import BaseAgent from "./BaseAgent.js";
import AgentPerformanceTracker from "./AgentPerformanceTracker.js";
import ReasoningGraph from "./ReasoningGraph.js";
import {
    AGENT_RL_QTABLE_STORAGE_KEY,
    AGENT_PERFORMANCE_STORAGE_KEY,
    AGENT_REASONING_STORAGE_KEY,
} from "./storageKeys.js";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const ACTIONS = {
    RECALL: "recall",
    USE_HINT: "use_hint",
    SUBMIT_BEST: "submit_best",
};

export default class RLAgent extends BaseAgent {
    constructor(options) {
        super({ ...options, agentType: AGENT_TYPES.RL });
        this.qTable = {};
        this.epsilon = 0.2;
        this.alpha = 0.3;
        this.gamma = 0.85;
        this.totalReward = 0;
        this.experienceBuffer = [];
        this.stepMemory = {};
        this.reasoningGraph = new ReasoningGraph(this.lesson.id, AGENT_TYPES.RL);
        this.performance = new AgentPerformanceTracker(this.lesson.id, AGENT_TYPES.RL);
    }

    getReasoningGraph() {
        return this.reasoningGraph;
    }

    async saveReasoningGraph() {
        if (!this._persist) return;
        await this._persist.setByKey(
            AGENT_REASONING_STORAGE_KEY(this.lesson.id, AGENT_TYPES.RL),
            this.reasoningGraph.toJSON()
        );
    }

    async loadPersistedState() {
        if (!this.browserStorage) return;
        const { getByKey, setByKey } = this.browserStorage;
        const [qData, perfData, reasoningData] = await Promise.all([
            getByKey(AGENT_RL_QTABLE_STORAGE_KEY(this.lesson.id)).catch(() => null),
            getByKey(AGENT_PERFORMANCE_STORAGE_KEY(this.lesson.id, AGENT_TYPES.RL)).catch(
                () => null
            ),
            getByKey(AGENT_REASONING_STORAGE_KEY(this.lesson.id, AGENT_TYPES.RL)).catch(
                () => null
            ),
        ]);
        if (qData?.qTable) this.qTable = qData.qTable;
        if (AgentPerformanceTracker.fromJSON(perfData))
            this.performance = AgentPerformanceTracker.fromJSON(perfData);
        if (ReasoningGraph.fromJSON(reasoningData))
            this.reasoningGraph = ReasoningGraph.fromJSON(reasoningData);
        this._persist = { getByKey, setByKey };
    }

    async savePersistedState() {
        if (!this._persist) return;
        const { setByKey } = this._persist;
        await Promise.all([
            setByKey(AGENT_RL_QTABLE_STORAGE_KEY(this.lesson.id), {
                qTable: this.qTable,
                updatedAt: Date.now(),
            }),
            setByKey(
                AGENT_PERFORMANCE_STORAGE_KEY(this.lesson.id, AGENT_TYPES.RL),
                this.performance.toJSON()
            ),
            setByKey(
                AGENT_REASONING_STORAGE_KEY(this.lesson.id, AGENT_TYPES.RL),
                this.reasoningGraph.toJSON()
            ),
        ]);
    }

    getMemoryStats() {
        return {
            entryCount: Object.keys(this.stepMemory).length,
            avgStrength: 0,
            qTableSize: Object.keys(this.qTable).length,
        };
    }

    getGraphStats() {
        return { nodeCount: 0, edgeCount: 0, qTableEntries: Object.keys(this.qTable).length };
    }

    getGrowthSummary() {
        return this.performance.getGrowthSummary();
    }

    createRun() {
        const run = this.performance.startRun();
        run.agentType = AGENT_TYPES.RL;
        this.totalReward = 0;
        return run;
    }

    finalizeRun(run, reason) {
        run.totalReward = this.totalReward;
        run.endedAt = Date.now();
        run.status = reason;
        run.durationMs = run.endedAt - run.startedAt;
        this.performance.finalizeRun(run, reason);
    }

    _stateKey(step) {
        const mastery = this._lessonMastery();
        const mBucket = Math.min(9, Math.floor(mastery * 10));
        const typeKey = step.answerType || step.problemType || "unknown";
        return `${mBucket}|${typeKey}`;
    }

    _qKey(state, action) {
        return `${state}::${action}`;
    }

    _getQ(state, action) {
        return this.qTable[this._qKey(state, action)] || 0;
    }

    _setQ(state, action, value) {
        this.qTable[this._qKey(state, action)] = value;
    }

    _chooseAction(state) {
        if (Math.random() < this.epsilon) {
            const actions = Object.values(ACTIONS);
            return actions[Math.floor(Math.random() * actions.length)];
        }
        let best = ACTIONS.USE_HINT;
        let bestQ = -Infinity;
        for (const action of Object.values(ACTIONS)) {
            const q = this._getQ(state, action);
            if (q > bestQ) {
                bestQ = q;
                best = action;
            }
        }
        return best;
    }

    _updateQ(state, action, reward, nextState) {
        const oldQ = this._getQ(state, action);
        let maxNextQ = 0;
        for (const a of Object.values(ACTIONS)) {
            maxNextQ = Math.max(maxNextQ, this._getQ(nextState, a));
        }
        const newQ = oldQ + this.alpha * (reward + this.gamma * maxNextQ - oldQ);
        this._setQ(state, action, newQ);
    }

    async _solveStep(step, problem, seed, run) {
        const skills = cleanArray(step.knowledgeComponents || []);
        run.stepsTotal += 1;

        this._startStepReasoning(step, problem);
        this._emit("step-start", { stepId: step.id, problemId: problem.id, skills });

        const state = this._stateKey(step);
        const action = this._chooseAction(state);
        let attempt = null;
        let firstTry = false;
        let hintsUsed = 0;

        this._recordReasoningAction("rl-select-action", `${action} @ state ${state}`);
        this._emit("rl-action", { stepId: step.id, state, action, qTableSize: Object.keys(this.qTable).length });

        if (action === ACTIONS.RECALL && this.stepMemory[step.id]) {
            attempt = this.stepMemory[step.id];
            firstTry = true;
            this._recordReasoningAction("rl-recall", attempt?.slice(0, 40));
        } else if (action === ACTIONS.USE_HINT && this._shouldAllowHints()) {
            this._traceHintPathway(step);
            attempt = await this._learnFromHints(step, problem, seed, run);
            hintsUsed = this._resolveHintPathway(step).length;
            this._recordReasoningAction("rl-use-hint", `${hintsUsed} hints`);
        } else if (action === ACTIONS.USE_HINT) {
            this._recordReasoningAction("rl-use-hint-blocked", "strict no-clue");
        } else {
            attempt =
                this.stepMemory[step.id] ||
                (this._strictNoClues ? null : step.stepAnswer?.[0]);
            if (this.stepMemory[step.id]) firstTry = true;
            this._recordReasoningAction("rl-submit-best", attempt?.slice(0, 40));
        }

        let isCorrect = attempt ? this._checkStepAnswer(step, attempt, seed) : false;

        if (!isCorrect && action !== ACTIONS.USE_HINT && this._shouldAllowHints()) {
            this._traceHintPathway(step);
            attempt = await this._learnFromHints(step, problem, seed, run);
            hintsUsed += this._resolveHintPathway(step).length;
            this._recordReasoningAction("rl-fallback-hint", `${hintsUsed} hints`);
            if (attempt) isCorrect = this._checkStepAnswer(step, attempt, seed);
            firstTry = false;
        }

        let reward = isCorrect ? (firstTry ? 1.0 : 0.55) : -0.35;
        reward -= hintsUsed * 0.05;
        const masteryGain =
            this._lessonMastery() - (run._prevMastery || run.masteryStart);
        reward += masteryGain * 2;
        run._prevMastery = this._lessonMastery();

        const nextState = this._stateKey(step);
        this._updateQ(state, action, reward, nextState);
        this.totalReward += reward;

        this.experienceBuffer.push({ state, action, reward, nextState, stepId: step.id });

        if (isCorrect) {
            if (firstTry) run.stepsCorrectFirstTry += 1;
            else run.stepsCorrectAfterLearning += 1;
            this._updateBKT(skills, true);
            if (attempt) this.stepMemory[step.id] = attempt;
        } else {
            this._updateBKT(skills, false);
        }

        this._recordReasoningAnswer(attempt, isCorrect);
        this._emit("step-complete", {
            stepId: step.id,
            isCorrect,
            firstTry,
            action,
            reward: Math.round(reward * 100) / 100,
        });

        await sleep(this.stepDelayMs);
        return isCorrect;
    }

    async _solveProblem(problem, run) {
        const seed = Date.now().toString();
        run.problemsAttempted += 1;
        run._prevMastery = this._lessonMastery();

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
            strategy: "tabular-q-learning",
            totalReward: this.totalReward,
            qTableSize: Object.keys(this.qTable).length,
            epsilon: this.epsilon,
            experienceCount: this.experienceBuffer.length,
        };
    }
}
