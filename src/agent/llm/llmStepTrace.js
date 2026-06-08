import { chooseVariables } from "../../platform-logic/renderText.js";

/**
 * Display string for the expected step answer (first acceptable answer).
 */
export function getExpectedAnswerDisplay(step, seed) {
    if (!step?.stepAnswer?.length) return null;
    chooseVariables(step.variabilization || {}, seed || "trace");
    const first = step.stepAnswer[0];
    if (first == null) return null;
    return String(first);
}

/**
 * Normalized snapshot of one LLM call for solve traces and UI panels.
 */
export function buildLLMStepSnapshot(llmResult, { correct = null, error = null } = {}) {
    if (!llmResult) return null;

    const attempt =
        llmResult.parsedAttempt ?? llmResult.answer ?? llmResult.attempt ?? null;

    return {
        attempt,
        content: llmResult.content ?? null,
        rawText: llmResult.rawText ?? null,
        reasoning: llmResult.reasoning ?? null,
        provider: llmResult.provider ?? null,
        correct,
        error: error ?? llmResult.error ?? null,
    };
}

/**
 * Final submitted answer after hints (if any).
 */
export function buildLLMAfterSnapshot({
    attempt,
    correct,
    usedHints = false,
    source = null,
}) {
    return {
        attempt,
        correct,
        usedHints,
        source,
    };
}
