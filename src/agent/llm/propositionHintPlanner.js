/**
 * Hint-grounded planning for Propositional BKT and Tree agents (Phase 1).
 * Given trained beliefs + structure, proposes per-step ideas, relevant hints,
 * and one scored chain per pivot idea — without calling an LLM.
 */

import { rankPropositionsForStep, POLICY_VERSION } from "./propositionPolicy.js";
import {
    buildPropositionChain,
    enumerateChainsToTarget,
    scoreChain,
    CHAIN_POLICY_VERSION,
} from "./propositionChainReasoning.js";
export const PROP_PLANNING_MODE = "hint-plan";

/** Keep in sync with propositionChainTreeReasoning.CHAIN_TREE_POLICY_VERSION */
const CHAIN_TREE_POLICY_VERSION = "prop-chain-tree-v1";

/** Must match AGENT_TYPES.LOCAL_LLM_PROP and LOCAL_LLM_PROP_CHAIN_TREE */
export const PROP_PLANNING_AGENT_TYPES = new Set([
    "local-llm-prop-bkt",
    "local-llm-prop-chain-tree-bkt",
]);

export const PLAN_VERSION = "hint-plan-v1";

const STRUCTURAL_TYPES = new Set([
    "sequence",
    "prerequisite",
    "supports",
    "depends",
    "step-to-hint",
]);

export const DEFAULT_PLAN_OPTIONS = {
    maxIdeas: 12,
    maxPivots: 3,
    maxHints: 8,
    maxChainsPerStep: 5,
    masteryThreshold: 0.95,
};

/**
 * Pick teachable propositions that can seed distinct reasoning chains.
 */
export function selectPivotIdeas(ranking, { maxPivots = DEFAULT_PLAN_OPTIONS.maxPivots } = {}) {
    const pool = (ranking?.ranked || []).filter(
        (p) => !p.mastered && p.sourceType !== "answer"
    );

    const hintPivots = pool.filter((p) => p.sourceType === "hint");
    const otherPivots = pool.filter((p) => p.sourceType !== "hint");
    const ordered = [...hintPivots, ...otherPivots];

    const seen = new Set();
    const pivots = [];
    for (const p of ordered) {
        if (seen.has(p.id)) continue;
        seen.add(p.id);
        pivots.push({ ...p, role: "pivot" });
        if (pivots.length >= maxPivots) break;
    }
    return pivots;
}

/**
 * Map ranked ideas to hint pathway entries via hintPropMap / node.hintId.
 */
export function mapRelevantHints(
    propEngine,
    { lessonId, stepId, ideas = [], maxHints = DEFAULT_PLAN_OPTIONS.maxHints } = {}
) {
    const lid = lessonId || propEngine.lessonId;
    const structure = propEngine.structureGraphs?.[lid];
    const stepContent = propEngine.stepContent?.[stepId];
    const beliefs = propEngine.getBeliefs?.() || {};

    if (!structure || !stepContent) return [];

    const pathway = stepContent.pathway || [];
    const hintPropMap = stepContent.hintPropMap || {};
    const pathwayByHintId = new Map(pathway.map((h) => [h.id, h]));

    const hintScores = new Map();

    const considerProp = (prop, boost = 0) => {
        const uncertainty = prop.uncertainty ?? 1 - (prop.probMastery ?? 0);
        const baseScore = (prop.priority ?? 0) + boost + uncertainty * 0.25;

        const node = structure.nodes[prop.id];
        if (node?.hintId) {
            accumulateHint(node.hintId, prop.id, baseScore + 0.15);
        }

        for (const [hintId, propIds] of Object.entries(hintPropMap)) {
            if (propIds.includes(prop.id)) {
                accumulateHint(hintId, prop.id, baseScore);
            }
        }
    };

    function accumulateHint(hintId, propId, score) {
        const prev = hintScores.get(hintId);
        if (!prev || score > prev.relevanceScore) {
            hintScores.set(hintId, { hintId, propId, relevanceScore: score });
        }
    }

    for (const idea of ideas) {
        considerProp(idea, idea.role === "pivot" ? 0.2 : 0);
    }

    return [...hintScores.values()]
        .map((entry) => {
            const hint = pathwayByHintId.get(entry.hintId);
            const propBelief = beliefs[entry.propId];
            return {
                hintId: entry.hintId,
                propId: entry.propId,
                title: hint?.title || entry.hintId,
                text: hint?.text || structure.nodes[entry.propId]?.text || "",
                pathwayIndex: hint?.pathwayIndex ?? pathway.findIndex((h) => h.id === entry.hintId),
                relevanceScore: entry.relevanceScore,
                probMastery: propBelief?.probMastery ?? null,
            };
        })
        .filter((h) => h.text && h.text.length > 1)
        .sort((a, b) => b.relevanceScore - a.relevanceScore)
        .slice(0, maxHints);
}

