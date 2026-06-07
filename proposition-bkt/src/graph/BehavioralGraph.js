/**
 * Behavioral transition graph — P(to|from) from session counts.
 * Adapted from OATutor ReasoningGraph (read-only reference).
 */
export default class BehavioralGraph {
    constructor(lessonId, initialData = null) {
        this.lessonId = lessonId;
        this.transitionCounts = initialData?.transitionCounts || {};
        this.totalTransitions = initialData?.totalTransitions || 0;
    }

    static fromJSON(data) {
        if (!data) return null;
        return new BehavioralGraph(data.lessonId, data);
    }

    toJSON() {
        return {
            lessonId: this.lessonId,
            transitionCounts: { ...this.transitionCounts },
            totalTransitions: this.totalTransitions,
            updatedAt: Date.now(),
        };
    }

    _transitionKey(from, to) {
        return `${from}→${to}`;
    }

    recordTransition(fromId, toId, meta = {}) {
        if (!fromId || !toId || fromId === toId) return;
        const key = this._transitionKey(fromId, toId);
        if (!this.transitionCounts[key]) {
            this.transitionCounts[key] = {
                from: fromId,
                to: toId,
                count: 0,
                type: meta.type || "reasoning",
                labels: [],
            };
        }
        this.transitionCounts[key].count += 1;
        if (meta.label) {
            this.transitionCounts[key].labels.push(meta.label);
        }
        this.totalTransitions += 1;
    }

    getTransitionProbabilities() {
        const outgoing = {};
        for (const t of Object.values(this.transitionCounts)) {
            if (!outgoing[t.from]) outgoing[t.from] = [];
            outgoing[t.from].push(t);
        }

        const edges = [];
        for (const transitions of Object.values(outgoing)) {
            const total = transitions.reduce((s, t) => s + t.count, 0);
            for (const t of transitions) {
                edges.push({
                    from: t.from,
                    to: t.to,
                    count: t.count,
                    probability: total > 0 ? t.count / total : 0,
                    type: t.type,
                    label: t.labels[t.labels.length - 1] || "",
                });
            }
        }
        return edges;
    }
}
