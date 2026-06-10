/**
 * Persists success/failure stats for proposition reasoning chains (per lesson).
 */

export default class ChainReasoningStore {
    constructor(lessonId, initialData = null) {
        this.lessonId = lessonId;
        this.chainStats = initialData?.chainStats || {};
        this.stepChainIndex = initialData?.stepChainIndex || {};
        this.updatedAt = initialData?.updatedAt || Date.now();
    }

    static fromJSON(data) {
        if (!data) return null;
        return new ChainReasoningStore(data.lessonId, data);
    }

    toJSON() {
        return {
            lessonId: this.lessonId,
            chainStats: { ...this.chainStats },
            stepChainIndex: { ...this.stepChainIndex },
            updatedAt: Date.now(),
        };
    }

    chainKey(propIds) {
        return (propIds || []).join("→");
    }

    recordOutcome(propIds, success) {
        const key = this.chainKey(propIds);
        if (!key) return;
        if (!this.chainStats[key]) {
            this.chainStats[key] = { uses: 0, successes: 0, propIds: [...propIds] };
        }
        this.chainStats[key].uses += 1;
        if (success) this.chainStats[key].successes += 1;
        this.updatedAt = Date.now();
    }

    rememberStepChain(stepId, propIds) {
        if (!stepId || !propIds?.length) return;
        this.stepChainIndex[stepId] = [...propIds];
        this.updatedAt = Date.now();
    }

    getStepChain(stepId) {
        return this.stepChainIndex[stepId] || null;
    }

    historicalSuccessRate(propIds) {
        const key = this.chainKey(propIds);
        const stat = this.chainStats[key];
        if (!stat || stat.uses === 0) return 0.5;
        return stat.successes / stat.uses;
    }

    getStats() {
        const keys = Object.keys(this.chainStats);
        const totalUses = keys.reduce((s, k) => s + (this.chainStats[k].uses || 0), 0);
        const totalSuccesses = keys.reduce((s, k) => s + (this.chainStats[k].successes || 0), 0);
        return {
            chainCount: keys.length,
            totalUses,
            totalSuccesses,
            successRate: totalUses > 0 ? totalSuccesses / totalUses : 0,
        };
    }
}