/**
 * Forward structural path from pivot proposition to answer proposition.
 */
export function findForwardPath(structure, fromId, toId, { maxDepth = 10 } = {}) {
    if (!structure || !fromId || !toId) return [];
    if (fromId === toId) return [fromId];

    const queue = [[fromId]];
    while (queue.length > 0) {
        const path = queue.shift();
        const current = path[path.length - 1];
        if (current === toId) return path;
        if (path.length >= maxDepth) continue;

        for (const edge of structure.getOutgoing?.(current) || structure.edges || []) {
            if (edge.from !== current) continue;
            if (!STRUCTURAL_TYPES.has(edge.type)) continue;
            if (path.includes(edge.to)) continue;
            queue.push([...path, edge.to]);
        }
    }

    return [fromId, toId];
}

/**
 * Build one scored chain rooted at a pivot idea toward the step answer.
 */
export function buildChainFromPivot(
    propEngine,
    pivotId,
    { lessonId, stepId, chainStore, reasoningGraph, maxDepth = 10 } = {}
) {
    const lid = lessonId || propEngine.lessonId;
    const structure = propEngine.structureGraphs?.[lid];
    const stepContent = propEngine.stepContent?.[stepId];
    const beliefs = propEngine.getBeliefs?.() || {};
    const defaultBelief = propEngine.defaultBelief;

    if (!structure || !stepContent || !pivotId) return null;

    const targetId = stepContent.answerPropId;
    let propIds = [];

    if (targetId) {
        const enumerated = enumerateChainsToTarget(structure, targetId, { maxChains: 12, maxDepth });
        const containing = enumerated.filter((path) => path.includes(pivotId));
        if (containing.length > 0) {
            containing.sort((a, b) => a.length - b.length);
            propIds = containing[0];
            if (propIds[0] !== pivotId) {
                const idx = propIds.indexOf(pivotId);
                propIds = propIds.slice(idx);
            }
        } else {
            propIds = findForwardPath(structure, pivotId, targetId, { maxDepth });
        }
    } else {
        propIds = [pivotId];
    }

    if (!propIds.length) return null;

    const chain = buildPropositionChain(structure, beliefs, propIds, defaultBelief);
    const scored = scoreChain(chain, { beliefs, defaultBelief, chainStore, reasoningGraph });
    const pivotNode = structure.nodes[pivotId];

    return {
        ...scored,
        rootPropId: pivotId,
        rootText: pivotNode?.text || pivotId,
        linkedHintIds: collectHintIdsForProps(structure, stepContent, propIds),
    };
}

function collectHintIdsForProps(structure, stepContent, propIds) {
    const hintIds = new Set();
    const hintPropMap = stepContent?.hintPropMap || {};

    for (const propId of propIds) {
        const node = structure.nodes[propId];
        if (node?.hintId) hintIds.add(node.hintId);
        for (const [hintId, mapped] of Object.entries(hintPropMap)) {
            if (mapped.includes(propId)) hintIds.add(hintId);
        }
    }
    return [...hintIds];
}

/**
 * Full per-step plan: ideas, relevant hints, and one chain per pivot.
 */
