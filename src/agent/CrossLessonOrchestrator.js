import AgentOrchestrator from "./AgentOrchestrator.js";
import { ALL_AGENT_TYPES, AGENT_META } from "./agentTypes.js";
import { buildCurriculumSplit, SPLIT_MODES, findLessonForProblem } from "./curriculumSplit.js";
import { buildEvaluationReport } from "./AgentEvaluator.js";
import { buildStorableCurriculumReport } from "./curriculumReportExport.js";
import { cloneBktParams, restoreBktParams } from "./bktSnapshot.js";
import {
    AGENT_CURRICULUM_REPORT_STORAGE_KEY,
    AGENT_CURRICULUM_CHECKPOINT_KEY,
} from "./storageKeys.js";
import {
    buildCheckpointRecord,
    buildTrainingUnits,
    canResumeCheckpoint,
    CHECKPOINT_STATUS,
    isTrainingProgressComplete,
    allTrainingUnitKeys,
    reconcileCompletedUnitsIfAllProblemsDone,
} from "./curriculumCheckpoint.js";

/**
 * Trains all three agents across every lesson in a course (train split only),
 * then evaluates on held-out test problems that share curriculum skills.
 */
export default class CrossLessonOrchestrator {
    constructor({
        course,
        lessons,
        problems,
        skillModel,
        bktParams,
        heuristic,
        hintPathway,
        browserStorage,
        onEvent = () => {},
        stepDelayMs = 200,
        testRatio = 0.2,
        splitOptions = null,
        agentTypes = ALL_AGENT_TYPES,
    }) {
        this.course = course;
        this.lessons = lessons;
        this.problems = problems;
        this.skillModel = skillModel;
        this.bktParams = bktParams;
        this.heuristic = heuristic;
        this.hintPathway = hintPathway;
        this.browserStorage = browserStorage;
        this.onEvent = onEvent;
        this.stepDelayMs = stepDelayMs;
        this.agentTypes = agentTypes;
        this.cancelled = false;
        this.splitOptions = splitOptions || {
            mode: SPLIT_MODES.HOLDOUT_RATIO,
            testRatio,
            seed: "oatutor-curriculum",
        };
        this.split = buildCurriculumSplit(problems, lessons, skillModel, this.splitOptions);
        this._trainingUnits = buildTrainingUnits(
            agentTypes,
            lessons,
            this.split.trainByLesson
        );
    }

    cancel() {
        this.cancelled = true;
        if (this._activeOrch) this._activeOrch.cancel();
    }

    _orchForLesson(lesson) {
        return new AgentOrchestrator({
            lesson,
            problems: this.problems,
            skillModel: this.skillModel,
            bktParams: this.bktParams,
            heuristic: this.heuristic,
            hintPathway: this.hintPathway,
            browserStorage: this.browserStorage,
            onEvent: (e) => this.onEvent({ ...e, lessonId: lesson.id }),
            stepDelayMs: this.stepDelayMs,
        });
    }

    _splitSnapshot() {
        return {
            mode: this.split.mode,
            seed: this.split.seed,
            testRatio: this.split.testRatio,
            testPerLesson: this.split.testPerLesson,
            stats: this.split.stats,
            trainByLesson: this.split.trainByLesson,
            testProblemIds: this.split.testProblemIds,
        };
    }

    _emitTrainingProgress(completedUnits, currentLabel = null) {
        const progress = buildCheckpointRecord({
            courseName: this.course.courseName,
            status: CHECKPOINT_STATUS.IN_PROGRESS,
            agentTypes: this.agentTypes,
            split: this.split,
            splitOptions: this.splitOptions,
            units: this._trainingUnits,
            completedUnits,
        }).progress;

        this.onEvent({
            type: "curriculum-progress",
            phase: "training",
            progress,
            currentLabel,
        });
    }

