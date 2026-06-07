import { cloneBeliefModel, DEFAULT_BELIEF } from "./BeliefModel.js";

/**
 * In-memory store of per-proposition BKT beliefs.
 */
export default class BeliefStore {
    constructor(defaultBelief = DEFAULT_BELIEF) {
        this.defaultBelief = cloneBeliefModel(defaultBelief);
        /** @type {Record<string, ReturnType<typeof cloneBeliefModel>>} */
        this.beliefs = {};
        /** @type {Record<string, { id, text, sourceType?, stepId?, problemId?, hintId?, hintIndex?, skills? }>} */
        this.propositions = {};
    }

    ensureProposition(propId, meta = {}) {
        if (!this.propositions[propId]) {
            this.propositions[propId] = { id: propId, ...meta };
        } else {
            Object.assign(this.propositions[propId], meta);
        }
        if (!this.beliefs[propId]) {
            this.beliefs[propId] = cloneBeliefModel(this.defaultBelief);
        }
        return propId;
    }

    getBelief(propId) {
        if (!this.beliefs[propId]) {
            this.beliefs[propId] = cloneBeliefModel(this.defaultBelief);
        }
        return this.beliefs[propId];
    }

    getBeliefs() {
        const out = {};
        for (const [id, model] of Object.entries(this.beliefs)) {
            out[id] = cloneBeliefModel(model);
        }
        return out;
    }

    getProposition(propId) {
        return this.propositions[propId] || null;
    }

    getAllPropositions() {
        return { ...this.propositions };
    }

    toJSON() {
        return {
            defaultBelief: cloneBeliefModel(this.defaultBelief),
            beliefs: this.getBeliefs(),
            propositions: { ...this.propositions },
        };
    }

    static fromJSON(data, defaultBelief = DEFAULT_BELIEF) {
        const store = new BeliefStore(data?.defaultBelief || defaultBelief);
        if (data?.beliefs) {
            for (const [id, model] of Object.entries(data.beliefs)) {
                store.beliefs[id] = cloneBeliefModel(model);
            }
        }
        if (data?.propositions) {
            store.propositions = { ...data.propositions };
        }
        return store;
    }
}
