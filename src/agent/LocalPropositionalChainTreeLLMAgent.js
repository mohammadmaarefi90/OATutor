import { AGENT_TYPES } from "./agentTypes.js";
import LocalPropositionalChainLLMAgent from "./LocalPropositionalChainLLMAgent.js";
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

    _emitChainCandidates(step, chainContext) {
        this._emit("prop-chain-tree-candidates", {
            stepId: step.id,
            agentType: this.agentType,
            policyVersion: CHAIN_TREE_POLICY_VERSION,
            treeSummary: formatChainTreeSummary(chainContext),
            treeMeta: chainContext.treeMeta,
            strictNoClues: this._strictNoClues || this._evaluationMode,
            chains: (chainContext.chains || []).map((c) => ({
                key: c.key,
                score: c.score,
                length: c.length,
                treeDepth: c.treeDepth,
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
        };
    }
}