    async _persistTrainingCheckpoint({
        status,
        completedUnits,
        trainingLog,
        startedAt = null,
        trainingCompletedAt = null,
    }) {
        const checkpoint = buildCheckpointRecord({
            courseName: this.course.courseName,
            status,
            agentTypes: this.agentTypes,
            split: this.split,
            splitOptions: this.splitOptions,
            units: this._trainingUnits,
            completedUnits,
            trainingLog,
            startedAt,
            trainingCompletedAt,
        });

        await this._saveCheckpoint(checkpoint);
        this.onEvent({ type: "curriculum-checkpoint-saved", checkpoint });
        return checkpoint;
    }

    _buildReportSkeleton(testEvaluation, trainingLog = [], extra = {}) {
        return {
            reportId: extra.reportId || `curriculum-${Date.now()}`,
            timestamp: Date.now(),
            trainingCompletedAt: extra.trainingCompletedAt || null,
            courseName: this.course.courseName,
            split: this._splitSnapshot(),
            testProblems: this.split.testProblems.map((p) => ({
                id: p.id,
                title: p.title,
                lessonId: p.lessonId,
                lessonName: p.lessonName,
                lessonTopics: p.lessonTopics,
                stepCount: p.steps?.length || 0,
            })),
            trainingLog,
            testEvaluation,
            interrupted: extra.interrupted || false,
            resumedFromCheckpoint: extra.resumedFromCheckpoint || false,
            ...extra,
        };
    }

    async _saveReport(report) {
        if (!this.browserStorage) return;
        const storable = buildStorableCurriculumReport(report);
        await this.browserStorage
            .setByKey(AGENT_CURRICULUM_REPORT_STORAGE_KEY(this.course.courseName), storable)
            .catch((err) => {
                console.error("Failed to save curriculum report", err);
                this.onEvent({ type: "curriculum-save-error", message: err.message });
            });
    }

    async _saveCheckpoint(checkpoint) {
        if (!this.browserStorage) return;
        await this.browserStorage
            .setByKey(AGENT_CURRICULUM_CHECKPOINT_KEY(this.course.courseName), checkpoint)
            .catch((err) => console.error("Failed to save curriculum checkpoint", err));
    }

    /** Restore train/test split from checkpoint so resume matches the original run. */
    _applyCheckpointSplit(checkpointSplit) {
        if (!checkpointSplit?.trainByLesson) return;

        const testProblems = (checkpointSplit.testProblemIds || [])
            .map((id) => {
                const problem = this.problems.find((p) => p.id === id);
                if (!problem) return null;
                const lesson = findLessonForProblem(problem, this.lessons, this.skillModel);
                return {
                    ...problem,
                    lessonId: lesson?.id || null,
                    lessonName: lesson?.name || null,
                    lessonTopics: lesson?.topics || null,
                };
            })
            .filter(Boolean);

        this.split = {
            ...this.split,
            mode: checkpointSplit.mode,
            seed: checkpointSplit.seed,
            testRatio: checkpointSplit.testRatio ?? null,
            testPerLesson: checkpointSplit.testPerLesson,
            trainByLesson: checkpointSplit.trainByLesson,
            testProblemIds: checkpointSplit.testProblemIds || [],
            testProblems,
            stats: checkpointSplit.stats || this.split.stats,
        };
        this._trainingUnits = buildTrainingUnits(
            this.agentTypes,
            this.lessons,
            checkpointSplit.trainByLesson
        );
    }

    async _reconcileCompletedUnits(completedSet, trainingLog, startedAt) {
        const added = reconcileCompletedUnitsIfAllProblemsDone(this._trainingUnits, [
            ...completedSet,
        ]);
        if (added.length === 0) return null;

        for (const key of added) {
            completedSet.add(key);
            const unit = this._trainingUnits.find((u) => u.key === key);
            this.onEvent({
                type: "curriculum-lesson-train-reconciled",
                agentType: unit?.agentType,
                lessonId: unit?.lessonId,
                lessonTopics: unit?.lessonTopics,
                reason: "all-train-problems-already-complete",
            });
        }

        return this._persistTrainingCheckpoint({
            status: CHECKPOINT_STATUS.IN_PROGRESS,
            completedUnits: [...completedSet],
            trainingLog,
            startedAt,
        });
    }

