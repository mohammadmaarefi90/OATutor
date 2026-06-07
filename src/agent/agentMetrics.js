import { AGENT_META } from "./agentTypes.js";

export function normalizeAgentOutput(agentType, output) {
    const { run, memoryStats, graphStats, bktSnapshot, agentExtras = {} } = output;
    const stepsTotal = run.stepsTotal || 0;

    return {
        agentType,
        agentLabel: AGENT_META[agentType]?.label || agentType,
        runId: run.runId,
        status: run.status,
        durationMs: run.durationMs || 0,
        durationSec: Math.round((run.durationMs || 0) / 1000),
        problemsAttempted: run.problemsAttempted || 0,
        problemsCompleted: run.problemsCompleted || 0,
        stepsTotal,
        stepsCorrectFirstTry: run.stepsCorrectFirstTry || 0,
        stepsCorrectAfterLearning: run.stepsCorrectAfterLearning || 0,
        hintsConsumed: run.hintsConsumed || 0,
        masteryStart: run.masteryStart || 0,
        masteryEnd: run.masteryEnd || 0,
        masteryDelta: (run.masteryEnd || 0) - (run.masteryStart || 0),
        firstTryRate: stepsTotal > 0 ? (run.stepsCorrectFirstTry || 0) / stepsTotal : 0,
        accuracyRate:
            stepsTotal > 0
                ? ((run.stepsCorrectFirstTry || 0) + (run.stepsCorrectAfterLearning || 0)) /
                  stepsTotal
                : 0,
        memoryEntries: memoryStats?.entryCount || 0,
        graphNodes: graphStats?.nodeCount || 0,
        graphEdges: graphStats?.edgeCount || 0,
        bktSnapshot: bktSnapshot || {},
        graduated: run.status === "completed" && (run.masteryEnd || 0) >= 0.95,
        ...agentExtras,
    };
}

export function compositeScore(metrics) {
    return (
        metrics.masteryEnd * 0.35 +
        metrics.masteryDelta * 0.25 +
        metrics.firstTryRate * 0.25 +
        metrics.accuracyRate * 0.1 +
        (metrics.problemsCompleted / Math.max(metrics.problemsAttempted, 1)) * 0.05
    );
}
