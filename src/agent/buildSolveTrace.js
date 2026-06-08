function formatTimelineEvent(event) {
    switch (event.type) {
        case "step-start":
            return "Started step";
        case "recall":
            return `Recalled answer: "${truncate(event.attempt)}" → ${event.isCorrect ? "correct" : "wrong"} (confidence ${Math.round((event.confidence || 0) * 100)}%)`;
        case "learn":
            return `Read ${event.hintsReviewed || 0} hint(s) from pathway`;
        case "rl-action":
            return `RL chose action: ${event.action} (state: ${event.state})`;
        case "llm-response":
            return `LLM answered: "${truncate(event.attempt)}"`;
        case "llm-error":
            return `LLM error: ${event.message || "unknown"}`;
        case "step-complete":
            return `Submitted: "${truncate(event.attempt)}" → ${event.isCorrect ? "✓ correct" : "✗ incorrect"}${event.firstTry ? " (first try)" : ""}${event.reward != null ? ` [r=${event.reward}]` : ""}${event.source ? ` via ${event.source}` : ""}`;
        default:
            return event.type;
    }
}

function truncate(text, len = 80) {
    if (!text) return "?";
    const s = String(text);
    return s.length > len ? `${s.slice(0, len)}…` : s;
}

export function buildSolveTrace(problem, run, sessionReasoning = null) {
    if (!problem?.steps) return null;

    return {
        problemId: problem.id,
        title: problem.title,
        problemBody: problem.body || "",
        steps: problem.steps.map((step, index) => {
            const stepEvents = (run?.events || []).filter((e) => e.stepId === step.id);
            const trace = sessionReasoning?.stepTraces?.find((t) => t.stepId === step.id);
            const complete = stepEvents.find((e) => e.type === "step-complete");
            const llmResponse = stepEvents.find((e) => e.type === "llm-response");

            return {
                stepIndex: index + 1,
                stepId: step.id,
                stepTitle: step.stepTitle || "",
                stepBody: step.stepBody || "",
                answerType: step.answerType,
                actions: trace?.actions || [],
                timeline: stepEvents.map((e) => ({
                    type: e.type,
                    label: formatTimelineEvent(e),
                    timestamp: e.timestamp,
                })),
                attempt: complete?.attempt ?? trace?.result?.attempt,
                isCorrect: complete?.isCorrect ?? trace?.result?.isCorrect,
                firstTry: complete?.firstTry,
                reward: complete?.reward,
                rlAction: complete?.action,
                source: complete?.source,
                expectedAnswer: complete?.expectedAnswer ?? null,
                llmBefore: complete?.llmBefore ?? null,
                llmAfter: complete?.llmAfter ?? null,
                llmResponse: llmResponse
                    ? {
                          attempt: llmResponse.attempt,
                          rawText: llmResponse.rawText,
                          reasoning: llmResponse.reasoning,
                          provider: llmResponse.provider,
                      }
                    : null,
            };
        }),
    };
}

export { formatTimelineEvent, truncate };
