/**
 * Resumable curriculum training checkpoints (browser storage).
 */

export const CHECKPOINT_STATUS = {
    IN_PROGRESS: "in-progress",
    INTERRUPTED: "interrupted",
    TRAINING_COMPLETE: "training-complete",
    COMPLETE: "complete",
};

export function trainingUnitKey(agentType, lessonId) {
    return `${agentType}::${lessonId}`;
}

/** Flat list of (agent × lesson) training jobs with non-empty train sets. */
export function buildTrainingUnits(agentTypes, lessons, trainByLesson) {
    const units = [];
    for (const agentType of agentTypes) {
        for (const lesson of lessons) {
            const trainIds = trainByLesson[lesson.id]?.train || [];
            if (trainIds.length === 0) continue;
            units.push({
                key: trainingUnitKey(agentType, lesson.id),
                agentType,
                lessonId: lesson.id,
                lessonName: lesson.name,
                lessonTopics: lesson.topics,
                trainIds,
            });
        }
    }
    return units;
}

export function countTrainingProblems(units) {
    return units.reduce((sum, unit) => sum + unit.trainIds.length, 0);
}

export function countCompletedProblems(units, completedUnitKeys) {
    const done = new Set(completedUnitKeys || []);
    return units
        .filter((unit) => done.has(unit.key))
        .reduce((sum, unit) => sum + unit.trainIds.length, 0);
}

export function buildTrainingProgress(units, completedUnitKeys) {
    const completedUnits = (completedUnitKeys || []).length;
    const totalUnits = units.length;
    const totalProblems = countTrainingProblems(units);
    const completedProblems = countCompletedProblems(units, completedUnitKeys);

    const percent =
        totalUnits > 0 ? Math.round((completedUnits / totalUnits) * 100) : 0;
    const problemPercent =
        totalProblems > 0
            ? Math.round((completedProblems / totalProblems) * 100)
            : 0;

    return {
        completedUnits,
        totalUnits,
        completedProblems,
        totalProblems,
        percent,
        problemPercent,
    };
}

export function splitConfigMatches(checkpointSplit, currentSplit) {
    if (!checkpointSplit || !currentSplit) return false;
    return (
        checkpointSplit.mode === currentSplit.mode &&
        checkpointSplit.seed === currentSplit.seed &&
        checkpointSplit.testPerLesson === currentSplit.testPerLesson &&
        checkpointSplit.testRatio === currentSplit.testRatio &&
        JSON.stringify(checkpointSplit.testProblemIds || []) ===
            JSON.stringify(currentSplit.testProblemIds || [])
    );
}

export function agentTypesMatch(checkpointTypes, currentTypes) {
    const a = [...(checkpointTypes || [])].sort().join(",");
    const b = [...(currentTypes || [])].sort().join(",");
    return a === b && a.length > 0;
}

export function canResumeCheckpoint(checkpoint, { agentTypes, split } = {}) {
    if (!checkpoint) return false;
    if (
        checkpoint.status !== CHECKPOINT_STATUS.IN_PROGRESS &&
        checkpoint.status !== CHECKPOINT_STATUS.INTERRUPTED
    ) {
        return false;
    }
    const progress = checkpoint.progress || {};
    if (progress.totalUnits > 0 && progress.completedUnits >= progress.totalUnits) {
        return false;
    }
    if (agentTypes && !agentTypesMatch(checkpoint.agentTypes, agentTypes)) {
        return false;
    }
    if (split && !splitConfigMatches(checkpoint.split, split)) {
        return false;
    }
    return (checkpoint.completedUnits || []).length < (progress.totalUnits || Infinity);
}

export function buildCheckpointRecord({
    courseName,
    status,
    agentTypes,
    split,
    splitOptions,
    units,
    completedUnits = [],
    trainingLog = [],
    startedAt = null,
    trainingCompletedAt = null,
}) {
    const progress = buildTrainingProgress(units, completedUnits);
    return {
        courseName,
        status,
        agentTypes: [...agentTypes],
        split: {
            mode: split.mode,
            seed: split.seed,
            testRatio: split.testRatio,
            testPerLesson: split.testPerLesson,
            stats: split.stats,
            trainByLesson: split.trainByLesson,
            testProblemIds: split.testProblemIds,
        },
        splitOptions: splitOptions || null,
        completedUnits: [...completedUnits],
        trainingLog,
        progress,
        startedAt: startedAt || Date.now(),
        lastUpdatedAt: Date.now(),
        trainingCompletedAt: trainingCompletedAt || null,
    };
}