    async _runTrainingPhase({ resumeCheckpoint = null } = {}) {
        const completedSet = new Set(resumeCheckpoint?.completedUnits || []);
        const trainingLog = [...(resumeCheckpoint?.trainingLog || [])];
        const startedAt = resumeCheckpoint?.startedAt || Date.now();
        let lastCheckpoint = resumeCheckpoint;

        if (!resumeCheckpoint) {
            lastCheckpoint = await this._persistTrainingCheckpoint({
                status: CHECKPOINT_STATUS.IN_PROGRESS,
                completedUnits: [],
                trainingLog: [],
                startedAt,
            });
        } else {
            if (isTrainingProgressComplete(resumeCheckpoint)) {
                for (const unit of this._trainingUnits) {
                    completedSet.add(unit.key);
                }
            }
            lastCheckpoint =
                (await this._reconcileCompletedUnits(completedSet, trainingLog, startedAt)) ||
                lastCheckpoint;
        }

        this._emitTrainingProgress([...completedSet]);

        for (const unit of this._trainingUnits) {
            if (this.cancelled) break;
            if (completedSet.has(unit.key)) continue;

            const lesson = this.lessons.find((l) => l.id === unit.lessonId);
            if (!lesson) {
                this.onEvent({
                    type: "curriculum-lesson-train-error",
                    agentType: unit.agentType,
                    lessonId: unit.lessonId,
                    lessonTopics: unit.lessonTopics,
                    message:
                        "Lesson not found in course catalog; marking job complete so training can continue.",
                });
                completedSet.add(unit.key);
                lastCheckpoint = await this._persistTrainingCheckpoint({
                    status: this.cancelled
                        ? CHECKPOINT_STATUS.INTERRUPTED
                        : CHECKPOINT_STATUS.IN_PROGRESS,
                    completedUnits: [...completedSet],
                    trainingLog,
                    startedAt,
                });
                continue;
            }

            const label = `${AGENT_META[unit.agentType]?.shortLabel || unit.agentType} — ${
                unit.lessonTopics || unit.lessonName || unit.lessonId
            }`;

            this.onEvent({
                type: "curriculum-agent-train-start",
                agentType: unit.agentType,
            });
            this.onEvent({
                type: "curriculum-lesson-train-start",
                agentType: unit.agentType,
                lessonId: unit.lessonId,
                lessonTopics: unit.lessonTopics,
                problemCount: unit.trainIds.length,
            });
            this._emitTrainingProgress([...completedSet], label);

            this._activeOrch = this._orchForLesson(lesson);
            const lessonProgressLabel = label;
            const baseOnEvent = this._activeOrch.onEvent.bind(this._activeOrch);
            this._activeOrch.onEvent = (event) => {
                baseOnEvent(event);
                if (event.type === "train-problem-progress") {
                    this._emitTrainingProgress(
                        [...completedSet],
                        `${lessonProgressLabel} — problem ${event.completed}/${event.total}`
                    );
                }
            };

            const agent = this._activeOrch.createAgent(unit.agentType, this.bktParams);
            await agent.loadPersistedState?.();

            try {
                const output = await agent.runTrainingOnProblemIds(unit.trainIds);
                trainingLog.push({
                    agentType: unit.agentType,
                    lessonId: unit.lessonId,
                    problemIds: unit.trainIds,
                    output,
                });
            } catch (err) {
                trainingLog.push({
                    agentType: unit.agentType,
                    lessonId: unit.lessonId,
                    error: err.message,
                });
            }

            this._activeOrch = null;
            completedSet.add(unit.key);

            this.onEvent({
                type: "curriculum-lesson-train-end",
                agentType: unit.agentType,
                lessonId: unit.lessonId,
            });
            this.onEvent({
                type: "curriculum-agent-train-end",
                agentType: unit.agentType,
            });

            const status = this.cancelled
                ? CHECKPOINT_STATUS.INTERRUPTED
                : CHECKPOINT_STATUS.IN_PROGRESS;

            lastCheckpoint = await this._persistTrainingCheckpoint({
                status,
                completedUnits: [...completedSet],
                trainingLog,
                startedAt,
            });
            this._emitTrainingProgress([...completedSet], label);
        }

        lastCheckpoint =
            (await this._reconcileCompletedUnits(completedSet, trainingLog, startedAt)) ||
            lastCheckpoint;

        let allDone = completedSet.size >= this._trainingUnits.length;

        if (allDone && !this.cancelled) {
            lastCheckpoint = await this._persistTrainingCheckpoint({
                status: CHECKPOINT_STATUS.TRAINING_COMPLETE,
                completedUnits: [...completedSet],
                trainingLog,
                startedAt,
                trainingCompletedAt: Date.now(),
            });
        } else if (this.cancelled && !allDone) {
            lastCheckpoint = await this._persistTrainingCheckpoint({
                status: CHECKPOINT_STATUS.INTERRUPTED,
                completedUnits: [...completedSet],
                trainingLog,
                startedAt,
            });
            this.onEvent({
                type: "curriculum-interrupted",
                checkpoint: lastCheckpoint,
            });
        }

        return { trainingLog, checkpoint: lastCheckpoint, allDone: allDone && !this.cancelled };
    }

