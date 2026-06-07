import { propositionId } from "./propositionExtractor.js";

/**
 * Agent memory: stores learned answers and proposition associations per lesson.
 */
export default class AgentMemory {
    constructor(lessonId, initialData = null) {
        this.lessonId = lessonId;
        this.entries = initialData?.entries || {};
        this.skillIndex = initialData?.skillIndex || {};
    }

    static fromJSON(data) {
        if (!data) return null;
        return new AgentMemory(data.lessonId, data);
    }

    toJSON() {
        return {
            lessonId: this.lessonId,
            entries: this.entries,
            skillIndex: this.skillIndex,
            updatedAt: Date.now(),
        };
    }

    snapshot() {
        return {
            entryCount: Object.keys(this.entries).length,
            entries: JSON.parse(JSON.stringify(this.entries)),
            skillIndex: { ...this.skillIndex },
        };
    }

    _indexEntry(entryId, skills) {
        skills.forEach((skill) => {
            if (!this.skillIndex[skill]) {
                this.skillIndex[skill] = [];
            }
            if (!this.skillIndex[skill].includes(entryId)) {
                this.skillIndex[skill].push(entryId);
            }
        });
    }

    store({
        stepId,
        problemId,
        answer,
        skills = [],
        propositions = [],
        source = "observation",
    }) {
        const entryId = `mem-${stepId}`;
        const existing = this.entries[entryId];
        const strength = existing ? Math.min(existing.strength + 0.15, 1.0) : 0.35;

        this.entries[entryId] = {
            id: entryId,
            stepId,
            problemId,
            answer,
            skills: [...new Set(skills)],
            propositions: propositions.map((p) =>
                typeof p === "string" ? p : propositionId(p.text, p.stepId || stepId)
            ),
            strength,
            source,
            lastUpdated: Date.now(),
            recallCount: existing ? existing.recallCount + 1 : 0,
        };

        this._indexEntry(entryId, skills);
        return this.entries[entryId];
    }

    recall(stepId, skills = []) {
        const direct = this.entries[`mem-${stepId}`];
        if (direct && direct.strength >= 0.25) {
            direct.recallCount += 1;
            return {
                answer: direct.answer,
                confidence: direct.strength,
                source: "direct",
                entryId: direct.id,
            };
        }

        let best = null;
        for (const skill of skills) {
            const entryIds = this.skillIndex[skill] || [];
            for (const entryId of entryIds) {
                const entry = this.entries[entryId];
                if (entry && entry.strength > (best?.confidence || 0)) {
                    best = {
                        answer: entry.answer,
                        confidence: entry.strength * 0.85,
                        source: "skill-association",
                        entryId: entry.id,
                    };
                }
            }
        }

        if (best) {
            this.entries[best.entryId].recallCount += 1;
        }
        return best;
    }

    getStats() {
        const entries = Object.values(this.entries);
        return {
            entryCount: entries.length,
            avgStrength:
                entries.reduce((s, e) => s + e.strength, 0) / Math.max(entries.length, 1) || 0,
            totalRecalls: entries.reduce((s, e) => s + e.recallCount, 0),
            skillsCovered: Object.keys(this.skillIndex).length,
        };
    }
}
