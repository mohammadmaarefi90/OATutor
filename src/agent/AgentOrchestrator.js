import MemoryAgent from "./MemoryAgent.js";
import RLAgent from "./RLAgent.js";
import LLMAgent from "./LLMAgent.js";
import LocalReasoningLLMAgent from "./LocalReasoningLLMAgent.js";
import LocalPropositionalLLMAgent from "./LocalPropositionalLLMAgent.js";
import LocalPropositionalChainLLMAgent from "./LocalPropositionalChainLLMAgent.js";
import LocalPropositionalChainTreeLLMAgent from "./LocalPropositionalChainTreeLLMAgent.js";
import {
    AGENT_TYPES,
    ALL_AGENT_TYPES,
    EVALUATION_AGENT_TYPES,
    LOCAL_LLM_AGENT_TYPES,
} from "./agentTypes.js";
import { getLLMSettingsSync } from "./llm/llmSettings.js";
import { cloneBktParams, restoreBktParams } from "./bktSnapshot.js";
import { filterProblemsForLesson } from "./problemSelection.js";
import { buildComparisonReport } from "./agentComparison.js";
import { buildEvaluationReport, saveEvaluationReport } from "./AgentEvaluator.js";
import { AGENT_COMPARISON_STORAGE_KEY } from "./storageKeys.js";

const AGENT_FACTORY = {
    [AGENT_TYPES.MEMORY]: MemoryAgent,
    [AGENT_TYPES.RL]: RLAgent,
    [AGENT_TYPES.LLM]: LLMAgent,
    [AGENT_TYPES.LOCAL_LLM]: LocalReasoningLLMAgent,
    [AGENT_TYPES.LOCAL_LLM_PROP]: LocalPropositionalLLMAgent,
    [AGENT_TYPES.LOCAL_LLM_PROP_CHAIN]: LocalPropositionalChainLLMAgent,
    [AGENT_TYPES.LOCAL_LLM_PROP_CHAIN_TREE]: LocalPropositionalChainTreeLLMAgent,
};

export default class AgentOrchestrator {
    constructor({
        lesson,
        problems,
        bktParams,
        heuristic,
        hintPathway,
        browserStorage,
        onEvent = () => {},
        onMasteryUpdate = () => {},
        stepDelayMs = 200,
        skillModel = {},
    }) {
        this.lesson = lesson;
        this.problems = filterProblemsForLesson(problems, lesson);
        this.skillModel = skillModel;
        this.bktParams = bktParams;
        this.heuristic = heuristic;
        this.hintPathway = hintPathway;
        this.browserStorage = browserStorage;
        this.onEvent = onEvent;
        this.onMasteryUpdate = onMasteryUpdate;
        this.stepDelayMs = stepDelayMs;
        this.cancelled = false;
        this.activeAgent = null;
    }

    cancel() {
        this.cancelled = true;
        if (this.activeAgent) this.activeAgent.cancel();
    }

    createAgent(agentType, bktParamsOverride = null) {
        const AgentClass = AGENT_FACTORY[agentType];
        if (!AgentClass) throw new Error(`Unknown agent type: ${agentType}`);

        const options = {
            lesson: this.lesson,
            problems: this.problems,
            bktParams: bktParamsOverride || this.bktParams,
            heuristic: this.heuristic,
            hintPathway: this.hintPathway,
            browserStorage: this.browserStorage,
            onEvent: (event) => this.onEvent({ ...event, agentType }),
            onMasteryUpdate: this.onMasteryUpdate,
            stepDelayMs: this.stepDelayMs,
        };
        if (
            agentType === AGENT_TYPES.LOCAL_LLM ||
            agentType === AGENT_TYPES.LOCAL_LLM_PROP ||
            agentType === AGENT_TYPES.LOCAL_LLM_PROP_CHAIN ||
            agentType === AGENT_TYPES.LOCAL_LLM_PROP_CHAIN_TREE
        ) {
            options.llmSettings = getLLMSettingsSync();
            options.skillModel = this.skillModel;
        }
        return new AgentClass(options);
    }

