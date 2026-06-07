/**
 * Standard 4-parameter BKT update — ported from OATutor BKT-brain.js.
 * @param {import('./BeliefModel.js').DEFAULT_BELIEF} model - belief model (mutated in place)
 * @param {boolean} isCorrect - observation
 */
export function updateBelief(model, isCorrect) {
    let numerator;
    let masteryAndGuess;
    if (isCorrect) {
        numerator = model.probMastery * (1 - model.probSlip);
        masteryAndGuess = (1 - model.probMastery) * model.probGuess;
    } else {
        numerator = model.probMastery * model.probSlip;
        masteryAndGuess = (1 - model.probMastery) * (1 - model.probGuess);
    }

    const probMasteryGivenObservation = numerator / (numerator + masteryAndGuess);
    model.probMastery =
        probMasteryGivenObservation + (1 - probMasteryGivenObservation) * model.probTransit;
}

/**
 * Weighted BKT update for softer evidence (e.g. hint reveals).
 * Applies updateBelief then blends toward prior by (1 - weight).
 */
export function updateBeliefWeighted(model, isCorrect, weight = 0.5) {
    const prior = model.probMastery;
    updateBelief(model, isCorrect);
    model.probMastery = prior + weight * (model.probMastery - prior);
}
