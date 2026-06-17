/**
 * Training "write path" — how hints are revealed during Prop BKT training.
 * Closes the loop with the hint planner: reveal targeted hints, update beliefs,
 * optionally retry the LLM, instead of dumping the full pathway at once.
 */

import { rankPropositionsForStep } from "./propositionPolicy.js";
import {
    buildStepPlan,
    mapRelevantHints,
    selectPivotIdeas,
} from "./propositionHintPlanner.js";

export const PROP_TRAINING_HINT_MODES = {
    FULL_PATHWAY: "full-pathway",
    PARTIAL_SEQUENTIAL: "partial-sequential",
    PLANNER_GUIDED: "planner-guided",
};

export const PROP_TRAINING_HINT_MODE_META = {
    [PROP_TRAINING_HINT_MODES.FULL_PATHWAY]: {
        label: "Full pathway (legacy)",
        description:
            "On failure, reveal every hint in pathway order — original behavior.",
    },
    [PROP_TRAINING_HINT_MODES.PARTIAL_SEQUENTIAL]: {
        label: "Partial sequential",
        description:
            "Reveal one hint at a time in pathway order; optional LLM retry after each.",
    },
    [PROP_TRAINING_HINT_MODES.PLANNER_GUIDED]: {
        label: "Planner-guided (recommended)",
        description:
            "Reveal the hint best matching planner pivots / relevance scores; retry LLM as beliefs update.",
    },
};

export const TRAINING_PATH_VERSION = "prop-training-write-v1";

export function resolvePropTrainingHintMode(settings) {
    return (
        settings?.propTrainingHintMode ||
        PROP_TRAINING_HINT_MODES.PLANNER_GUIDED
    );
}

export function isFullPathwayTrainingMode(settings) {
    return resolvePropTrainingHintMode(settings) === PROP_TRAINING_HINT_MODES.FULL_PATHWAY;
}

function normalizeRevealedIds(revealedHintIds) {
    if (revealedHintIds instanceof Set) return revealedHintIds;
    return new Set(revealedHintIds || []);
}

function hintFromPathway(pathway, hintId) {
    const hint = pathway.find((h) => h.id === hintId);
    if (!hint) return null;
    return { hint, pathwayIndex: pathway.indexOf(hint) };
}

function pickWeakestChainHint(propEngine, plan, pathway, revealed) {
    const chain = plan?.primaryChain || plan?.candidateChains?.[0];
    if (!chain?.nodes?.length) return null;

    const structure = propEngine.structureGraphs?.[propEngine.lessonId];
    let weakest = null;

    for (const node of chain.nodes) {
        if (node.isTarget) continue;
        const mastery = node.probMastery ?? 0;
        if (weakest && mastery >= weakest.mastery) continue;

        const structNode = structure?.nodes?.[node.id];
        const hintId = structNode?.hintId;
        if (!hintId || revealed.has(hintId)) continue;

        const match = hintFromPathway(pathway, hintId);
        if (match) {
            weakest = { ...match, reason: "weakest-chain-link", propId: node.id, probMastery: mastery };
        }
    }

    return weakest;
}

/**
 * Select the next hint to reveal during training (partial / planner-guided modes).
 */
export function selectNextTrainingHint(
    propEngine,
    {
        lessonId,
        stepId,
        pathway = [],
        revealedHintIds = [],
        settings = {},
    } = {}
) {
    const revealed = normalizeRevealedIds(revealedHintIds);
    const unrevealed = pathway.filter((h) => h?.id && !revealed.has(h.id));
    if (unrevealed.length === 0) return null;

    const mode = resolvePropTrainingHintMode(settings);
    const lid = lessonId || propEngine.lessonId;

    if (mode === PROP_TRAINING_HINT_MODES.PARTIAL_SEQUENTIAL) {
        const hint = unrevealed[0];
        return {
            hint,
            pathwayIndex: pathway.indexOf(hint),
            reason: "pathway-order",
            trainingMode: mode,
        };
    }

    if (mode !== PROP_TRAINING_HINT_MODES.PLANNER_GUIDED) {
        return null;
    }

    const plan = buildStepPlan(propEngine, { lessonId: lid, stepId, settings });

    for (const rh of plan.relevantHints || []) {
        if (revealed.has(rh.hintId)) continue;
        const match = hintFromPathway(pathway, rh.hintId);
        if (match) {
            return {
                ...match,
                reason: "planner-relevance",
                propId: rh.propId,
                relevanceScore: rh.relevanceScore,
                probMastery: rh.probMastery,
                trainingMode: mode,
            };
        }
    }

    for (const pivot of plan.pivots || []) {
        if (pivot.hintId && !revealed.has(pivot.hintId)) {
            const match = hintFromPathway(pathway, pivot.hintId);
            if (match) {
                return {
                    ...match,
                    reason: "pivot-hint",
                    propId: pivot.id,
                    probMastery: pivot.probMastery,
                    trainingMode: mode,
                };
            }
        }
    }

    const weakest = pickWeakestChainHint(propEngine, plan, pathway, revealed);
    if (weakest) return weakest;

    const ranking = plan.ranking || rankPropositionsForStep(propEngine, { lessonId: lid, stepId });
    const pivots = selectPivotIdeas(ranking, {
        maxPivots: settings.propPlanningMaxPivots ?? 3,
    });
    const stepContent = propEngine.stepContent?.[stepId];
    const hintPropMap = stepContent?.hintPropMap || {};

    for (const pivot of pivots) {
        for (const [hintId, propIds] of Object.entries(hintPropMap)) {
            if (!propIds.includes(pivot.id) || revealed.has(hintId)) continue;
            const match = hintFromPathway(pathway, hintId);
            if (match) {
                return {
                    ...match,
                    reason: "pivot-hint-map",
                    propId: pivot.id,
                    probMastery: pivot.probMastery,
                    trainingMode: mode,
                };
            }
        }
    }

    const hint = unrevealed[0];
    return {
        hint,
        pathwayIndex: pathway.indexOf(hint),
        reason: "pathway-fallback",
        trainingMode: mode,
    };
}

/**
 * Resolve final answer after partial training reveals (no full-pathway dump).
 */
export function resolveTrainingAnswer(pathway, revealedHintIds, step, settings) {
    const revealed = normalizeRevealedIds(revealedHintIds);
    const revealedPathway = pathway.filter((h) => revealed.has(h.id));

    for (let i = revealedPathway.length - 1; i >= 0; i--) {
        const hint = revealedPathway[i];
        if (hint.hintAnswer?.length > 0) return hint.hintAnswer[0];
        for (const sub of hint.subHints || []) {
            if (sub.hintAnswer?.length > 0) return sub.hintAnswer[0];
        }
    }

    if (settings?.propTrainingAllowAnswerKey !== false) {
        return step.stepAnswer?.[0] || null;
    }
    return null;
}

export function summarizeTrainingRevealForEvent(selection, { hintsRevealedTotal = 0 } = {}) {
    if (!selection?.hint) return null;
    return {
        hintId: selection.hint.id,
        pathwayIndex: selection.pathwayIndex,
        reason: selection.reason,
        trainingMode: selection.trainingMode,
        propId: selection.propId || null,
        relevanceScore: selection.relevanceScore ?? null,
        hintsRevealedTotal,
    };
}
