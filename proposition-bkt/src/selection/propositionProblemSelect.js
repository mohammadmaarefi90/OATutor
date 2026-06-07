/**
 * Proposition-driven problem selection by weakest prerequisite closure.
 */

export function selectNextProblem(engine, { lessonId, candidateProblemIds }) {
    const structure = engine.structureGraphs[lessonId];
    const beliefs = engine.getBeliefs();
    if (!structure || !candidateProblemIds?.length) return null;

    let bestProblemId = null;
    let bestScore = -Infinity;

    for (const problemId of candidateProblemIds) {
        const content = engine.problemContent[problemId];
        if (!content) continue;

        const answerId = content.answerPropId;
        if (!answerId) continue;

        const closure = structure.getPrerequisiteClosure(answerId);
        let minMastery = 1;
        let uncertaintySum = 0;

        for (const propId of closure) {
            const p = beliefs[propId]?.probMastery ?? engine.defaultBelief.probMastery;
            minMastery = Math.min(minMastery, p);
            uncertaintySum += 1 - p;
        }

        const score = uncertaintySum + (1 - minMastery) * 2;
        if (score > bestScore) {
            bestScore = score;
            bestProblemId = problemId;
        }
    }

    return bestProblemId;
}
