export const SPLIT_MODES = {
    /** ~20% held out per lesson via deterministic hash buckets */
    HOLDOUT_RATIO: "holdout-ratio",
    /** Train on (almost) every problem; test = fixed random sample per lesson/part */
    FULL_TRAIN_STRATIFIED_TEST: "full-train-stratified-test",
};

function stableBucket(id, seed) {
    const key = `${seed}::${id}`;
    let hash = 0;
    for (let i = 0; i < key.length; i++) {
        hash = (hash << 5) - hash + key.charCodeAt(i);
        hash |= 0;
    }
    return Math.abs(hash) % 100;
}

/** Score how many lesson KCs a problem touches. */
export function scoreProblemLessonOverlap(problem, lesson, skillModel) {
    const lessonKcs = new Set(Object.keys(lesson.learningObjectives || {}));
    let score = 0;
    for (const step of problem.steps || []) {
        for (const kc of skillModel[step.id] || []) {
            if (lessonKcs.has(kc)) score += 1;
        }
    }
    return score;
}

/** Assign each problem to the lesson with highest KC overlap. */
export function assignProblemsToLessons(problems, lessons, skillModel) {
    const byLesson = {};
    lessons.forEach((lesson) => {
        byLesson[lesson.id] = [];
    });

    for (const problem of problems) {
        let bestLesson = null;
        let bestScore = 0;
        for (const lesson of lessons) {
            const score = scoreProblemLessonOverlap(problem, lesson, skillModel);
            if (score > bestScore) {
                bestScore = score;
                bestLesson = lesson;
            }
        }
        if (bestLesson && bestScore > 0) {
            byLesson[bestLesson.id].push(problem);
        }
    }
    return byLesson;
}

function sortProblemsBySeededRandom(problems, seed, lessonId) {
    return [...problems].sort(
        (a, b) =>
            stableBucket(a.id, `${seed}::test::${lessonId}`) -
            stableBucket(b.id, `${seed}::test::${lessonId}`)
    );
}

/**
 * Train on the maximum problems per lesson; hold out a small fixed random
 * sample from each lesson for a shared test set (same IDs for all agents).
 */
export function buildStratifiedFullTrainSplit(problems, lessons, skillModel, options = {}) {
    const seed = options.seed ?? "oatutor-curriculum";
    const testPerLesson = options.testPerLesson ?? 3;
    const minTestPerLesson = options.minTestPerLesson ?? 1;

    const assigned = assignProblemsToLessons(problems, lessons, skillModel);
    const trainByLesson = {};
    const trainProblemIds = new Set();
    const testProblems = [];
    const testProblemIds = new Set();

    for (const lesson of lessons) {
        const lessonProblems = [...(assigned[lesson.id] || [])].sort((a, b) =>
            a.id.localeCompare(b.id)
        );

        const train = [];
        const test = [];

        if (lessonProblems.length === 0) {
            trainByLesson[lesson.id] = {
                lessonId: lesson.id,
                lessonName: lesson.name,
                lessonTopics: lesson.topics,
                train: [],
                test: [],
            };
            continue;
        }

        if (lessonProblems.length === 1) {
            test.push(lessonProblems[0]);
        } else {
            const shuffled = sortProblemsBySeededRandom(lessonProblems, seed, lesson.id);
            const maxTest = Math.min(testPerLesson, shuffled.length - 1);
            const nTest = Math.max(maxTest, Math.min(minTestPerLesson, shuffled.length - 1));
            test.push(...shuffled.slice(0, nTest));
            train.push(...shuffled.slice(nTest));
        }

        trainByLesson[lesson.id] = {
            lessonId: lesson.id,
            lessonName: lesson.name,
            lessonTopics: lesson.topics,
            train: train.map((p) => p.id),
            test: test.map((p) => p.id),
        };

        train.forEach((p) => trainProblemIds.add(p.id));
        test.forEach((p) => {
            if (!trainProblemIds.has(p.id)) {
                testProblemIds.add(p.id);
                testProblems.push({
                    ...p,
                    lessonId: lesson.id,
                    lessonName: lesson.name,
                    lessonTopics: lesson.topics,
                });
            }
        });
    }

    const lessonsWithTest = Object.values(trainByLesson).filter((e) => (e.test?.length || 0) > 0)
        .length;

    return {
        mode: SPLIT_MODES.FULL_TRAIN_STRATIFIED_TEST,
        seed,
        testPerLesson,
        testRatio: null,
        trainByLesson,
        trainProblemIds: [...trainProblemIds],
        testProblemIds: [...testProblemIds],
        testProblems,
        stats: {
            lessonCount: lessons.length,
            lessonsWithTest,
            trainCount: trainProblemIds.size,
            testCount: testProblems.length,
            perLesson: Object.fromEntries(
                lessons.map((l) => [
                    l.id,
                    {
                        train: trainByLesson[l.id]?.train?.length || 0,
                        test: trainByLesson[l.id]?.test?.length || 0,
                    },
                ])
            ),
        },
    };
}

