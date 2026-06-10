/**
 * Produce an evaluation copy of a problem with tutoring clues removed.
 * stepAnswer is retained for grading only (agents must not use it as a fallback).
 */

function stripStep(step) {
    if (!step) return step;
    return {
        ...step,
        hints: {},
    };
}

/**
 * Clone a problem with all hint pathways cleared for strict no-clue evaluation.
 */
export function stripCluesFromProblem(problem) {
    if (!problem) return problem;
    return {
        ...problem,
        steps: (problem.steps || []).map(stripStep),
    };
}