    async runAgent(agentType, { maxProblems = 30, isolatedBkt = false } = {}) {
        const initialBkt = cloneBktParams(this.bktParams);
        const agentBkt = isolatedBkt ? cloneBktParams(initialBkt) : this.bktParams;

        this.activeAgent = this.createAgent(agentType, agentBkt);
        this.onEvent({ type: "agent-run-start", agentType });

        const output = await this.activeAgent.runTrainingSession({ maxProblems });

        // Non-isolated runs keep BKT updates on the shared student model (no restore).

        this.activeAgent = null;
        this.onEvent({ type: "agent-run-end", agentType, output });
        return output;
    }

    async runComparison({ maxProblems = 20 } = {}) {
        const initialBkt = cloneBktParams(this.bktParams);
        const agentOutputs = {};

        this.onEvent({ type: "comparison-start", agents: ALL_AGENT_TYPES });

        for (const agentType of ALL_AGENT_TYPES) {
            if (this.cancelled) break;

            this.onEvent({ type: "comparison-agent-start", agentType });

            const agentBkt = cloneBktParams(initialBkt);
            this.activeAgent = this.createAgent(agentType, agentBkt);

            try {
                agentOutputs[agentType] = await this.activeAgent.runTrainingSession({
                    maxProblems,
                });
            } catch (err) {
                agentOutputs[agentType] = {
                    agentType,
                    run: { status: "error", error: err.message },
                    memoryStats: {},
                    graphStats: {},
                    bktSnapshot: {},
                    agentExtras: { error: err.message },
                };
            }

            this.activeAgent = null;
            this.onEvent({ type: "comparison-agent-end", agentType });
        }

        restoreBktParams(this.bktParams, initialBkt);

        const comparison = buildComparisonReport(agentOutputs);
        comparison.lessonId = this.lesson.id;
        comparison.maxProblems = maxProblems;

        if (this.browserStorage) {
            await this.browserStorage
                .setByKey(AGENT_COMPARISON_STORAGE_KEY(this.lesson.id), comparison)
                .catch(() => {});
        }

        this.onEvent({ type: "comparison-complete", comparison });
        return { comparison, agentOutputs };
    }

    async evaluateOnProblems(
        problemIds,
        { agentTypes = EVALUATION_AGENT_TYPES, strictNoClues = false } = {}
    ) {
        const initialBkt = cloneBktParams(this.bktParams);
        const problemResults = [];

        this.onEvent({ type: "evaluation-start", problemIds, agents: agentTypes, strictNoClues });

        for (const agentType of agentTypes) {
            if (this.cancelled) break;

            restoreBktParams(this.bktParams, cloneBktParams(initialBkt));
            this.activeAgent = this.createAgent(agentType, this.bktParams);
            this.activeAgent.stepDelayMs = 600;
            await this.activeAgent.loadPersistedState?.();

            this.onEvent({ type: "evaluation-agent-start", agentType });

            for (const problemId of problemIds) {
                if (this.cancelled) break;
                const problem = this.problems.find((p) => p.id === problemId);
                if (!problem) continue;

                try {
                    const result = await this.activeAgent.evaluateProblem(problem, {
                        persistLearning: !strictNoClues,
                        strictNoClues,
                    });
                    problemResults.push(result);
                } catch (err) {
                    problemResults.push({
                        agentType,
                        problemId,
                        error: err.message,
                        correct: false,
                    });
                }
            }

            this.activeAgent = null;
            this.onEvent({ type: "evaluation-agent-end", agentType });
        }

        restoreBktParams(this.bktParams, initialBkt);

        const report = buildEvaluationReport(problemResults, { agentTypes });
        report.lessonId = this.lesson.id;
        report.problemIds = problemIds;
        report.strictNoClues = strictNoClues;

        await saveEvaluationReport(this.browserStorage, this.lesson.id, report);

        this.onEvent({ type: "evaluation-complete", report });
        return report;
    }
}

export {
    MemoryAgent,
    RLAgent,
    LLMAgent,
    LocalReasoningLLMAgent,
    LocalPropositionalLLMAgent,
    LOCAL_LLM_AGENT_TYPES,
};
