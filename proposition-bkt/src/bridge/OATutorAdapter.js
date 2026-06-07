/**
 * Future OATutor adapter sketch — maps live OATutor events to library events.
 * Not wired into OATutor in v1; opt-in via thin adapter later.
 */

export function mapOATutorAttempt(oatutorEvent) {
    return {
        type: "attempt",
        timestamp: oatutorEvent.timestamp ?? Date.now(),
        problemId: oatutorEvent.problemId,
        stepId: oatutorEvent.stepId,
        correct: Boolean(oatutorEvent.correct),
        firstTry: oatutorEvent.firstTry !== false,
        propIds: oatutorEvent.propIds,
        hintsSeen: oatutorEvent.hintsSeen || [],
    };
}

export function mapOATutorHintReveal(oatutorEvent) {
    return {
        type: "hint_reveal",
        timestamp: oatutorEvent.timestamp ?? Date.now(),
        stepId: oatutorEvent.stepId,
        hintId: oatutorEvent.hintId,
        pathwayIndex: oatutorEvent.hintIndex ?? 0,
        propIds: oatutorEvent.propIds,
    };
}

export function mapOATutorEvent(oatutorEvent) {
    if (oatutorEvent.type === "hint_reveal" || oatutorEvent.hintId != null) {
        return mapOATutorHintReveal(oatutorEvent);
    }
    return mapOATutorAttempt(oatutorEvent);
}
