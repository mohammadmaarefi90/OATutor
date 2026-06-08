/**
 * Build storable / downloadable curriculum reports without circular refs or huge logs.
 */

import { AGENT_CURRICULUM_REPORT_STORAGE_KEY } from "./storageKeys.js";

function slimLLMSnapshot(snap) {
    if (!snap) return null;
    return {
        ...snap,
        rawText: snap.rawText?.slice?.(0, 4000) || snap.rawText,
        reasoning: snap.reasoning?.slice?.(0, 4000) || snap.reasoning,
        content: snap.content?.slice?.(0, 2000) || snap.content,
    };
}

function slimSolveTrace(trace) {
    if (!trace) return null;
    return {
        problemId: trace.problemId,
        title: trace.title,
        problemBody: trace.problemBody?.slice?.(0, 2000) || trace.problemBody,
        steps: (trace.steps || []).map((s) => ({
            stepIndex: s.stepIndex,
            stepId: s.stepId,
            stepTitle: s.stepTitle,
            stepBody: s.stepBody?.slice?.(0, 500) || s.stepBody,
            answerType: s.answerType,
            attempt: s.attempt,
            isCorrect: s.isCorrect,
            firstTry: s.firstTry,
            source: s.source,
            expectedAnswer: s.expectedAnswer,
            llmBefore: slimLLMSnapshot(s.llmBefore),
            llmAfter: s.llmAfter,
            llmResponse: slimLLMSnapshot(s.llmResponse),
            actions: s.actions,
            timeline: s.timeline,
        })),
    };
}

function slimProblemResult(r) {
    if (!r) return null;
    return {
        agentType: r.agentType,
        problemId: r.problemId,
        problemTitle: r.problemTitle,
        lessonId: r.lessonId,
        lessonTopics: r.lessonTopics,
        correct: r.correct,
        stepsCorrect: r.stepsCorrect,
        stepsTotal: r.stepsTotal,
        firstTryRate: r.firstTryRate,
        error: r.error,
        isTestSet: r.isTestSet,
        solveTrace: slimSolveTrace(r.solveTrace),
    };
}

function slimTrainingLogEntry(entry) {
    return {
        agentType: entry.agentType,
        lessonId: entry.lessonId,
        problemIds: entry.problemIds,
        error: entry.error,
        summary: entry.summary || (entry.output
            ? {
                  problemsCompleted: entry.output.run?.problemsCompleted,
                  stepsTotal: entry.output.run?.stepsTotal,
                  stepsCorrectFirstTry: entry.output.run?.stepsCorrectFirstTry,
                  masteryEnd: entry.output.run?.masteryEnd,
              }
            : null),
    };
}

function slimScoreboardRow(row) {
    if (!row) return null;
    const agents = {};
    Object.entries(row.agents || {}).forEach(([type, a]) => {
        if (!a) {
            agents[type] = null;
            return;
        }
        agents[type] = {
            correct: a.correct,
            firstTryRate: a.firstTryRate,
            stepsCorrect: a.stepsCorrect,
            stepsTotal: a.stepsTotal,
            solveTrace: slimSolveTrace(a.solveTrace),
        };
    });
    return {
        problemId: row.problemId,
        title: row.title,
        lessonId: row.lessonId,
        lessonTopics: row.lessonTopics,
        agents,
    };
}

function slimTestEvaluation(evalReport) {
    if (!evalReport) return null;
    return {
        evaluationId: evalReport.evaluationId,
        timestamp: evalReport.timestamp,
        splitType: evalReport.splitType,
        testProblemIds: evalReport.testProblemIds,
        summary: evalReport.summary,
        scoreboard: (evalReport.scoreboard || []).map(slimScoreboardRow),
        problemResults: (evalReport.problemResults || []).map(slimProblemResult),
        winner: evalReport.winner
            ? {
                  agentType: evalReport.winner.agentType,
                  agentLabel: evalReport.winner.agentLabel,
                  score: evalReport.winner.score,
                  problemsCorrect: evalReport.winner.problemsCorrect,
                  problemsEvaluated: evalReport.winner.problemsEvaluated,
                  avgFirstTryRate: evalReport.winner.avgFirstTryRate,
              }
            : null,
        rankings: (evalReport.rankings || []).map((r) => ({
            rank: r.rank,
            agentType: r.agentType,
            agentLabel: r.agentLabel,
            score: r.score,
            problemsCorrect: r.problemsCorrect,
            problemsEvaluated: r.problemsEvaluated,
            avgFirstTryRate: r.avgFirstTryRate,
        })),
    };
}

export function buildStorableCurriculumReport(report) {
    if (!report) return null;

    return {
        reportId: report.reportId,
        timestamp: report.timestamp,
        courseName: report.courseName,
        trainingCompletedAt: report.trainingCompletedAt || report.timestamp,
        testOnly: report.testOnly || false,
        split: report.split,
        testProblems: report.testProblems,
        trainingLog: (report.trainingLog || []).map(slimTrainingLogEntry),
        testEvaluation: slimTestEvaluation(report.testEvaluation),
    };
}

export function buildExportableCurriculumReport(report) {
    return buildStorableCurriculumReport(report);
}

export function safeJsonStringify(data) {
    const seen = new WeakSet();
    return JSON.stringify(
        data,
        (_key, value) => {
            if (typeof value === "object" && value !== null) {
                if (seen.has(value)) return undefined;
                seen.add(value);
            }
            return value;
        },
        2
    );
}

export function downloadJsonFile(data, filename) {
    const clean = buildStorableCurriculumReport(data) || data;
    const json = safeJsonStringify(clean);
    const blob = new Blob([json], { type: "application/json;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    anchor.style.display = "none";
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    return json;
}

export async function loadAndExportCurriculumReport(browserStorage, courseName) {
    if (!browserStorage) return null;
    const raw = await browserStorage
        .getByKey(AGENT_CURRICULUM_REPORT_STORAGE_KEY(courseName))
        .catch(() => null);
    if (!raw) return null;
    return buildStorableCurriculumReport(raw) || raw;
}

export async function copyJsonToClipboard(data) {
    const clean = buildStorableCurriculumReport(data) || data;
    const json = safeJsonStringify(clean);
    if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(json);
        return true;
    }
    const textarea = document.createElement("textarea");
    textarea.value = json;
    textarea.style.position = "fixed";
    textarea.style.left = "-9999px";
    document.body.appendChild(textarea);
    textarea.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(textarea);
    return ok;
}
