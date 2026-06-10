import { ALL_AGENT_TYPES, AGENT_META } from "./agentTypes.js";
import { AGENT_EVALUATION_STORAGE_KEY } from "./storageKeys.js";

export function buildEvaluationReport(problemResults, { agentTypes = ALL_AGENT_TYPES } = {}) {
    const byAgent = {};
    agentTypes.forEach((type) => {
        const results = problemResults.filter((r) => r.agentType === type);
        byAgent[type] = {
            agentType: type,
            agentLabel: AGENT_META[type].label,
            problemsEvaluated: results.length,
            problemsCorrect: results.filter((r) => r.correct).length,
            avgFirstTryRate:
                results.length > 0
                    ? results.reduce((s, r) => s + r.firstTryRate, 0) / results.length
                    : 0,
            results,
            cumulativeReasoning: results.length > 0 ? results[results.length - 1].reasoningDAG : null,
        };
    });

    const ranked = agentTypes.map((type) => ({
        agentType: type,
        agentLabel: AGENT_META[type].label,
        score:
            byAgent[type].problemsCorrect / Math.max(byAgent[type].problemsEvaluated, 1) +
            byAgent[type].avgFirstTryRate,
        ...byAgent[type],
    })).sort((a, b) => b.score - a.score);

    return {
        evaluationId: `eval-${Date.now()}`,
        timestamp: Date.now(),
        byAgent,
        rankings: ranked.map((r, i) => ({ rank: i + 1, ...r })),
        winner: ranked[0] || null,
        problemResults,
        agentTypes,
    };
}

export async function saveEvaluationReport(browserStorage, lessonId, report) {
    if (!browserStorage) return;
    await browserStorage
        .setByKey(AGENT_EVALUATION_STORAGE_KEY(lessonId), report)
        .catch(() => {});
}
