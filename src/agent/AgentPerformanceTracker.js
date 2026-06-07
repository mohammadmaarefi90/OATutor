/**
 * Tracks agent performance across training runs for growth visualization.
 */
export default class AgentPerformanceTracker {
    constructor(lessonId, agentType = "memory", initialData = null) {
        this.lessonId = lessonId;
        this.agentType = agentType;
        this.runs = initialData?.runs || [];
    }

    static fromJSON(data) {
        if (!data) return null;
        return new AgentPerformanceTracker(data.lessonId, data.agentType || "memory", data);
    }

    toJSON() {
        return {
            lessonId: this.lessonId,
            agentType: this.agentType,
            runs: this.runs,
            updatedAt: Date.now(),
        };
    }

    startRun() {
        return {
            runId: `run-${this.agentType}-${Date.now()}`,
            agentType: this.agentType,
            startedAt: Date.now(),
            endedAt: null,
            status: "running",
            problemsAttempted: 0,
            problemsCompleted: 0,
            stepsTotal: 0,
            stepsCorrectFirstTry: 0,
            stepsCorrectAfterLearning: 0,
            hintsConsumed: 0,
            propositionsLearned: 0,
            masteryStart: 0,
            masteryEnd: 0,
            memoryStart: {},
            memoryEnd: {},
            graphStart: {},
            graphEnd: {},
            events: [],
        };
    }

    finalizeRun(run, reason = "completed") {
        run.endedAt = Date.now();
        run.status = reason;
        run.durationMs = run.endedAt - run.startedAt;
        this.runs.push(run);
        return run;
    }

    getGrowthSummary() {
        if (this.runs.length === 0) return null;

        const latest = this.runs[this.runs.length - 1];
        const first = this.runs[0];

        return {
            totalRuns: this.runs.length,
            masteryGrowth: latest.masteryEnd - first.masteryStart,
            memoryGrowth:
                (latest.memoryEnd?.entryCount || 0) - (first.memoryStart?.entryCount || 0),
            graphGrowth:
                (latest.graphEnd?.nodeCount || 0) - (first.graphStart?.nodeCount || 0),
            avgFirstTryRate:
                this.runs.reduce((s, r) => {
                    const rate = r.stepsTotal > 0 ? r.stepsCorrectFirstTry / r.stepsTotal : 0;
                    return s + rate;
                }, 0) / this.runs.length,
            runs: this.runs.map((r) => ({
                runId: r.runId,
                date: new Date(r.startedAt).toLocaleString(),
                masteryEnd: Math.round((r.masteryEnd || 0) * 100),
                memoryEntries: r.memoryEnd?.entryCount || 0,
                graphNodes: r.graphEnd?.nodeCount || 0,
                firstTryRate:
                    r.stepsTotal > 0
                        ? Math.round((r.stepsCorrectFirstTry / r.stepsTotal) * 100)
                        : 0,
                durationSec: Math.round((r.durationMs || 0) / 1000),
            })),
        };
    }

    getLatestRun() {
        return this.runs.length > 0 ? this.runs[this.runs.length - 1] : null;
    }
}
