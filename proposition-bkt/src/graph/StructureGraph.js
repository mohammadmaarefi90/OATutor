/**
 * Static structure graph: sequence, prerequisite, supports, contradicts, skill-link.
 */
export default class StructureGraph {
    constructor(lessonId, initialData = null) {
        this.lessonId = lessonId;
        this.nodes = initialData?.nodes || {};
        this.edges = initialData?.edges || [];
        this._edgeKeys = new Set(this.edges.map((e) => `${e.from}->${e.to}:${e.type}`));
    }

    static fromJSON(data) {
        if (!data) return null;
        return new StructureGraph(data.lessonId, data);
    }

    toJSON() {
        return {
            lessonId: this.lessonId,
            nodes: { ...this.nodes },
            edges: [...this.edges],
            updatedAt: Date.now(),
        };
    }

    _addEdge(from, to, type, meta = {}) {
        const key = `${from}->${to}:${type}`;
        if (!from || !to || from === to || this._edgeKeys.has(key)) return;
        this._edgeKeys.add(key);
        this.edges.push({ from, to, type, weight: meta.weight ?? 1.0, ...meta });
    }

    addNode(proposition) {
        const id = proposition.id;
        if (!this.nodes[id]) {
            this.nodes[id] = {
                id,
                text: proposition.text,
                skills: [...(proposition.skills || [])],
                sourceType: proposition.sourceType,
                stepId: proposition.stepId,
                problemId: proposition.problemId,
                hintId: proposition.hintId,
                hintIndex: proposition.hintIndex,
                visitCount: 0,
            };
        } else {
            const node = this.nodes[id];
            node.skills = [...new Set([...(node.skills || []), ...(proposition.skills || [])])];
        }
        this.nodes[id].visitCount += 1;
        return id;
    }

    addProposition(proposition) {
        return this.addNode(proposition);
    }

    addEdges(edges) {
        for (const e of edges) {
            this._addEdge(e.from, e.to, e.type, e);
        }
    }

    getOutgoing(propId, type = null) {
        return this.edges.filter((e) => e.from === propId && (!type || e.type === type));
    }

    getIncoming(propId, type = null) {
        return this.edges.filter((e) => e.to === propId && (!type || e.type === type));
    }

    /** BFS prerequisite closure toward target (structural supports/prerequisite/sequence) */
    getPrerequisiteClosure(targetId) {
        const structural = new Set(["sequence", "prerequisite", "supports", "depends"]);
        const visited = new Set();
        const queue = [targetId];
        while (queue.length > 0) {
            const current = queue.shift();
            if (visited.has(current)) continue;
            visited.add(current);
            for (const edge of this.getIncoming(current)) {
                if (structural.has(edge.type)) {
                    queue.push(edge.from);
                }
            }
        }
        return visited;
    }

    getContradicting(propId) {
        return this.getOutgoing(propId, "contradicts").map((e) => e.to);
    }
}