export function buildStepPlan(
    propEngine,
    {
        lessonId,
        stepId,
        settings = {},
        chainStore = null,
        reasoningGraph = null,
    } = {}
) {
    const options = {
        ...DEFAULT_PLAN_OPTIONS,
        maxIdeas: settings.maxIdeas ?? settings.maxBeliefsInPrompt ?? DEFAULT_PLAN_OPTIONS.maxIdeas,
        maxPivots: settings.propPlanningMaxPivots ?? DEFAULT_PLAN_OPTIONS.maxPivots,
        maxHints: settings.propPlanningMaxHints ?? DEFAULT_PLAN_OPTIONS.maxHints,
        maxChainsPerStep:
            settings.propPlanningMaxChains ?? DEFAULT_PLAN_OPTIONS.maxChainsPerStep,
        masteryThreshold:
            settings.propPolicyMasteryThreshold ?? DEFAULT_PLAN_OPTIONS.masteryThreshold,
    };

    const lid = lessonId || propEngine.lessonId;
    const ranking = rankPropositionsForStep(propEngine, {
        lessonId: lid,
        stepId,
        limit: options.maxIdeas,
        masteryThreshold: options.masteryThreshold,
    });

    const pivots = selectPivotIdeas(ranking, { maxPivots: options.maxPivots });
    const pivotIds = new Set(pivots.map((p) => p.id));

    const stepIdeas = (ranking.ranked || []).map((idea) => ({
        ...idea,
        role: pivotIds.has(idea.id) ? "pivot" : idea.role,
    }));

    const relevantHints = mapRelevantHints(propEngine, {
        lessonId: lid,
        stepId,
        ideas: stepIdeas,
        maxHints: options.maxHints,
    });

    const candidateChains = [];
    const seenChainKeys = new Set();

    for (const pivot of pivots) {
        const chain = buildChainFromPivot(propEngine, pivot.id, {
            lessonId: lid,
            stepId,
            chainStore,
            reasoningGraph,
        });
        if (!chain || seenChainKeys.has(chain.key)) continue;
        seenChainKeys.add(chain.key);
        candidateChains.push(chain);
        if (candidateChains.length >= options.maxChainsPerStep) break;
    }

    candidateChains.sort((a, b) => b.score - a.score);

    return {
        stepId,
        lessonId: lid,
        answerPropId: ranking.answerPropId,
        closureSize: ranking.closureSize,
        stepIdeas,
        pivots,
        relevantHints,
        candidateChains,
        primaryChain: candidateChains[0] || null,
        ranking,
        planVersion: PLAN_VERSION,
        policyVersions: {
            ranking: ranking.policyVersion || POLICY_VERSION,
            chain: CHAIN_POLICY_VERSION,
        },
    };
}

/**
 * Plain-text summary for traces, tests, and future prompt injection (Phase 2).
 */
export function formatStepPlanForPrompt(plan) {
    if (!plan) return "(No hint plan available for this step.)";

    const lines = [];

    if (plan.pivots?.length > 0) {
        lines.push("Pivot ideas (each seeds a reasoning chain):");
        plan.pivots.forEach((p, i) => {
            const pct = Math.round((p.probMastery || 0) * 100);
            lines.push(`${i + 1}. [${pct}%] ${p.text}`);
        });
        lines.push("");
    }

    if (plan.relevantHints?.length > 0) {
        lines.push("Relevant hints from training:");
        plan.relevantHints.forEach((h, i) => {
            const pct =
                h.probMastery != null ? ` [${Math.round(h.probMastery * 100)}%]` : "";
            lines.push(`${i + 1}.${pct} ${h.text}`);
        });
        lines.push("");
    }

    if (plan.candidateChains?.length > 0) {
        lines.push("Candidate chains (one per pivot):");
        plan.candidateChains.forEach((chain, i) => {
            const nodes = (chain.nodes || []).map((n) => n.text).join(" → ");
            lines.push(
                `${i + 1}. (score ${(chain.score ?? 0).toFixed(2)}) ${nodes}`
            );
        });
    }

    if (lines.length === 0) {
        return "(No hint plan available for this step.)";
    }

    return lines.join("\n").trim();
}

