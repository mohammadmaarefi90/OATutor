/**
 * Downloadable PDF documentation for curriculum / lesson test reports.
 */

import SimplePdfWriter from "./simplePdfWriter.js";
import { AGENT_META, AGENT_TYPES, LOCAL_LLM_AGENT_TYPES } from "./agentTypes.js";
import { getLLMSettingsSync } from "./llm/llmSettings.js";
import { buildStorableCurriculumReport } from "./curriculumReportExport.js";

function formatDateTime(ts) {
    if (!ts) return "Unknown";
    return new Date(ts).toLocaleString();
}

function pct(rate) {
    if (rate == null || Number.isNaN(rate)) return "—";
    return `${Math.round(rate * 100)}%`;
}

function agentLabel(type) {
    return AGENT_META[type]?.label || type;
}

function llmModelDescription() {
    const s = getLLMSettingsSync();
    if (s.provider === "cloud-gpt4") return "Cloud GPT-4 (OpenAI API)";
    return `Local ${s.localModel || "gpt-oss-20b"} via llama.cpp (${s.localBaseUrl || "127.0.0.1:8080"})`;
}

function collectTestSetSummary(report) {
    const testProblems = report.testProblems || [];
    const split = report.split?.stats || {};
    const topicCounts = {};
    const lessonCounts = {};

    for (const p of testProblems) {
        const lesson = p.lessonName || p.lessonId || "Unknown lesson";
        lessonCounts[lesson] = (lessonCounts[lesson] || 0) + 1;
        const topics = p.lessonTopics || [];
        if (topics.length === 0) {
            topicCounts["(general)"] = (topicCounts["(general)"] || 0) + 1;
        } else {
            for (const t of topics) {
                topicCounts[t] = (topicCounts[t] || 0) + 1;
            }
        }
    }

    return {
        totalProblems: testProblems.length || split.testCount || 0,
        trainCount: split.trainCount,
        lessonCount: split.lessonCount,
        splitMode: report.split?.mode || report.testEvaluation?.splitType || "holdout",
        strictNoClues: report.strictNoClues || report.testEvaluation?.strictNoClues || false,
        topicCounts,
        lessonCounts,
    };
}

function collectAgentTypes(report) {
    const types = new Set();
    (report.trainingLog || []).forEach((e) => e.agentType && types.add(e.agentType));
    (report.testEvaluation?.problemResults || []).forEach((r) => r.agentType && types.add(r.agentType));
    if (report.testEvaluation?.summary?.agents) {
        Object.keys(report.testEvaluation.summary.agents).forEach((t) => types.add(t));
    }
    if (report.agentTypes) report.agentTypes.forEach((t) => types.add(t));
    return [...types];
}

function collectResults(report) {
    const eval_ = report.testEvaluation;
    if (!eval_) return [];

    if (eval_.summary?.agents) {
        return Object.entries(eval_.summary.agents).map(([type, s]) => ({
            agentType: type,
            label: s.label || agentLabel(type),
            problemsCorrect: s.problemsCorrect,
            problemsTotal: s.problemsTotal,
            finalAccuracy: s.accuracy,
            avgFirstTryRate: s.avgFirstTryRate,
        }));
    }

    if (report.byAgent) {
        return Object.entries(report.byAgent).map(([type, s]) => ({
            agentType: type,
            label: s.agentLabel || agentLabel(type),
            problemsCorrect: s.problemsCorrect,
            problemsTotal: s.problemsEvaluated,
            finalAccuracy:
                s.problemsEvaluated > 0 ? s.problemsCorrect / s.problemsEvaluated : 0,
            avgFirstTryRate: s.avgFirstTryRate,
        }));
    }

    return (eval_.rankings || []).map((r) => ({
        agentType: r.agentType,
        label: r.agentLabel || agentLabel(r.agentType),
        problemsCorrect: r.problemsCorrect,
        problemsTotal: r.problemsEvaluated,
        finalAccuracy:
            r.problemsEvaluated > 0 ? r.problemsCorrect / r.problemsEvaluated : 0,
        avgFirstTryRate: r.avgFirstTryRate,
    }));
}

