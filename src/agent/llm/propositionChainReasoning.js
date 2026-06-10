/**
 * Build, score, and format proposition reasoning chains for Prop BKT (chain mode).
 */

import { rankPropositionsForStep } from "./propositionPolicy.js";

export const CHAIN_POLICY_VERSION = "prop-chain-v1";

const STRUCTURAL_TYPES = new Set(["sequence", "prerequisite", "supports", "depends", "step-to-hint"]);

function nodeText(structure, beliefs, propId, defaultBelief) {
    const node = structure?.nodes?.[propId];
    const belief = beliefs[propId];
    return node?.text || belief?.text || propId;
}

function masteryFor(beliefs, propId, defaultBelief) {
    return beliefs[propId]?.probMastery ?? defaultBelief?.probMastery ?? 0.1;
}

/**
 * Enumerate reasoning chains from structural predecessors to the answer proposition.
 */
export function enumerateChainsToTarget(structure, targetId, { maxChains = 8, maxDepth = 10 } = {}) {
    if (!structure || !targetId || !structure.nodes[targetId]) return [];

    const paths = [];

    function walk(currentId, path, depth) {
        if (depth > maxDepth) return;
        if (paths.length >= maxChains) return;

        const incoming = (structure.edges || []).filter(
            (e) => e.to === currentId && STRUCTURAL_TYPES.has(e.type)
        );

        if (incoming.length === 0) {
            paths.push([...path]);
            return;
        }

        for (const edge of incoming) {
            if (path.includes(edge.from)) continue;
            walk(edge.from, [edge.from, ...path], depth + 1);
        }
    }

    walk(targetId, [targetId], 0);

    const unique = new Map();
    for (const path of paths) {
        const key = path.join("→");
        if (!unique.has(key)) unique.set(key, path);
    }

    return [...unique.values()]
        .sort((a, b) => a.length - b.length)
        .slice(0, maxChains);
}

export function buildPropositionChain(structure, beliefs, propIds, defaultBelief) {
    const nodes = (propIds || []).map((id, index) => ({
        id,
        index,
        text: nodeText(structure, beliefs, id, defaultBelief),
        probMastery: masteryFor(beliefs, id, defaultBelief),
        sourceType: structure?.nodes?.[id]?.sourceType || "unknown",
        isTarget: index === propIds.length - 1,
    }));
    return {
        propIds: [...propIds],
        key: propIds.join("→"),
        nodes,
        length: nodes.length,
    };
}

export function scoreChain(chain, { beliefs, defaultBelief, chainStore, reasoningGraph } = {}) {
    if (!chain?.nodes?.length) return { ...chain, score: 0, readiness: 0, history: 0 };

    const masteries = chain.nodes.map((n) => n.probMastery);
    const readiness =
        masteries.reduce((s, m) => s + m, 0) / Math.max(masteries.length, 1);

    const history = chainStore?.historicalSuccessRate?.(chain.propIds) ?? 0.5;

    let transitionSupport = 0;
    let transitionCount = 0;
    if (reasoningGraph?.transitionCounts) {
        for (let i = 0; i < chain.propIds.length - 1; i++) {
            const key = `${chain.propIds[i]}→${chain.propIds[i + 1]}`;
            const alt = Object.values(reasoningGraph.transitionCounts).find(
                (t) => t.from === chain.propIds[i] && t.to === chain.propIds[i + 1]
            );
            if (alt) {
                transitionSupport += Math.min(1, alt.count / 5);
                transitionCount += 1;
            }
        }
    }
    const graphBoost =
        transitionCount > 0 ? transitionSupport / transitionCount : 0;

    const urgency = chain.nodes
        .filter((n) => !n.isTarget)
        .reduce((s, n) => s + (1 - n.probMastery), 0) / Math.max(chain.nodes.length - 1, 1);

    const score = 0.35 * readiness + 0.3 * history + 0.2 * graphBoost + 0.15 * urgency;

    return {
        ...chain,
        score,
        readiness,
        history,
        graphBoost,
        urgency,
    };
}

