import { MASTERY_THRESHOLD } from "../config/config.js";

/** Skills tracked for lesson mastery: objectives + KCs on lesson problems. */
export function getLessonMasterySkills(lesson, lessonProblems = null) {
    const skills = new Set(Object.keys(lesson?.learningObjectives || {}));
    for (const problem of lessonProblems || []) {
        for (const step of problem.steps || []) {
            for (const kc of step.knowledgeComponents || []) {
                skills.add(kc);
            }
        }
    }
    return [...skills];
}

/** Keep only problems whose steps touch this lesson's learning objectives. */
export function filterProblemsForLesson(problems, lesson) {
    const lessonKcs = new Set(Object.keys(lesson?.learningObjectives || {}));
    if (lessonKcs.size === 0) return problems;

    return problems.filter((problem) => {
        for (const step of problem.steps || []) {
            for (const kc of step.knowledgeComponents || []) {
                if (lessonKcs.has(kc)) return true;
            }
        }
        return false;
    });
}

/**
 * Shared problem selection logic (mirrors Platform._nextProblem).
 */
export function annotateProblemsWithMastery(problems, lesson, bktParams) {
    for (const problem of problems) {
        let probMastery = 1;
        let isRelevant = false;

        for (const step of problem.steps) {
            if (!step.knowledgeComponents) continue;
            for (const kc of step.knowledgeComponents) {
                if (typeof bktParams[kc] === "undefined") continue;
                if (kc in lesson.learningObjectives) {
                    isRelevant = true;
                }
                probMastery *= bktParams[kc].probMastery;
            }
        }

        problem.probMastery = isRelevant ? probMastery : null;
    }
    return problems;
}

export function computeLessonMastery(lesson, bktParams, lessonProblems = null) {
    const skills = getLessonMasterySkills(lesson, lessonProblems);
    if (skills.length === 0) return 0;

    let sum = 0;
    let count = 0;
    for (const skill of skills) {
        const model = bktParams[skill];
        if (model && typeof model.probMastery === "number") {
            sum += model.probMastery;
            count += 1;
        }
    }
    return count > 0 ? sum / count : 0;
}

/** Lesson-scoped graduation: all learning objectives for this lesson exceed threshold. */
export function isLessonGraduated(bktParams, lesson) {
    const objectives = Object.keys(lesson?.learningObjectives || {});
    if (objectives.length === 0) return false;

    return objectives.every(
        (skill) => (bktParams[skill]?.probMastery ?? 0) > MASTERY_THRESHOLD
    );
}

/** Global graduation (legacy Platform check — all skills in bktParams). */
export function isGraduated(bktParams) {
    const keys = Object.keys(bktParams || {});
    if (keys.length === 0) return false;
    return keys.every((skill) => (bktParams[skill]?.probMastery ?? 0) > MASTERY_THRESHOLD);
}

export function selectNextProblem(problems, lesson, bktParams, completedProbs, heuristic) {
    const filtered = problems.filter(
        ({ courseName }) => !courseName.toString().startsWith("!!")
    );
    annotateProblemsWithMastery(filtered, lesson, bktParams);

    if (isLessonGraduated(bktParams, lesson)) {
        return { problem: null, status: "graduated" };
    }

    let chosen = heuristic(filtered, completedProbs);

    if (!chosen && lesson.allowRecycle) {
        completedProbs.clear();
        chosen = heuristic(filtered, completedProbs);
    }

    if (!chosen) {
        return { problem: null, status: lesson.allowRecycle ? "exhausted" : "exhausted" };
    }

    return { problem: chosen, status: "learning" };
}
