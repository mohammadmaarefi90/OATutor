import { extractStepPropositions, extractHintPropositions } from "./propositionExtractor.js";
import { semanticPropositionId, buildCumulativeDisplayDAG } from "./reasoningFlow.js";

/**
 * Directed reasoning graph with transition counts → probabilities.
 */
export default class ReasoningGraph {
    constructor(lessonId, agentType, initialData = null) {
        this.lessonId = lessonId;
        this.agentType = agentType;
        this.nodes = initialData?.nodes || {};
        this.transitionCounts = initialData?.transitionCounts || {};
        this.totalTransitions = initialData?.totalTransitions || 0;
    }

    static fromJSON(data) {
        if (!data) return null;
        return new ReasoningGraph(data.lessonId, data.agentType, data);
    }

    toJSON() {
        return {
            lessonId: this.lessonId,
            agentType: this.agentType,
            nodes: this.nodes,
            transitionCounts: this.transitionCounts,
            totalTransitions: this.totalTransitions,
            updatedAt: Date.now(),
        };
    }

    _transitionKey(from, to) {
        return `${from}→${to}`;
    }

    ensureNode(id, text, meta = {}) {
        if (!this.nodes[id]) {
            this.nodes[id] = {
                id,
                text: text?.slice(0, 200) || id,
                visitCount: 0,
                ...meta,
            };
        }
        this.nodes[id].visitCount += 1;
        return id;
    }

    addPropositionNode(proposition, skills = []) {
        const id = semanticPropositionId(proposition.text);
        this.ensureNode(id, proposition.text, {
            type: "proposition",
            skills,
            stepId: proposition.stepId,
            problemId: proposition.problemId,
        });
        return id;
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
                actions: [],
            };
        }
        this.transitionCounts[key].count += 1;
        if (meta.label) {
            this.transitionCounts[key].labels.push(meta.label);
        }
        if (meta.action) {
            this.transitionCounts[key].actions.push(meta.action);
        }
        this.totalTransitions += 1;
    }

    /** P(to | from) for each outgoing edge from a node */
    getTransitionProbabilities() {
        const outgoing = {};
        Object.values(this.transitionCounts).forEach((t) => {
            if (!outgoing[t.from]) outgoing[t.from] = [];
            outgoing[t.from].push(t);
        });

        const edges = [];
        Object.entries(outgoing).forEach(([from, transitions]) => {
            const total = transitions.reduce((s, t) => s + t.count, 0);
            transitions.forEach((t) => {
                edges.push({
                    from: t.from,
                    to: t.to,
                    count: t.count,
                    probability: total > 0 ? t.count / total : 0,
                    type: t.type,
                    label: t.labels?.[t.labels.length - 1] || "",
                    action: t.actions?.[t.actions.length - 1] || "",
                    allLabels: [...(t.labels || [])],
                });
            });
        });
        return edges;
    }

    exportDAG(sessionPath = null) {
        const edges = this.getTransitionProbabilities();
        const nodeIds = new Set();
        edges.forEach((e) => {
            nodeIds.add(e.from);
            nodeIds.add(e.to);
        });
        if (sessionPath) {
            sessionPath.forEach((id) => nodeIds.add(id));
        }

        const raw = {
            nodes: [...nodeIds].map((id) => ({
                ...this.nodes[id],
                id,
                label: this.nodes[id]?.text?.slice(0, 120) || id,
            })),
            edges: edges.filter((e) => nodeIds.has(e.from) && nodeIds.has(e.to)),
            sessionPath: sessionPath || [],
            path: sessionPath || [],
            totalTransitions: this.totalTransitions,
        };

        return buildCumulativeDisplayDAG(raw);
    }

    mergeSession(sessionDAG) {
        (sessionDAG.nodes || []).forEach((n) => {
            this.ensureNode(n.id, n.text || n.label, {
                type: n.type || "proposition",
                stepId: n.stepId,
                problemId: n.problemId,
                hintId: n.hintId,
                hintIndex: n.hintIndex,
                isCorrect: n.isCorrect,
            });
        });
        (sessionDAG.edges || []).forEach((e) => {
            this.recordTransition(e.from, e.to, {
                type: e.type || "supports",
                label: e.label,
                action: e.action,
            });
        });
    }
}

export function buildStepReasoningNodes(step, problemId) {
    const stepProps = extractStepPropositions(step, problemId);
    return stepProps;
}

export function buildHintReasoningNodes(hint, stepId, problemId, hintIndex) {
    return extractHintPropositions(hint, stepId, problemId, hintIndex);
}