    async _finishWithTestEvaluation(trainingLog, extra = {}) {
        const trainingCompletedAt = extra.trainingCompletedAt || Date.now();
        const testReport = await this.runTestEvaluation({
            strictNoClues: extra.strictNoClues,
        });
        const report = this._buildReportSkeleton(testReport, trainingLog, {
            trainingCompletedAt,
            resumedFromCheckpoint: extra.resumedFromCheckpoint || false,
            ...extra,
        });

        await this._persistTrainingCheckpoint({
            status: CHECKPOINT_STATUS.COMPLETE,
            completedUnits: allTrainingUnitKeys(this._trainingUnits),
            trainingLog,
            startedAt: extra.startedAt,
            trainingCompletedAt,
        });

        await this._saveReport(report);
        this.onEvent({ type: "curriculum-complete", report: buildStorableCurriculumReport(report) });
        return report;
    }

    async runFullPipeline({ resume = false, checkpointOverride = null } = {}) {
        let resumeCheckpoint = checkpointOverride;
        if (resume) {
            if (!this.browserStorage) {
                const err = new Error(
                    "Browser storage is unavailable — cannot resume curriculum training."
                );
                this.onEvent({ type: "curriculum-resume-error", message: err.message });
                throw err;
            }
            if (!resumeCheckpoint) {
                resumeCheckpoint = await loadCurriculumCheckpoint(
                    this.browserStorage,
                    this.course.courseName
                );
            }
            if (!resumeCheckpoint) {
                const err = new Error(
                    "No saved checkpoint found. Export a backup if you have one, or start a fresh run."
                );
                this.onEvent({ type: "curriculum-resume-error", message: err.message });
                throw err;
            }
            if (resumeCheckpoint.split) {
                this._applyCheckpointSplit(resumeCheckpoint.split);
            }
            if (
                !canResumeCheckpoint(resumeCheckpoint, {
                    agentTypes: this.agentTypes,
                    split: resumeCheckpoint.split || this.split,
                })
            ) {
                const err = new Error(
                    "No compatible checkpoint found. Start a fresh run or match the same split mode and agents."
                );
                this.onEvent({ type: "curriculum-resume-error", message: err.message });
                throw err;
            }
        }

        this.onEvent({
            type: "curriculum-start",
            split: this.split.stats,
            splitMode: this.split.mode,
            testCount: this.split.testProblems.length,
            resumed: !!resumeCheckpoint,
            progress: resumeCheckpoint?.progress || null,
        });

        if (resume && isTrainingProgressComplete(resumeCheckpoint)) {
            this.onEvent({
                type: "curriculum-training-skip",
                message: "All training already complete in checkpoint — starting test phase.",
                progress: resumeCheckpoint.progress,
            });
            await this._persistTrainingCheckpoint({
                status: CHECKPOINT_STATUS.TRAINING_COMPLETE,
                completedUnits: allTrainingUnitKeys(this._trainingUnits),
                trainingLog: resumeCheckpoint.trainingLog || [],
                startedAt: resumeCheckpoint.startedAt,
                trainingCompletedAt: Date.now(),
            });
            return this._finishWithTestEvaluation(resumeCheckpoint.trainingLog || [], {
                trainingCompletedAt: Date.now(),
                resumedFromCheckpoint: true,
                startedAt: resumeCheckpoint.startedAt,
            });
        }

        const { trainingLog, allDone, checkpoint } = await this._runTrainingPhase({
            resumeCheckpoint,
        });

        if (!allDone) {
            const partial = this._buildReportSkeleton(null, trainingLog, {
                trainingCompletedAt: checkpoint?.trainingCompletedAt || null,
                interrupted: true,
                resumedFromCheckpoint: !!resumeCheckpoint,
                checkpoint,
            });
            this.onEvent({
                type: "curriculum-training-paused",
                checkpoint,
                report: buildStorableCurriculumReport(partial),
            });
            return partial;
        }

        return this._finishWithTestEvaluation(trainingLog, {
            trainingCompletedAt: Date.now(),
            resumedFromCheckpoint: !!resumeCheckpoint,
            startedAt: checkpoint?.startedAt,
        });
    }

