import { AGENT_TYPES } from "./agentTypes.js";
import LocalPropositionalChainLLMAgent from "./LocalPropositionalChainLLMAgent.js";
import { getLLMSettingsSync } from "./llm/llmSettings.js";
import {
    buildStepPlan,
    buildChainContextFromPlan,
    formatChainTreePlanSummary,
    isPropPlanningEnabled,
    summarizePlanForEvent,
} from "./llm/propositionHintPlanner.js";
import {
    buildChainTreeForStep,
    CHAIN_TREE_POLICY_VERSION,
    DEFAULT_TREE_OPTIONS,
    formatChainTreeSummary,
} from "./llm/propositionChainTreeReasoning.js";
import { CHAIN_POLICY_VERSION } from "./llm/propositionChainReasoning.js";

export default class LocalPropositionalChainTreeLLMAgent extends LocalPropositionalChainLLMAgent {
    constructor(options) {
        super({ ...options, agentType: AGENT_TYPES.LOCAL_LLM_PROP_CHAIN_TREE });
        this._treeOptions = {
            ...DEFAULT_TREE_OPTIONS,
            ...(options.treeOptions || {}),
        };
        this._maxChainAttempts = this._treeOptions.maxAttempts;
    }

    createRun() {
        const run = super.createRun();
        run.bktMode = "proposition-chain-tree";
        return run;
    }

    finalizeRun(run, reason) {
        super.finalizeRun(run, reason);
        run.bktMode = "proposition-chain-tree";
    }

    _getChainBktMode() {
        return "proposition-chain-tree";
    }

    _getChainPolicyVersion() {
        return CHAIN_TREE_POLICY_VERSION;
    }

    _buildChainContext(step) {
        const settings = getLLMSettingsSync();
        this.llmSettings = settings;

        if (!isPropPlanningEnabled(settings, this.agentType)) {
            this._currentStepPlan = null;
            return buildChainTreeForStep(this.propEngine, {
                lessonId: this.lesson.id,
                stepId: step.id,
                chainStore: this.chainStore,
                reasoningGraph: this.reasoningGraph,
                beamWidth: this._treeOptions.beamWidth,
                maxDepth: this._treeOptions.maxDepth,
                maxChains: this._treeOptions.maxChains,
            });
        }

        try {
            const plan = buildStepPlan(this.propEngine, {
                lessonId: this.lesson.id,
                stepId: step.id,
                settings,
                chainStore: this.chainStore,
                reasoningGraph: this.reasoningGraph,
            });
            this._currentStepPlan = plan;

            let mergeTreeFallback = null;
            if ((plan.candidateChains?.length || 0) < this._treeOptions.maxAttempts) {
                mergeTreeFallback = buildChainTreeForStep(this.propEngine, {
                    lessonId: this.lesson.id,
                    stepId: step.id,
                    chainStore: this.chainStore,
                    reasoningGraph: this.reasoningGraph,
                    beamWidth: this._treeOptions.beamWidth,
                    maxDepth: this._treeOptions.maxDepth,
                    maxChains: this._treeOptions.maxChains,
                });
            }

            return buildChainContextFromPlan(plan, {
                maxChains: this._treeOptions.maxChains,
                mergeTreeFallback,
                treeOptions: this._treeOptions,
            });
        } catch (err) {
            console.error("Hint planning failed for tree agent; using beam tree only", err);
            this._currentStepPlan = null;
            this._emit("llm-error", {
                stepId: step.id,
                message: `Hint planning failed (${err.message || "unknown"}); using structural beam tree.`,
            });
            return buildChainTreeForStep(this.propEngine, {
                lessonId: this.lesson.id,
                stepId: step.id,
                chainStore: this.chainStore,
                reasoningGraph: this.reasoningGraph,
                beamWidth: this._treeOptions.beamWidth,
                maxDepth: this._treeOptions.maxDepth,
                maxChains: this._treeOptions.maxChains,
            });
        }
    }

    _emitChainCandidates(step, chainContext) {
        if (this._currentStepPlan) {
            this._emit("prop-plan", summarizePlanForEvent(this._currentStepPlan, {
                agentType: this.agentType,
                strictNoClues: this._strictNoClues || this._evaluationMode,
            }));
        }

        const treeSummary = chainContext?.treeMeta?.planSeeded
            ? formatChainTreePlanSummary(chainContext)
            : formatChainTreeSummary(chainContext);

        this._emit("prop-chain-tree-candidates", {
            stepId: step.id,
            agentType: this.agentType,
            policyVersion: CHAIN_TREE_POLICY_VERSION,
            treeSummary,
            treeMeta: chainContext.treeMeta,
            planSeeded: !!chainContext?.treeMeta?.planSeeded,
            strictNoClues: this._strictNoClues || this._evaluationMode,
            chains: (chainContext.chains || []).map((c) => ({
                key: c.key,
                score: c.score,
                length: c.length,
                treeDepth: c.treeDepth,
                rootPropId: c.rootPropId,
                rootText: c.rootText?.slice(0, 120),
                linkedHintIds: c.linkedHintIds,
                nodes: c.nodes?.map((n) => ({
                    id: n.id,
                    text: n.text?.slice(0, 120),
                    probMastery: n.probMastery,
                })),
            })),
            primaryChainKey: chainContext.primaryChain?.key || null,
        });
    }

    async evaluateProblem(problem, options = {}) {
        const result = await super.evaluateProblem(problem, options);
        return { ...result, bktMode: "proposition-chain-tree" };
    }

    buildOutput(run) {
        const output = super.buildOutput(run);
        return {
            ...output,
            bktMode: "proposition-chain-tree",
            agentExtras: this.getAgentExtras?.() || output.agentExtras,
        };
    }

    getAgentExtras() {
        const base = super.getAgentExtras();
        return {
            ...base,
            strategy: "local-reasoning-llm-propositional-chain-tree-bkt",
            bktMode: "proposition-chain-tree",
            policyVersion: CHAIN_TREE_POLICY_VERSION,
            chainPolicyVersion: CHAIN_POLICY_VERSION,
            treeOptions: this._treeOptions,
            propPlanningEnabled: isPropPlanningEnabled(
                this.llmSettings || getLLMSettingsSync(),
                this.agentType
            ),
        };
    }
}
