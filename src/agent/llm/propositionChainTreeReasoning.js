/**
 * Beam-search tree expansion over proposition chains.
 * At each leaf, extend with the most relevant next idea (structure + Prop BKT ranking).
 */

import { rankPropositionsForStep } from "./propositionPolicy.js";
import {
    buildPropositionChain,
    scoreChain,
    enumerateChainsToTarget,
    CHAIN_POLICY_VERSION,
} from "./propositionChainReasoning.js";

export const CHAIN_TREE_POLICY_VERSION = "prop-chain-tree-v1";

const STRUCTURAL_TYPES = new Set([
    "sequence",
    "prerequisite",
    "supports",
    "depends",
    "step-to-hint",
]);

export const DEFAULT_TREE_OPTIONS = {
    beamWidth: 3,
    maxDepth: 8,
    maxChains: 10,
    maxAttempts: 4,
};

function getClosureSet(structure, stepContent) {
    const targetId = stepContent?.answerPropId;
    if (targetId && structure?.getPrerequisiteClosure) {
        return structure.getPrerequisiteClosure(targetId);
    }
    const ids = new Set(stepContent?.stepPropIds || []);
    if (targetId) ids.add(targetId);
    return ids;
}

/**
 * Rank candidate next propositions for extending a partial path.
 */
export function getNextCandidatesForPath(
    structure,
    ranking,
    path,
    targetId,
    closureSet
) {
    const onPath = new Set(path);
    const lastId = path.length ? path[path.length - 1] : null;
    const scored = new Map();

    const add = (id, boost = 0) => {
        if (!id || onPath.has(id) || !structure?.nodes?.[id]) return;
        if (closureSet.size > 0 && !closureSet.has(id)) return;
        const rankEntry = ranking?.ranked?.find((r) => r.id === id);
        const priority = (rankEntry?.priority ?? 0) + boost;
        const prev = scored.get(id);
        if (!prev || priority > prev.priority) {
            scored.set(id, { id, priority });
        }
    };

    if (!lastId) {
        for (const r of ranking?.ranked || []) {
            if (r.sourceType !== "answer") add(r.id, 0);
        }
        if (targetId) add(targetId, -0.1);
    } else {
        for (const edge of structure.edges || []) {
            if (edge.from === lastId && STRUCTURAL_TYPES.has(edge.type)) {
                add(edge.to, 0.45);
            }
        }
        for (const r of ranking?.ranked || []) {
            if (r.sourceType !== "answer" && r.id !== lastId) add(r.id, 0);
        }
        if (targetId && !onPath.has(targetId)) {
            add(targetId, 0.25);
        }
    }

    return [...scored.values()]
        .sort((a, b) => b.priority - a.priority)
        .map((x) => x.id);
}

function finalizePath(path, targetId) {
    if (!targetId || path.includes(targetId)) return [...path];
    return [...path, targetId];
}

/**
 * Beam-search: grow chains from relevant roots, extend each leaf by relevance.
 */
export function buildChainTreeForStep(
    propEngine,
    {
        lessonId,
        stepId,
        chainStore,
        reasoningGraph,
        beamWidth = DEFAULT_TREE_OPTIONS.beamWidth,
        maxDepth = DEFAULT_TREE_OPTIONS.maxDepth,
        maxChains = DEFAULT_TREE_OPTIONS.maxChains,
    } = {}
) {
    const lid = lessonId || propEngine.lessonId;
    const structure = propEngine.structureGraphs?.[lid];
    const stepContent = propEngine.stepContent?.[stepId];
    const beliefs = propEngine.getBeliefs?.() || {};
    const defaultBelief = propEngine.defaultBelief;

    if (!structure || !stepContent) {
        return {
            stepId,
            chains: [],
            answerPropId: null,
            ranking: null,
            treeMeta: null,
            policyVersion: CHAIN_TREE_POLICY_VERSION,
        };
    }

    const ranking = rankPropositionsForStep(propEngine, { lessonId: lid, stepId, limit: 16 });
    const targetId = stepContent.answerPropId;
    const closureSet = getClosureSet(structure, stepContent);

    const seen = new Set();
    const completeChains = [];
    let branchesExplored = 0;

    const rememberAndAdd = (propIds) => {
        const built = buildPropositionChain(structure, beliefs, propIds, defaultBelief);
        const scored = scoreChain(built, {
            beliefs,
            defaultBelief,
            chainStore,
            reasoningGraph,
        });
        if (seen.has(scored.key)) return;
        seen.add(scored.key);
        completeChains.push({ ...scored, treeDepth: propIds.length });
    };

    const remembered = chainStore?.getStepChain?.(stepId);
    if (remembered?.length) rememberAndAdd(remembered);

    if (targetId) {
        for (const path of enumerateChainsToTarget(structure, targetId, { maxChains: 6 })) {
            rememberAndAdd(path);
        }
    }

    let beam = [[]];

    for (let depth = 0; depth < maxDepth; depth++) {
        const nextBeam = [];

        for (const path of beam) {
            if (targetId && path.length > 0 && path[path.length - 1] === targetId) {
                rememberAndAdd(path);
                continue;
            }

            const candidates = getNextCandidatesForPath(
                structure,
                ranking,
                path,
                targetId,
                closureSet
            ).slice(0, beamWidth);

            branchesExplored += candidates.length;

            if (candidates.length === 0) {
                if (path.length > 0 && targetId) {
                    rememberAndAdd(finalizePath(path, targetId));
                }
                continue;
            }

            for (const nextId of candidates) {
                const newPath = path.length === 0 ? [nextId] : [...path, nextId];
                if (targetId && nextId === targetId) {
                    rememberAndAdd(newPath);
                } else {
                    nextBeam.push(newPath);
                }
            }
        }

        beam = nextBeam
            .map((path) => {
                const built = buildPropositionChain(structure, beliefs, path, defaultBelief);
                return scoreChain(built, {
                    beliefs,
                    defaultBelief,
                    chainStore,
                    reasoningGraph,
                });
            })
            .sort((a, b) => b.score - a.score)
            .slice(0, beamWidth)
            .map((c) => c.propIds);

        if (completeChains.length >= maxChains) break;
    }

    for (const path of beam) {
        if (path.length > 0) {
            rememberAndAdd(targetId ? finalizePath(path, targetId) : path);
        }
    }

    completeChains.sort((a, b) => b.score - a.score);

    return {
        stepId,
        answerPropId: targetId,
        ranking,
        chains: completeChains.slice(0, maxChains),
        primaryChain: completeChains[0] || null,
        treeMeta: {
            beamWidth,
            maxDepth,
            branchesExplored,
            completeCount: completeChains.length,
            basePolicy: CHAIN_POLICY_VERSION,
        },
        policyVersion: CHAIN_TREE_POLICY_VERSION,
    };
}

export function formatChainTreeSummary(treeContext) {
    if (!treeContext?.treeMeta) return "";
    const m = treeContext.treeMeta;
    return `Beam tree (width ${m.beamWidth}, depth ≤${m.maxDepth}): explored ${m.branchesExplored} branch(es), ${m.completeCount} chain(s) ranked.`;
}