    async resumeTraining(checkpointOverride = null) {
        return this.runFullPipeline({ resume: true, checkpointOverride });
    }

    async runTestOnly({ strictNoClues = false, checkpoint = null } = {}) {
        if (checkpoint?.split) {
            this._applyCheckpointSplit(checkpoint.split);
        }

        this.onEvent({
            type: "curriculum-test-only-start",
            testCount: this.split.testProblems.length,
            strictNoClues,
        });

        const testReport = await this.runTestEvaluation({ strictNoClues });
        const report = this._buildReportSkeleton(testReport, checkpoint?.trainingLog || [], {
            reportId: `curriculum-test-${Date.now()}`,
            testOnly: true,
            strictNoClues,
            resumedFromCheckpoint: !!checkpoint,
            trainingCompletedAt: checkpoint?.trainingCompletedAt || checkpoint?.lastUpdatedAt || Date.now(),
        });

        if (this.browserStorage) {
            await this._persistTrainingCheckpoint({
                status: CHECKPOINT_STATUS.COMPLETE,
                completedUnits: allTrainingUnitKeys(this._trainingUnits),
                trainingLog: checkpoint?.trainingLog || [],
                startedAt: checkpoint?.startedAt,
                trainingCompletedAt: checkpoint?.trainingCompletedAt || Date.now(),
            });
        }

        await this._saveReport(report);
        this.onEvent({ type: "curriculum-complete", report: buildStorableCurriculumReport(report) });
        return report;
    }