/**
 * Split each lesson's problems into train / test (~20% holdout).
 */
export function buildHoldoutRatioSplit(problems, lessons, skillModel, options = {}) {
    const testRatio = options.testRatio ?? 0.2;
    const seed = options.seed ?? "oatutor-curriculum";
    const minTestPerLesson = options.minTestPerLesson ?? 1;

    const assigned = assignProblemsToLessons(problems, lessons, skillModel);
    const trainByLesson = {};
    const trainProblemIds = new Set();
    const testProblems = [];
    const testProblemIds = new Set();

    for (const lesson of lessons) {
        const lessonProblems = [...(assigned[lesson.id] || [])].sort((a, b) =>
            a.id.localeCompare(b.id)
        );

        const train = [];
        const test = [];

        if (lessonProblems.length === 0) {
            trainByLesson[lesson.id] = {
                lessonId: lesson.id,
                lessonName: lesson.name,
                lessonTopics: lesson.topics,
                train: [],
                test: [],
            };
            continue;
        }

        if (lessonProblems.length === 1) {
            train.push(lessonProblems[0]);
        } else {
            for (const p of lessonProblems) {
                const bucket = stableBucket(p.id, seed);
                if (bucket < testRatio * 100) {
                    test.push(p);
                } else {
                    train.push(p);
                }
            }

            if (test.length === 0 && lessonProblems.length > 1) {
                test.push(train.pop());
            }
            if (test.length < minTestPerLesson && train.length > minTestPerLesson) {
                while (test.length < minTestPerLesson && train.length > 1) {
                    test.unshift(train.pop());
                }
            }
            if (train.length === 0 && test.length > 1) {
                train.push(test.shift());
            }
        }

        trainByLesson[lesson.id] = {
            lessonId: lesson.id,
            lessonName: lesson.name,
            lessonTopics: lesson.topics,
            train: train.map((p) => p.id),
            test: test.map((p) => p.id),
        };

        train.forEach((p) => trainProblemIds.add(p.id));
        test.forEach((p) => {
            if (!trainProblemIds.has(p.id)) {
                testProblemIds.add(p.id);
                testProblems.push({
                    ...p,
                    lessonId: lesson.id,
                    lessonName: lesson.name,
                    lessonTopics: lesson.topics,
                });
            }
        });
    }

    const lessonsWithTest = Object.values(trainByLesson).filter((e) => (e.test?.length || 0) > 0)
        .length;

    return {
        mode: SPLIT_MODES.HOLDOUT_RATIO,
        seed,
        testRatio,
        testPerLesson: null,
        trainByLesson,
        trainProblemIds: [...trainProblemIds],
        testProblemIds: [...testProblemIds],
        testProblems,
        stats: {
            lessonCount: lessons.length,
            lessonsWithTest,
            trainCount: trainProblemIds.size,
            testCount: testProblems.length,
            perLesson: Object.fromEntries(
                lessons.map((l) => [
                    l.id,
                    {
                        train: trainByLesson[l.id]?.train?.length || 0,
                        test: trainByLesson[l.id]?.test?.length || 0,
                    },
                ])
            ),
        },
    };
}

/**
 * Build train/test split for curriculum pipelines.
 * @param {object} options
 * @param {string} [options.mode] - SPLIT_MODES.HOLDOUT_RATIO | SPLIT_MODES.FULL_TRAIN_STRATIFIED_TEST
 * @param {number} [options.testRatio] - holdout ratio mode only
 * @param {number} [options.testPerLesson] - stratified mode: random test problems per lesson
 */
export function buildCurriculumSplit(problems, lessons, skillModel, options = {}) {
    const mode = options.mode ?? SPLIT_MODES.HOLDOUT_RATIO;
    if (mode === SPLIT_MODES.FULL_TRAIN_STRATIFIED_TEST) {
        return buildStratifiedFullTrainSplit(problems, lessons, skillModel, options);
    }
    return buildHoldoutRatioSplit(problems, lessons, skillModel, options);
}

export function findLessonForProblem(problem, lessons, skillModel) {
    let best = null;
    let bestScore = 0;
    for (const lesson of lessons) {
        const score = scoreProblemLessonOverlap(problem, lesson, skillModel);
        if (score > bestScore) {
            bestScore = score;
            best = lesson;
        }
    }
    return best;
}