function drawAgentArchitecture(pdf, agentType) {
    if (pdf.y < 280) pdf._newPage();

    const cx = 306;
    const bw = 200;
    const bh = 36;
    let top = pdf.y - 20;

    const row = (label, yOff) => {
        pdf.box(cx - bw / 2, top - yOff - bh, bw, bh, label, { fontSize: 9 });
    };

    const arrowDown = (yOff) => {
        const y1 = top - yOff;
        const y2 = top - yOff - 18;
        pdf.arrow(cx, y1, cx, y2);
    };

    pdf.subheading(`Architecture: ${agentLabel(agentType)}`);
    pdf.paragraph(AGENT_META[agentType]?.description || "", { size: 9 });
    pdf.spacer(8);

    top = pdf.y;

    const flows = {
        [AGENT_TYPES.LOCAL_LLM]: [
            "Curriculum problems + hints",
            "Skill BKT + hint belief store",
            "Local GPT-OSS (llama.cpp)",
            "Answer check + optional hints",
        ],
        [AGENT_TYPES.LOCAL_LLM_PROP]: [
            "Lesson structure graph",
            "Propositional BKT beliefs",
            "Relevance-ranked idea prompt",
            "Local GPT-OSS → answer",
        ],
        [AGENT_TYPES.LOCAL_LLM_PROP_CHAIN]: [
            "Structure graph → chain paths",
            "Chain store + Prop BKT",
            "Score & try chains (loop)",
            "Local GPT-OSS → conclusion",
        ],
        [AGENT_TYPES.LOCAL_LLM_PROP_CHAIN_TREE]: [
            "Prop BKT + structure graph",
            "Beam tree (relevant next idea)",
            "Rank complete chains",
            "Local GPT-OSS → conclusion",
        ],
        [AGENT_TYPES.MEMORY]: [
            "Episodic memory recall",
            "Hint pathway graph",
            "Skill BKT update",
            "Step answer",
        ],
        [AGENT_TYPES.RL]: [
            "Q-table policy",
            "Recall / hint / explore",
            "Skill BKT reward",
            "Step answer",
        ],
        [AGENT_TYPES.LLM]: [
            "Cloud LLM query",
            "Hint fallback",
            "Skill BKT update",
            "Step answer",
        ],
    };

    const steps = flows[agentType] || [
        "Training on curriculum",
        "Agent state (beliefs / memory)",
        "Problem solving",
        "Evaluation",
    ];

    let off = 0;
    for (let i = 0; i < steps.length; i++) {
        if (i > 0) arrowDown(off);
        off += i === 0 ? 0 : 54;
        row(steps[i], off);
        off += bh + 8;
    }

    pdf.y = top - off - 30;
    pdf.spacer(16);
}

