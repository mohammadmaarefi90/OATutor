function formatTimelineEvent(event) {
    switch (event.type) {
        case "step-start":
            return "The agent began working on this step.";
        case "recall":
            return `From memory, the agent tried "${truncate(event.attempt)}" — that was ${
                event.isCorrect ? "correct" : "incorrect"
            } (${Math.round((event.confidence || 0) * 100)}% confidence).`;
        case "learn":
            return `The agent read ${event.hintsReviewed || 0} tutoring hint(s) for this step.`;
        case "rl-action":
            return `The reinforcement-learning agent chose the action "${event.action}" (internal state: ${event.state}).`;
        case "llm-response":
            return `The language model answered "${truncate(event.attempt)}".`;
        case "llm-error":
            return `The language model call failed: ${event.message || "unknown error"}.`;
        case "prop-policy":
            return event.primarySuggestion?.text
                ? `The agent focused on this idea: "${truncate(event.primarySuggestion.text)}"`
                : "The agent ranked tutoring ideas for this step using proposition beliefs.";
        case "prop-chain-candidates":
            return `The agent ranked ${event.chains?.length || 0} reasoning chain(s)${
                event.strictNoClues ? " (strict no-clue test)" : ""
            }.`;
        case "prop-chain-tree-candidates":
            return (
                event.treeSummary ||
                `Beam tree ranked ${event.chains?.length || 0} chain branch(es)${
                    event.strictNoClues ? " (strict no-clue test)" : ""
                }.`
            );
        case "prop-chain-eval":
            return event.evalSummary || `Chain evaluation: ${event.reachedConclusion ? "reached conclusion" : "did not reach conclusion"}.`;
        case "prop-chain-learned":
            return `Learned a reasoning chain from hints (${event.chainKey || "path"}).`;
        case "hint-retrieval":
            return `Hints were selected using the "${event.hintRetrievalLabel || event.hintRetrievalMode || "default"}" retrieval policy.`;
        case "step-complete":
            return `The agent submitted "${truncate(event.attempt)}" — ${
                event.isCorrect ? "correct" : "incorrect"
            }${event.firstTry ? " on the first try" : " after using hints"}${
                event.source ? ` (via ${event.source})` : ""
            }.`;
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

    const runStrictNoClues = run?.strictNoClues ?? null;

    return {
        problemId: problem.id,
        title: problem.title,
        problemBody: problem.body || "",
        steps: problem.steps.map((step, index) => {
            const stepEvents = (run?.events || []).filter((e) => e.stepId === step.id);
            const trace = sessionReasoning?.stepTraces?.find((t) => t.stepId === step.id);
            const complete = stepEvents.find((e) => e.type === "step-complete");
            const llmResponse = stepEvents.find((e) => e.type === "llm-response");
            const propPolicyEvent = stepEvents.find((e) => e.type === "prop-policy");
            const chainCandidatesEvent =
                stepEvents.find((e) => e.type === "prop-chain-tree-candidates") ||
                stepEvents.find((e) => e.type === "prop-chain-candidates");
            const chainEvalEvents = stepEvents.filter((e) => e.type === "prop-chain-eval");
            const hintRetrievalEvent = stepEvents.find((e) => e.type === "hint-retrieval");

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
                propBeliefDeltas: complete?.propBeliefDeltas || null,
                propPolicySuggestion:
                    complete?.propPolicySuggestion || propPolicyEvent?.primarySuggestion || null,
                policyVersion: complete?.policyVersion || null,
                hintRetrievalMode:
                    complete?.hintRetrievalMode || hintRetrievalEvent?.hintRetrievalMode || null,
                hintRetrievalLabel:
                    complete?.hintRetrievalLabel || hintRetrievalEvent?.hintRetrievalLabel || null,
                bktMode: complete?.bktMode || null,
                strictNoClues:
                    complete?.strictNoClues ??
                    chainCandidatesEvent?.strictNoClues ??
                    runStrictNoClues,
                chainUsed: complete?.chainUsed || null,
                chainCandidates: complete?.chainCandidates ?? chainCandidatesEvent?.chains?.length ?? null,
                chainTreeMeta: chainCandidatesEvent?.treeMeta || null,
                chainsTried: complete?.chainsTried || chainEvalEvents.map((e) => ({
                    key: e.chainKey,
                    score: e.chainScore,
                    reachedConclusion: e.reachedConclusion,
                })),
            };
        }),
    };
}

export { formatTimelineEvent, truncate };