    async runTestEvaluation({ strictNoClues = false } = {}) {
        const initialBkt = cloneBktParams(this.bktParams);
        const problemResults = [];
        const totalTests = this.split.testProblems.length * this.agentTypes.length;
        let completedTests = 0;

        this.onEvent({
            type: "curriculum-test-start",
            testCount: this.split.testProblems.length,
            agents: this.agentTypes,
            strictNoClues,
        });

        for (const agentType of this.agentTypes) {
            if (this.cancelled) break;

            restoreBktParams(this.bktParams, cloneBktParams(initialBkt));
            this.onEvent({ type: "curriculum-test-agent-start", agentType });

            for (const testProblem of this.split.testProblems) {
                if (this.cancelled) break;

                const lesson = this.lessons.find((l) => l.id === testProblem.lessonId);
                if (!lesson) continue;

                this._activeOrch = this._orchForLesson(lesson);
                const agentBkt = cloneBktParams(this.bktParams);
                const agent = this._activeOrch.createAgent(agentType, agentBkt);
                agent.stepDelayMs = 400;
                await agent.loadPersistedState?.();

                const label = `${AGENT_META[agentType]?.shortLabel || agentType} — ${
                    testProblem.title || testProblem.id
                }`;

                try {
                    const result = await agent.evaluateProblem(testProblem, {
                        persistLearning: false,
                        strictNoClues,
                    });
                    problemResults.push({
                        ...result,
                        lessonId: testProblem.lessonId,
                        lessonTopics: testProblem.lessonTopics,
                        isTestSet: true,
                        strictNoClues,
                    });
                } catch (err) {
                    problemResults.push({
                        agentType,
                        problemId: testProblem.id,
                        lessonId: testProblem.lessonId,
                        error: err.message,
                        correct: false,
                        isTestSet: true,
                    });
                }

                completedTests += 1;
                this.onEvent({
                    type: "curriculum-progress",
                    phase: "testing",
                    progress: {
                        completedUnits: completedTests,
                        totalUnits: totalTests,
                        percent: Math.round((completedTests / Math.max(totalTests, 1)) * 100),
                        completedProblems: completedTests,
                        totalProblems: totalTests,
                        problemPercent: Math.round(
                            (completedTests / Math.max(totalTests, 1)) * 100
                        ),
                    },
                    currentLabel: label,
                });

                restoreBktParams(this.bktParams, cloneBktParams(initialBkt));
            }

            this.onEvent({ type: "curriculum-test-agent-end", agentType });
        }

        restoreBktParams(this.bktParams, initialBkt);

        const evaluation = buildEvaluationReport(problemResults);
        evaluation.splitType =
            this.split.mode === SPLIT_MODES.FULL_TRAIN_STRATIFIED_TEST
                ? "curriculum-stratified-holdout"
                : "curriculum-holdout";
        evaluation.splitMode = this.split.mode;
        evaluation.testProblemIds = this.split.testProblemIds;
        evaluation.sharedTestSet = true;
        evaluation.strictNoClues = strictNoClues;

        const scoreboard = this.split.testProblems.map((p) => {
            const row = {
                problemId: p.id,
                title: p.title,
                lessonId: p.lessonId,
                lessonTopics: p.lessonTopics,
                agents: {},
            };
            this.agentTypes.forEach((type) => {
                const r = problemResults.find(
                    (x) => x.agentType === type && x.problemId === p.id
                );
                row.agents[type] = r
                    ? {
                          correct: r.correct,
                          firstTryRate: r.firstTryRate,
                          stepsCorrect: r.stepsCorrect,
                          stepsTotal: r.stepsTotal,
                          solveTrace: r.solveTrace,
                      }
                    : null;
            });
            return row;
        });

        evaluation.scoreboard = scoreboard;
        evaluation.summary = {
            testProblemCount: this.split.testProblems.length,
            agents: Object.fromEntries(
                this.agentTypes.map((type) => {
                    const results = problemResults.filter((r) => r.agentType === type);
                    return [
                        type,
                        {
                            label: AGENT_META[type].label,
                            problemsCorrect: results.filter((r) => r.correct).length,
                            problemsTotal: results.length,
                            accuracy:
                                results.length > 0
                                    ? results.filter((r) => r.correct).length / results.length
                                    : 0,
                            avgFirstTryRate:
                                results.length > 0
                                    ? results.reduce((s, r) => s + (r.firstTryRate || 0), 0) /
                                      results.length
                                    : 0,
                        },
                    ];
                })
            ),
        };

        this.onEvent({ type: "curriculum-test-complete", evaluation });
        return evaluation;
    }
}

export async function loadCurriculumCheckpoint(browserStorage, courseName) {
    if (!browserStorage) return null;
    const raw = await browserStorage
        .getByKey(AGENT_CURRICULUM_CHECKPOINT_KEY(courseName))
        .catch(() => null);
    if (!raw || typeof raw !== "object") return null;
    return raw;
}

export async function loadCurriculumReport(browserStorage, courseName) {
    if (!browserStorage) return null;
    return browserStorage
        .getByKey(AGENT_CURRICULUM_REPORT_STORAGE_KEY(courseName))
        .catch(() => null);
}

export { canResumeCheckpoint, CHECKPOINT_STATUS };
