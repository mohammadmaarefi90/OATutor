/**
 * Graduation when all goal propositions exceed mastery threshold.
 */

export function checkGraduation(engine, { lessonId, goalPropIds } = {}) {
    const structure = engine.structureGraphs[lessonId];
    const beliefs = engine.getBeliefs();
    const threshold = engine.masteryThreshold;

    const goals =
        goalPropIds ||
        Object.values(structure?.nodes || {})
            .filter((n) => n.sourceType === "answer")
            .map((n) => n.id);

    if (!goals.length) return { graduated: false, remaining: [] };

    const remaining = goals.filter((id) => (beliefs[id]?.probMastery ?? 0) < threshold);
    return {
        graduated: remaining.length === 0,
        remaining,
        mastered: goals.filter((id) => !remaining.includes(id)),
    };
}

export function getGoalPropositions(structureGraph) {
    return Object.values(structureGraph.nodes)
        .filter((n) => n.sourceType === "answer")
        .map((n) => n.id);
}
