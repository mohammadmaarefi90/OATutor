export function filterLessonProblems(problems, lesson, skillModel) {
    if (!lesson || !problems?.length) return [];
    return problems.filter((problem) =>
        problem.steps?.some((step) =>
            (skillModel[step.id] || []).some((kc) => kc in (lesson.learningObjectives || {}))
        )
    );
}

export function findProblemById(problems, problemId) {
    return problems.find((p) => p.id === problemId) || null;
}
