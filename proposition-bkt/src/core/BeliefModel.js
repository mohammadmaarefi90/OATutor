/**
 * Default 4-parameter BKT belief model for a single proposition.
 * Only probMastery is updated during learning (matches OATutor convention).
 */
export const DEFAULT_BELIEF = {
    probMastery: 0.1,
    probSlip: 0.1,
    probGuess: 0.1,
    probTransit: 0.1,
};

export function cloneBeliefModel(model = DEFAULT_BELIEF) {
    return {
        probMastery: model.probMastery,
        probSlip: model.probSlip,
        probGuess: model.probGuess,
        probTransit: model.probTransit,
    };
}

export function isMastered(model, threshold = 0.95) {
    return model.probMastery >= threshold;
}
