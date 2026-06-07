import { getActivePropositionsForAttempt } from "./AttemptEvidence.js";

/**
 * Map raw tutoring events to normalized evidence payloads.
 */
export function mapAttemptEvent(event, session, stepContent) {
    const propIds = event.propIds?.length
        ? event.propIds
        : getActivePropositionsForAttempt(session, stepContent);

    return {
        type: "attempt",
        timestamp: event.timestamp ?? Date.now(),
        problemId: event.problemId,
        stepId: event.stepId,
        propIds,
        correct: Boolean(event.correct),
        firstTry: event.firstTry !== false,
    };
}

export function mapHintRevealEvent(event, hintPropMap) {
    const propIds =
        event.propIds?.length ||
        hintPropMap[event.hintId] ||
        [];

    return {
        type: "hint_reveal",
        timestamp: event.timestamp ?? Date.now(),
        stepId: event.stepId,
        hintId: event.hintId,
        propIds,
        pathwayIndex: event.pathwayIndex ?? 0,
    };
}
