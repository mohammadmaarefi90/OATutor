import { normalizePropositionText } from "../propositionExtractor.js";
import { cleanArray } from "../../util/cleanObject.js";

/**
 * Stores hint-derived beliefs keyed by knowledge component (skill).
 * Built during training; injected into local LLM prompts on test problems.
 */
export default class LLMBeliefStore {
    constructor(lessonId, initialData = null) {
        this.lessonId = lessonId;
        this.beliefsBySkill = initialData?.beliefsBySkill || {};
        this.totalBeliefs = initialData?.totalBeliefs || 0;
        this.updatedAt = initialData?.updatedAt || Date.now();
    }

    static fromJSON(data) {
        if (!data) return null;
        return new LLMBeliefStore(data.lessonId, data);
    }

    toJSON() {
        return {
            lessonId: this.lessonId,
            beliefsBySkill: this.beliefsBySkill,
            totalBeliefs: this.totalBeliefs,
            updatedAt: Date.now(),
        };
    }

    _beliefKey(text, stepId) {
        const norm = normalizePropositionText(text).toLowerCase();
        return `${stepId}::${norm.slice(0, 120)}`;
    }

    addBelief(skills, { text, stepId, problemId, source = "hint-pathway" }) {
        const normalized = normalizePropositionText(text);
        if (!normalized || normalized.length < 6) return false;

        const skillList = cleanArray(skills || []);
        if (skillList.length === 0) skillList.push("_general");

        let added = false;
        for (const skill of skillList) {
            if (!this.beliefsBySkill[skill]) this.beliefsBySkill[skill] = {};
            const key = this._beliefKey(normalized, stepId);
            if (!this.beliefsBySkill[skill][key]) {
                this.beliefsBySkill[skill][key] = {
                    text: normalized.slice(0, 500),
                    stepId,
                    problemId,
                    source,
                    learnedAt: Date.now(),
                };
                this.totalBeliefs += 1;
                added = true;
            }
        }
        if (added) this.updatedAt = Date.now();
        return added;
    }

    ingestHintPathway(pathway, step, problemId, skills) {
        let count = 0;
        const visitHint = (hint) => {
            const fields = [hint.title, hint.hint, hint.body, hint.text].filter(Boolean);
            for (const text of fields) {
                if (this.addBelief(skills, { text, stepId: step.id, problemId, source: "hint" })) {
                    count += 1;
                }
            }
            (hint.subHints || []).forEach(visitHint);
        };
        pathway.forEach(visitHint);
        return count;
    }

    getBeliefsForSkills(skills, limit = 12) {
        const skillList = cleanArray(skills || []);
        const seen = new Set();
        const beliefs = [];

        const collect = (skill) => {
            const bucket = this.beliefsBySkill[skill];
            if (!bucket) return;
            Object.values(bucket).forEach((b) => {
                if (seen.has(b.text)) return;
                seen.add(b.text);
                beliefs.push(b);
            });
        };

        skillList.forEach(collect);
        if (beliefs.length === 0) collect("_general");

        return beliefs
            .sort((a, b) => (b.learnedAt || 0) - (a.learnedAt || 0))
            .slice(0, limit);
    }

    getStats() {
        return {
            skillCount: Object.keys(this.beliefsBySkill).length,
            totalBeliefs: this.totalBeliefs,
            updatedAt: this.updatedAt,
        };
    }
}
