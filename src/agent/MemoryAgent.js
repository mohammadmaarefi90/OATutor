import { cleanArray } from "../util/cleanObject.js";
import { AGENT_TYPES } from "./agentTypes.js";
import BaseAgent from "./BaseAgent.js";
import AgentMemory from "./AgentMemory.js";
import PropositionGraph from "./PropositionGraph.js";
import AgentPerformanceTracker from "./AgentPerformanceTracker.js";
import ReasoningGraph from "./ReasoningGraph.js";
import {
    AGENT_MEMORY_STORAGE_KEY,
    AGENT_GRAPH_STORAGE_KEY,
    AGENT_PERFORMANCE_STORAGE_KEY,
    AGENT_REASONING_STORAGE_KEY,
} from "./storageKeys.js";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export default class MemoryAgent extends BaseAgent {
    constructor(options) {
        super({ ...options, agentType: AGENT_TYPES.MEMORY });
        this.memory = new AgentMemory(this.lesson.id);
        this.graph = new PropositionGraph(this.lesson.id);
        this.reasoningGraph = new ReasoningGraph(this.lesson.id, AGENT_TYPES.MEMORY);
        this.performance = new AgentPerformanceTracker(this.lesson.id, AGENT_TYPES.MEMORY);
    }

    getReasoningGraph() {
        return this.reasoningGraph;
    }

    async saveReasoningGraph() {
        if (!this._persist) return;
        await this._persist.setByKey(
            AGENT_REASONING_STORAGE_KEY(this.lesson.id, AGENT_TYPES.MEMORY),
            this.reasoningGraph.toJSON()
        );
    }

    async loadPersistedState() {
        if (!this.browserStorage) return;
        const { getByKey, setByKey } = this.browserStorage;
        const type = AGENT_TYPES.MEMORY;
        const [memData, graphData, perfData, reasoningData] = await Promise.all([
            getByKey(AGENT_MEMORY_STORAGE_KEY(this.lesson.id, type)).catch(() => null),
            getByKey(AGENT_GRAPH_STORAGE_KEY(this.lesson.id, type)).catch(() => null),
            getByKey(AGENT_PERFORMANCE_STORAGE_KEY(this.lesson.id, type)).catch(() => null),
            getByKey(AGENT_REASONING_STORAGE_KEY(this.lesson.id, type)).catch(() => null),
        ]);
        if (AgentMemory.fromJSON(memData)) this.memory = AgentMemory.fromJSON(memData);
        if (PropositionGraph.fromJSON(graphData)) this.graph = PropositionGraph.fromJSON(graphData);
        if (AgentPerformanceTracker.fromJSON(perfData))
            this.performance = AgentPerformanceTracker.fromJSON(perfData);
        if (ReasoningGraph.fromJSON(reasoningData))
            this.reasoningGraph = ReasoningGraph.fromJSON(reasoningData);
        this._persist = { getByKey, setByKey };
    }

    async savePersistedState() {
        if (!this._persist) return;
        const { setByKey } = this._persist;
        const type = AGENT_TYPES.MEMORY;
        await Promise.all([
            setByKey(AGENT_MEMORY_STORAGE_KEY(this.lesson.id, type), this.memory.toJSON()),
            setByKey(AGENT_GRAPH_STORAGE_KEY(this.lesson.id, type), this.graph.toJSON()),
            setByKey(AGENT_PERFORMANCE_STORAGE_KEY(this.lesson.id, type), this.performance.toJSON()),
            setByKey(AGENT_REASONING_STORAGE_KEY(this.lesson.id, type), this.reasoningGraph.toJSON()),
        ]);
    }

    getMemoryStats() {
        return this.memory.getStats();
    }

    getGraphStats() {
        return this.graph.getStats();
    }

    getMemorySnapshot() {
        return this.memory.snapshot();
    }

    getGraphSnapshot() {
        return this.graph.snapshot();
    }

    getGrowthSummary() {
        return this.performance.getGrowthSummary();
    }

    createRun() {
        return this.performance.startRun();
    }

    finalizeRun(run, reason) {
        run.endedAt = Date.now();
        run.status = reason;
        run.durationMs = run.endedAt - run.startedAt;
        run.agentType = AGENT_TYPES.MEMORY;
        this.performance.finalizeRun(run, reason);
    }

    async _learnFromStep(step, problem, seed, run) {
        const skills = cleanArray(step.knowledgeComponents || []);
        this.graph.ingestHintPathway(
            step.hints || {},
            step,
            problem.id,
            skills,
            this.hintPathway
        );
        run.propositionsLearned = Object.keys(this.graph.nodes).length;

        this._emit("learn", {
            stepId: step.id,
            hintsReviewed: this._resolveHintPathway(step).length,
            graphStats: this.graph.getStats(),
        });

        this._traceHintPathway(step);
        this._recordReasoningAction("learn-from-hints", `${this._resolveHintPathway(step).length} hints`);

        const answer = await this._learnFromHints(step, problem, seed, run);
        if (answer) {
            this.memory.store({
                stepId: step.id,
                problemId: problem.id,
                answer,
                skills,
                source: "hint-pathway",
            });
        }
        return answer;
    }

    async _solveStep(step, problem, seed, run) {
        const skills = cleanArray(step.knowledgeComponents || []);
        run.stepsTotal += 1;

        this._startStepReasoning(step, problem);
        this._emit("step-start", { stepId: step.id, problemId: problem.id, skills });

        const recalled = this.memory.recall(step.id, skills);
        let attempt = recalled?.answer;
        let firstTry = !!attempt;
        let isCorrect = false;

        if (attempt) {
            this._recordReasoningAction("memory-recall", `confidence ${Math.round((recalled.confidence || 0) * 100)}%`);
            isCorrect = this._checkStepAnswer(step, attempt, seed);
            this._emit("recall", {
                stepId: step.id,
                attempt,
                isCorrect,
                confidence: recalled.confidence,
            });
        }

        if (!isCorrect && this._shouldAllowHints()) {
            firstTry = false;
            this._recordReasoningAction("recall-failed", "consulting hints");
            attempt = await this._learnFromStep(step, problem, seed, run);
            if (attempt) {
                isCorrect = this._checkStepAnswer(step, attempt, seed);
            }
        } else if (!isCorrect && this._strictNoClues) {
            firstTry = false;
            this._recordReasoningAction("recall-failed", "strict no-clue — no hints");
        }

        if (isCorrect) {
            if (firstTry) run.stepsCorrectFirstTry += 1;
            else run.stepsCorrectAfterLearning += 1;
            this._updateBKT(skills, true);
            this.memory.store({
                stepId: step.id,
                problemId: problem.id,
                answer: attempt,
                skills,
                source: firstTry ? "recall-success" : "learning-success",
            });
        } else {
            this._updateBKT(skills, false);
        }

        this._recordReasoningAnswer(attempt, isCorrect);
        this._emit("step-complete", { stepId: step.id, isCorrect, firstTry, attempt });
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
        return { strategy: "memory-recall-and-hint-graph" };
    }
}
