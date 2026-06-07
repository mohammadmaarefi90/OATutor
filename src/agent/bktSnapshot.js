export function cloneBktParams(bktParams) {
    return JSON.parse(JSON.stringify(bktParams));
}

export function restoreBktParams(target, snapshot) {
    if (!target || !snapshot || typeof snapshot !== "object") {
        console.warn("restoreBktParams skipped: invalid target or snapshot");
        return;
    }
    Object.keys(target).forEach((key) => delete target[key]);
    Object.assign(target, cloneBktParams(snapshot));
}

export function snapshotLessonBkt(bktParams, lesson) {
    const objectives = Object.keys(lesson.learningObjectives || {});
    return Object.fromEntries(
        objectives.map((skill) => [skill, bktParams[skill]?.probMastery ?? 0])
    );
}