function buildPdfDocument(report, { title, subtitle } = {}) {
    const clean = buildStorableCurriculumReport(report) || report;
    const pdf = new SimplePdfWriter();
    const testTs = clean.testEvaluation?.timestamp || clean.timestamp;
    const trainedAt = clean.trainingCompletedAt;
    const testSummary = collectTestSetSummary(clean);
    const agentTypes = collectAgentTypes(clean);
    const results = collectResults(clean);

    pdf.heading(title || "OATutor Agent Test Report");
    if (subtitle) pdf.paragraph(subtitle, { size: 11 });
    pdf.spacer(8);

    pdf.subheading("1. Test date & time");
    pdf.bullet(`Test run: ${formatDateTime(testTs)}`);
    if (trainedAt && trainedAt !== testTs) {
        pdf.bullet(`Training completed: ${formatDateTime(trainedAt)}`);
    }
    pdf.bullet(`Report ID: ${clean.reportId || clean.testEvaluation?.evaluationId || "—"}`);
    pdf.spacer(8);

    pdf.subheading("2. Trained agents & model");
    pdf.bullet(`Reasoning model: ${llmModelDescription()}`);
    pdf.bullet(
        `Evaluation mode: ${
            testSummary.strictNoClues
                ? "Strict no-clue (hints stripped, no fallback)"
                : "Standard test (hint rescue allowed on failure)"
        }`
    );
    if (agentTypes.length === 0) {
        pdf.bullet("No agent types recorded in this report.");
    } else {
        for (const t of agentTypes) {
            const meta = AGENT_META[t];
            pdf.bullet(
                `${meta?.label || t} — BKT mode: ${meta?.bktMode || "skill / legacy"}`
            );
        }
    }
    pdf.spacer(8);

    pdf.subheading("3. Test set summary");
    pdf.bullet(`Problems in test set: ${testSummary.totalProblems}`);
    if (testSummary.trainCount != null) {
        pdf.bullet(`Problems used for training (course split): ${testSummary.trainCount}`);
    }
    if (testSummary.lessonCount != null) {
        pdf.bullet(`Lessons covered: ${testSummary.lessonCount}`);
    }
    pdf.bullet(`Split mode: ${testSummary.splitMode}`);
    pdf.spacer(4);
    pdf.paragraph("Problems by lesson / part:", { size: 10 });
    const lessonEntries = Object.entries(testSummary.lessonCounts).sort(
        (a, b) => b[1] - a[1]
    );
    if (lessonEntries.length === 0) {
        pdf.bullet("(Lesson breakdown not stored in this report.)");
    } else {
        for (const [lesson, count] of lessonEntries.slice(0, 24)) {
            pdf.bullet(`${lesson}: ${count} problem(s)`);
        }
        if (lessonEntries.length > 24) {
            pdf.bullet(`… and ${lessonEntries.length - 24} more lessons`);
        }
    }
    pdf.spacer(4);
    pdf.paragraph("Topic / category coverage (from lesson topics):", { size: 10 });
    const topicEntries = Object.entries(testSummary.topicCounts).sort(
        (a, b) => b[1] - a[1]
    );
    if (topicEntries.length === 0) {
        pdf.bullet("(No topic tags on test problems.)");
    } else {
        for (const [topic, count] of topicEntries.slice(0, 20)) {
            pdf.bullet(`${topic}: ${count} problem(s)`);
        }
    }
    pdf.spacer(8);

    pdf.subheading("4. Test results");
    if (testSummary.strictNoClues) {
        pdf.paragraph(
            "Under strict no-clue evaluation, first-try performance equals final outcome (no hint rescue).",
            { size: 9 }
        );
    } else {
        pdf.paragraph(
            "First-try = LLM answer before hints. Final accuracy = all steps correct (may include hint fallback).",
            { size: 9 }
        );
    }
    pdf.spacer(4);
    pdf.tableRow(
        ["Agent", "Final (problems)", "Final accuracy", "Avg first-try"],
        { bold: true }
    );
    for (const r of results) {
        pdf.tableRow([
            r.label,
            `${r.problemsCorrect}/${r.problemsTotal}`,
            pct(r.finalAccuracy),
            pct(r.avgFirstTryRate),
        ]);
    }
    if (clean.testEvaluation?.winner) {
        pdf.spacer(6);
        pdf.paragraph(
            `Best overall on this test set: ${clean.testEvaluation.winner.agentLabel} (score ${(clean.testEvaluation.winner.score || 0).toFixed(2)})`,
            { size: 10 }
        );
    }
    pdf.spacer(12);

    pdf.subheading("5. Agent architecture diagrams");
    pdf.paragraph(
        "High-level design of each agent evaluated in this report (curriculum-grounded interpretable reasoners).",
        { size: 9 }
    );
    pdf.spacer(8);

    const archTypes =
        agentTypes.length > 0
            ? agentTypes
            : LOCAL_LLM_AGENT_TYPES;

    for (const t of archTypes) {
        drawAgentArchitecture(pdf, t);
    }

    pdf.spacer(12);
    pdf.paragraph(
        "Generated by OATutor Agent Lab. JSON report retains per-problem walkthrough traces.",
        { size: 8 }
    );

    return pdf;
}

export function downloadCurriculumTestReportPdf(report, { courseName } = {}) {
    const clean = buildStorableCurriculumReport(report) || report;
    if (!clean?.testEvaluation) {
        throw new Error("No test evaluation data in report.");
    }
    const safe = (courseName || clean.courseName || "course").replace(/[^a-z0-9]/gi, "_");
    const pdf = buildPdfDocument(clean, {
        title: "Curriculum Agent Test Report",
        subtitle: `Course: ${courseName || clean.courseName || "Unknown"}`,
    });
    pdf.download(`oatutor-test-report-${safe}-${Date.now()}.pdf`);
}

export function downloadLessonEvaluationReportPdf(
    report,
    { lessonName, lessonId } = {}
) {
    if (!report?.problemResults?.length && !report?.byAgent) {
        throw new Error("No evaluation results to export.");
    }
    const wrapped = {
        timestamp: report.timestamp,
        reportId: report.evaluationId,
        testEvaluation: {
            timestamp: report.timestamp,
            evaluationId: report.evaluationId,
            strictNoClues: report.strictNoClues || false,
            summary: null,
            problemResults: report.problemResults,
            winner: report.winner,
            rankings: report.rankings,
        },
        byAgent: report.byAgent,
        agentTypes: report.agentTypes,
        testProblems: (report.problemResults || []).map((r) => ({
            id: r.problemId,
            title: r.problemTitle,
            lessonId: r.lessonId || lessonId,
            lessonName: lessonName || lessonId,
            lessonTopics: r.lessonTopics || [],
            steps: r.stepsTotal ? [{ length: r.stepsTotal }] : [],
        })),
    };
    const safe = (lessonName || lessonId || "lesson").replace(/[^a-z0-9]/gi, "_");
    const pdf = buildPdfDocument(wrapped, {
        title: "Lesson Agent Evaluation Report",
        subtitle: `Lesson: ${lessonName || lessonId || "Unknown"}`,
    });
    pdf.download(`oatutor-lesson-eval-${safe}-${Date.now()}.pdf`);
}