export function buildChainsForStep(
    propEngine,
    { lessonId, stepId, chainStore, reasoningGraph, maxChains = 8 } = {}
) {
    const lid = lessonId || propEngine.lessonId;
    const structure = propEngine.structureGraphs?.[lid];
    const stepContent = propEngine.stepContent?.[stepId];
    const beliefs = propEngine.getBeliefs?.() || {};
    const defaultBelief = propEngine.defaultBelief;

    if (!structure || !stepContent) {
        return { stepId, chains: [], answerPropId: null, ranking: null };
    }

    const ranking = rankPropositionsForStep(propEngine, { lessonId: lid, stepId, limit: 12 });
    const targetId = stepContent.answerPropId;

    let pathPropIds = [];
    if (targetId) {
        pathPropIds = enumerateChainsToTarget(structure, targetId, { maxChains });
    }

    if (pathPropIds.length === 0 && ranking.ranked?.length > 0) {
        const ordered = [...ranking.ranked]
            .filter((p) => p.sourceType !== "answer")
            .sort((a, b) => a.priority - b.priority)
            .map((p) => p.id);
        if (targetId) ordered.push(targetId);
        if (ordered.length > 0) pathPropIds = [ordered];
    }

    const remembered = chainStore?.getStepChain?.(stepId);
    if (remembered?.length) {
        pathPropIds.unshift(remembered);
    }

    const seen = new Set();
    const chains = [];
    for (const ids of pathPropIds) {
        const key = ids.join("→");
        if (seen.has(key)) continue;
        seen.add(key);
        const built = buildPropositionChain(structure, beliefs, ids, defaultBelief);
        chains.push(
            scoreChain(built, { beliefs, defaultBelief, chainStore, reasoningGraph })
        );
    }

    chains.sort((a, b) => b.score - a.score);

    return {
        stepId,
        answerPropId: targetId,
        ranking,
        chains,
        primaryChain: chains[0] || null,
        policyVersion: CHAIN_POLICY_VERSION,
    };
}

export function formatChainForPrompt(chain, { phaseLabel = "Reasoning chain" } = {}) {
    if (!chain?.nodes?.length) {
        return "(No reasoning chain available yet — use your knowledge of the step.)";
    }

    const lines = chain.nodes.map((n, i) => {
        const pct = Math.round((n.probMastery || 0) * 100);
        const role = n.isTarget ? "conclusion" : `step ${i + 1}`;
        return `${i + 1}. [${role}, ${pct}% known] ${n.text}`;
    });

    return `${phaseLabel} (follow in order toward the conclusion):\n${lines.join("\n")}`;
}

export function formatChainEvalSummary(chainResult) {
    if (!chainResult) return "";
    const { chain, reachedConclusion, attempt } = chainResult;
    const status = reachedConclusion ? "reached conclusion" : "did not reach conclusion";
    return `Chain score ${(chain?.score ?? 0).toFixed(2)} — ${status}${
        attempt ? ` (answer: ${String(attempt).slice(0, 60)})` : ""
    }`;
}

/**
 * Build ordered proposition ids from a hint pathway using structure nodes.
 */
export function chainFromHintPathway(structure, pathway, stepContent) {
    const ids = [];
    const seen = new Set();

    const visitHint = (hint) => {
        const hintId = hint.id;
        if (hintId) {
            for (const [propId, node] of Object.entries(structure?.nodes || {})) {
                if (node.hintId === hintId && !seen.has(propId)) {
                    seen.add(propId);
                    ids.push(propId);
                }
            }
        }
        (hint.subHints || []).forEach(visitHint);
    };

    (pathway || []).forEach(visitHint);

    if (stepContent?.answerPropId && !seen.has(stepContent.answerPropId)) {
        ids.push(stepContent.answerPropId);
    }

    return ids;
}

export function recordChainTransitions(reasoningGraph, propIds, meta = {}) {
    if (!reasoningGraph || !propIds || propIds.length < 2) return;
    for (let i = 0; i < propIds.length - 1; i++) {
        reasoningGraph.recordTransition(propIds[i], propIds[i + 1], {
            type: "prop-chain",
            ...meta,
        });
    }
}
