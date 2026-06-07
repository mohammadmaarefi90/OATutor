import { AGENT_META, ALL_AGENT_TYPES } from "./agentTypes.js";
import { compositeScore, normalizeAgentOutput } from "./agentMetrics.js";

function metricWinner(entries, key, higherIsBetter = true) {
    const sorted = [...entries].sort((a, b) =>
        higherIsBetter ? b[key] - a[key] : a[key] - b[key]
    );
    return sorted[0]?.agentType || null;
}

export function buildComparisonReport(agentOutputs) {
    const entries = ALL_AGENT_TYPES.filter((type) => agentOutputs[type]).map((type) => {
        const metrics = normalizeAgentOutput(type, agentOutputs[type]);
        return {
            ...metrics,
            compositeScore: compositeScore(metrics),
        };
    });

    const ranked = [...entries].sort((a, b) => b.compositeScore - a.compositeScore);

    const rankings = ranked.map((entry, index) => ({
        rank: index + 1,
        agentType: entry.agentType,
        agentLabel: entry.agentLabel,
        compositeScore: Math.round(entry.compositeScore * 1000) / 1000,
        highlights: {
            masteryEnd: entry.masteryEnd,
            masteryDelta: entry.masteryDelta,
            firstTryRate: entry.firstTryRate,
            problemsCompleted: entry.problemsCompleted,
        },
    }));

    const winner = ranked[0] || null;

    const categoryWinners = {
        masteryEnd: metricWinner(entries, "masteryEnd"),
        masteryDelta: metricWinner(entries, "masteryDelta"),
        firstTryRate: metricWinner(entries, "firstTryRate"),
        accuracyRate: metricWinner(entries, "accuracyRate"),
        problemsCompleted: metricWinner(entries, "problemsCompleted"),
        fewestHints: metricWinner(entries, "hintsConsumed", false),
        compositeScore: metricWinner(entries, "compositeScore"),
    };

    const summary = winner
        ? `${winner.agentLabel} ranked #1 overall (composite score ${rankings[0].compositeScore}). ` +
          `Best mastery: ${Math.round(winner.masteryEnd * 100)}%, ` +
          `first-try rate: ${Math.round(winner.firstTryRate * 100)}%, ` +
          `Δ mastery: +${Math.round(winner.masteryDelta * 100)}%.`
        : "No agent results to compare.";

    return {
        comparisonId: `cmp-${Date.now()}`,
        timestamp: Date.now(),
        agentCount: entries.length,
        agents: Object.fromEntries(entries.map((e) => [e.agentType, e])),
        rankings,
        categoryWinners: Object.fromEntries(
            Object.entries(categoryWinners).map(([k, v]) => [
                k,
                v ? { agentType: v, agentLabel: AGENT_META[v]?.label || v } : null,
            ])
        ),
        winner: winner
            ? {
                  agentType: winner.agentType,
                  agentLabel: winner.agentLabel,
                  compositeScore: rankings[0].compositeScore,
              }
            : null,
        summary,
        rawOutputs: agentOutputs,
    };
}
