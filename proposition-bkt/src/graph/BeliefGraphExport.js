/**
 * Merge structure + beliefs + behavioral transitions into visualization-ready JSON.
 */

const STRUCTURAL_TYPES = new Set([
    "sequence",
    "prerequisite",
    "supports",
    "contradicts",
    "skill-link",
    "depends",
    "step-to-hint",
]);

export function buildBeliefSummary(beliefs, structureGraph, masteryThreshold = 0.95) {
    const uncertainThreshold = 0.4;
    const mastered = [];
    const uncertain = [];
    const bottlenecks = [];

    for (const [id, model] of Object.entries(beliefs)) {
        if (model.probMastery >= masteryThreshold) {
            mastered.push(id);
        } else if (model.probMastery >= uncertainThreshold && model.probMastery < masteryThreshold) {
            uncertain.push(id);
        }
    }

    uncertain.sort((a, b) => beliefs[a].probMastery - beliefs[b].probMastery);

    for (const [id, model] of Object.entries(beliefs)) {
        if (model.probMastery >= masteryThreshold) continue;
        const outDegree = structureGraph.edges.filter(
            (e) => e.from === id && STRUCTURAL_TYPES.has(e.type) && !e.to.startsWith("skill:")
        ).length;
        if (outDegree >= 2 && model.probMastery < uncertainThreshold) {
            bottlenecks.push(id);
        }
    }

    bottlenecks.sort((a, b) => beliefs[a].probMastery - beliefs[b].probMastery);

    return {
        mastered,
        uncertain: uncertain.slice(0, 10),
        bottlenecks: bottlenecks.slice(0, 10),
    };
}

export function exportBeliefGraph(engine, { lessonId } = {}) {
    const id = lessonId || engine.lessonId;
    const structure = engine.structureGraphs[id];
    const behavioral = engine.behavioralGraphs[id];
    const beliefs = engine.getBeliefs();

    if (!structure) {
        return {
            lessonId: id,
            timestamp: Date.now(),
            nodes: [],
            structuralEdges: [],
            behavioralEdges: [],
            beliefSummary: { mastered: [], uncertain: [], bottlenecks: [] },
        };
    }

    const nodes = Object.values(structure.nodes).map((n) => {
        const node = {
            id: n.id,
            text: n.text,
            probMastery: beliefs[n.id]?.probMastery ?? engine.defaultBelief.probMastery,
            visitCount: n.visitCount || 0,
            role: n.sourceType || "proposition",
            skills: n.skills || [],
            stepId: n.stepId,
            problemId: n.problemId,
        };
        if (n.hintId != null) node.hintId = n.hintId;
        return node;
    });

    const structuralEdges = structure.edges
        .filter((e) => !e.to.startsWith("skill:"))
        .map(({ from, to, type, weight }) => ({ from, to, type, weight: weight ?? 1.0 }));

    const behavioralEdges = behavioral ? behavioral.getTransitionProbabilities() : [];

    return {
        lessonId: id,
        timestamp: Date.now(),
        nodes,
        structuralEdges,
        behavioralEdges,
        beliefSummary: buildBeliefSummary(beliefs, structure, engine.masteryThreshold),
    };
}

export function exportBeliefGraphJSON(engine, options = {}) {
    return JSON.parse(JSON.stringify(exportBeliefGraph(engine, options)));
}