export function isPropPlanningEnabled(settings, agentType) {
    return !!settings?.propPlanningEnabled && PROP_PLANNING_AGENT_TYPES.has(agentType);
}

/**
 * Compact event payload for UI traces and training logs.
 */
export function summarizePlanForEvent(plan, { strictNoClues = false, agentType } = {}) {
    if (!plan) return null;
    return {
        stepId: plan.stepId,
        agentType,
        planVersion: plan.planVersion,
        strictNoClues,
        pivotCount: plan.pivots?.length ?? 0,
        hintCount: plan.relevantHints?.length ?? 0,
        chainCount: plan.candidateChains?.length ?? 0,
        pivots: (plan.pivots || []).map((p) => ({
            id: p.id,
            text: p.text?.slice(0, 200),
            probMastery: p.probMastery,
            role: p.role,
            priority: p.priority,
        })),
        relevantHints: (plan.relevantHints || []).map((h) => ({
            hintId: h.hintId,
            propId: h.propId,
            text: h.text?.slice(0, 200),
            relevanceScore: h.relevanceScore,
            probMastery: h.probMastery,
        })),
        candidateChains: (plan.candidateChains || []).map((c) => ({
            key: c.key,
            score: c.score,
            rootPropId: c.rootPropId,
            rootText: c.rootText?.slice(0, 120),
            length: c.length,
            linkedHintIds: c.linkedHintIds || [],
        })),
        primarySuggestion: plan.pivots?.[0]
            ? {
                  id: plan.pivots[0].id,
                  text: plan.pivots[0].text,
                  probMastery: plan.pivots[0].probMastery,
                  reason: "top pivot idea from hint planning module",
              }
            : null,
    };
}

/**
 * Chain context for Tree agent: plan-seeded chains, optionally merged with beam tree.
 */
export function buildChainContextFromPlan(
    plan,
    { maxChains = 10, mergeTreeFallback = null, treeOptions = {} } = {}
) {
    const chains = [...(plan?.candidateChains || [])];
    const seen = new Set(chains.map((c) => c.key));

    if (mergeTreeFallback?.chains?.length) {
        for (const chain of mergeTreeFallback.chains) {
            if (!chain?.key || seen.has(chain.key)) continue;
            seen.add(chain.key);
            chains.push(chain);
        }
    }

    chains.sort((a, b) => (b.score ?? 0) - (a.score ?? 0));

    const treeMeta = {
        source: PLAN_VERSION,
        planSeeded: true,
        pivotCount: plan?.pivots?.length ?? 0,
        hintCount: plan?.relevantHints?.length ?? 0,
        branchesExplored:
            (plan?.pivots?.length ?? 0) + (mergeTreeFallback?.treeMeta?.branchesExplored ?? 0),
        completeCount: chains.length,
        basePolicy: plan?.policyVersions?.chain || CHAIN_POLICY_VERSION,
        beamWidth: treeOptions.beamWidth,
        maxDepth: treeOptions.maxDepth,
        mergedWithBeamTree: !!mergeTreeFallback?.chains?.length,
    };

    return {
        stepId: plan?.stepId,
        answerPropId: plan?.answerPropId,
        ranking: plan?.ranking,
        chains: chains.slice(0, maxChains),
        primaryChain: chains[0] || null,
        treeMeta,
        plan,
        policyVersion: CHAIN_TREE_POLICY_VERSION,
    };
}

export function formatChainTreePlanSummary(context) {
    if (!context?.treeMeta?.planSeeded) return "";
    const m = context.treeMeta;
    const mergeNote = m.mergedWithBeamTree ? " (merged with structural beam tree)" : "";
    return `Hint plan seeded ${m.pivotCount} pivot(s), ${m.hintCount} hint(s), ${m.completeCount} chain branch(es)${mergeNote}.`;
}
