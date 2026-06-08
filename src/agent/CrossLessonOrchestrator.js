import AgentOrchestrator from "./AgentOrchestrator.js";
import { ALL_AGENT_TYPES, AGENT_META } from "./agentTypes.js";
import { buildCurriculumSplit } from "./curriculumSplit.js";
import { buildEvaluationReport } from "./AgentEvaluator.js";
import { buildStorableCurriculumReport } from "./curriculumReportExport.js";
import { cloneBktParams, restoreBktParams } from "./bktSnapshot.js";
import {
    AGENT_CURRICULUM_REPORT_STORAGE_KEY,
    AGENT_CURRICULUM_CHECKPOINT_KEY,
} from "./storageKeys.js";

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
        this.split = buildCurriculumSplit(problems, lessons, skillModel, { testRatio });
    }

    cancel() {
        this.cancelled = true;
        if (this._activeOrch) this._activeOrch.cancel();
    }

    _orchForLesson(lesson) {
        return new AgentOrchestrator({
            lesson,
            problems: this.problems,
            bktParams: this.bktParams,
            heuristic: this.heuristic,
            hintPathway: this.hintPathway,
            browserStorage: this.browserStorage,
            onEvent: (e) => this.onEvent({ ...e, lessonId: lesson.id }),
            stepDelayMs: this.stepDelayMs,
        });
    }

    _buildReportSkeleton(testEvaluation, trainingLog = [], extra = {}) {
        return {
            reportId: extra.reportId || `curriculum-${Date.now()}`,
            timestamp: Date.now(),
            trainingCompletedAt: extra.trainingCompletedAt || null,
            courseName: this.course.courseName,
            split: {
                seed: this.split.seed,
                testRatio: this.split.testRatio,
                stats: this.split.stats,
                trainByLesson: this.split.trainByLesson,
                testProblemIds: this.split.testProblemIds,
            },
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

    async _runTrainingPhase() {
        const trainingLog = [];

        for (const agentType of this.agentTypes) {
            if (this.cancelled) break;

            this.onEvent({ type: "curriculum-agent-train-start", agentType });

            for (const lesson of this.lessons) {
                if (this.cancelled) break;

                const trainIds = this.split.trainByLesson[lesson.id]?.train || [];
                if (trainIds.length === 0) continue;

                this.onEvent({
                    type: "curriculum-lesson-train-start",
                    agentType,
                    lessonId: lesson.id,
                    lessonTopics: lesson.topics,
                    problemCount: trainIds.length,
                });

                this._activeOrch = this._orchForLesson(lesson);
                const agent = this._activeOrch.createAgent(agentType, this.bktParams);
                await agent.loadPersistedState?.();

                try {
                    const output = await agent.runTrainingOnProblemIds(trainIds);
                    trainingLog.push({
                        agentType,
                        lessonId: lesson.id,
                        problemIds: trainIds,
                        output,
                    });
                } catch (err) {
                    trainingLog.push({
                        agentType,
                        lessonId: lesson.id,
                        error: err.message,
                    });
                }

                this._activeOrch = null;
                this.onEvent({
                    type: "curriculum-lesson-train-end",
                    agentType,
                    lessonId: lesson.id,
                });
            }

            this.onEvent({ type: "curriculum-agent-train-end", agentType });
        }

        return trainingLog;
    }

    async runFullPipeline() {
        this.onEvent({
            type: "curriculum-start",
            split: this.split.stats,
            testCount: this.split.testProblems.length,
        });

        const trainingLog = await this._runTrainingPhase();
        const trainingCompletedAt = Date.now();

        await this._saveCheckpoint({
            courseName: this.course.courseName,
            trainingCompletedAt,
            split: {
                seed: this.split.seed,
                testRatio: this.split.testRatio,
                stats: this.split.stats,
                trainByLesson: this.split.trainByLesson,
                testProblemIds: this.split.testProblemIds,
            },
        });

        const testReport = await this.runTestEvaluation();
        const report = this._buildReportSkeleton(testReport, trainingLog, {
            trainingCompletedAt,
        });

        await this._saveReport(report);
        this.onEvent({ type: "curriculum-complete", report: buildStorableCurriculumReport(report) });
        return report;
    }

    async runTestOnly() {
        this.onEvent({
            type: "curriculum-test-only-start",
            testCount: this.split.testProblems.length,
        });

        const testReport = await this.runTestEvaluation();
        const report = this._buildReportSkeleton(testReport, [], {
            reportId: `curriculum-test-${Date.now()}`,
            testOnly: true,
        });

        await this._saveReport(report);
        this.onEvent({ type: "curriculum-complete", report: buildStorableCurriculumReport(report) });
        return report;
    }

    async runTestEvaluation() {
        const initialBkt = cloneBktParams(this.bktParams);
        const problemResults = [];

        this.onEvent({
            type: "curriculum-test-start",
            testCount: this.split.testProblems.length,
            agents: this.agentTypes,
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

                try {
                    const result = await agent.evaluateProblem(testProblem, {
                        persistLearning: false,
                    });
                    problemResults.push({
                        ...result,
                        lessonId: testProblem.lessonId,
                        lessonTopics: testProblem.lessonTopics,
                        isTestSet: true,
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

                restoreBktParams(this.bktParams, cloneBktParams(initialBkt));
            }

            this.onEvent({ type: "curriculum-test-agent-end", agentType });
        }

        restoreBktParams(this.bktParams, initialBkt);

        const evaluation = buildEvaluationReport(problemResults);
        evaluation.splitType = "curriculum-holdout";
        evaluation.testProblemIds = this.split.testProblemIds;

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
    return browserStorage
        .getByKey(AGENT_CURRICULUM_CHECKPOINT_KEY(courseName))
        .catch(() => null);
}

export async function loadCurriculumReport(browserStorage, courseName) {
    if (!browserStorage) return null;
    return browserStorage
        .getByKey(AGENT_CURRICULUM_REPORT_STORAGE_KEY(courseName))
        .catch(() => null);
}
