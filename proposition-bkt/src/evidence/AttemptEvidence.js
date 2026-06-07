import { updateBelief } from "../core/PropositionBKT.js";

/**
 * Apply attempt evidence to active propositions.
 */
export function applyAttemptEvidence(beliefStore, structureGraph, event, config = {}) {
    const { firstTryOnly = true, masteryThreshold = 0.95 } = config;

    if (firstTryOnly && event.firstTry === false) {
        return { updated: [], skipped: true };
    }

    const propIds = event.propIds || [];
    const updated = [];

    for (const propId of propIds) {
        const model = beliefStore.getBelief(propId);
        updateBelief(model, event.correct);
        updated.push({ propId, probMastery: model.probMastery });
    }

    if (event.correct) {
        for (const propId of propIds) {
            const prereqs = structureGraph.getPrerequisiteClosure(propId);
            for (const pid of prereqs) {
                if (propIds.includes(pid)) continue;
                const model = beliefStore.getBelief(pid);
                if (model.probMastery >= masteryThreshold) {
                    updateBelief(model, true);
                    updated.push({ propId: pid, probMastery: model.probMastery, chain: true });
                }
            }
        }
    }

    return { updated, skipped: false };
}

export function getActivePropositionsForAttempt(session, stepContent) {
    const active = new Set();

    for (const id of stepContent.stepPropIds || []) active.add(id);
    if (stepContent.answerPropId) active.add(stepContent.answerPropId);

    for (const hintId of session.hintsRevealed || []) {
        const props = session.hintPropMap?.[hintId] || [];
        props.forEach((id) => active.add(id));
    }

    if (session.lastActivePropId) active.add(session.lastActivePropId);

    return [...active];
}
