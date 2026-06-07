import { updateBeliefWeighted } from "../core/PropositionBKT.js";

/**
 * Hint reveal as weighted positive evidence on hint propositions.
 */
export function applyHintEvidence(beliefStore, structureGraph, event, config = {}) {
    const { hintEvidenceWeight = 0.5 } = config;
    const updated = [];

    for (const propId of event.propIds || []) {
        const model = beliefStore.getBelief(propId);
        updateBeliefWeighted(model, true, hintEvidenceWeight);
        updated.push({ propId, probMastery: model.probMastery, effect: "support" });
    }

    for (const propId of event.propIds || []) {
        const contradicts = structureGraph.getContradicting(propId);
        for (const altId of contradicts) {
            const model = beliefStore.getBelief(altId);
            updateBeliefWeighted(model, false, hintEvidenceWeight * 0.5);
            updated.push({ propId: altId, probMastery: model.probMastery, effect: "contradict" });
        }
    }

    return { updated };
}

export function applyWrongPathAfterHint(beliefStore, pathwayPropIds, config = {}) {
    const { hintEvidenceWeight = 0.5 } = config;
    const updated = [];
    for (const propId of pathwayPropIds) {
        const model = beliefStore.getBelief(propId);
        updateBeliefWeighted(model, false, hintEvidenceWeight * 0.3);
        updated.push({ propId, probMastery: model.probMastery, effect: "wrong-path" });
    }
    return { updated };
}
