/**
 * PDF technical report: Proposition BKT + Hint Planning Module.
 * Generate via: npm run report:prop-bkt-planning
 */

import SimplePdfWriter from "./simplePdfWriter.js";

function drawFlow(pdf, title, steps) {
    if (pdf.y < 220) pdf._newPage();
    pdf.subheading(title);
    const cx = 306;
    const bw = 220;
    const bh = 32;
    let top = pdf.y - 8;
    let off = 0;

    for (let i = 0; i < steps.length; i++) {
        if (i > 0) {
            const y1 = top - off;
            const y2 = top - off - 16;
            pdf.arrow(cx, y1, cx, y2);
            off += 48;
        }
        pdf.box(cx - bw / 2, top - off - bh, bw, bh, steps[i], { fontSize: 8 });
        off += bh + 6;
    }
    pdf.y = top - off - 24;
    pdf.spacer(8);
}

export function buildPropBktPlanningReportPdf() {
    const pdf = new SimplePdfWriter();
    const date = new Date().toLocaleDateString("en-US", {
        year: "numeric",
        month: "long",
        day: "numeric",
    });

    pdf.heading("Proposition BKT with Hint Planning Module");
    pdf.paragraph("OATutor Technical Report", { size: 11 });
    pdf.paragraph(`Generated: ${date}  |  Plan version: hint-plan-v1`, { size: 9 });
    pdf.spacer(10);

    pdf.subheading("1. Executive Summary");
    pdf.paragraph(
        "Propositional BKT (Prop BKT) tracks P(know proposition) for individual mathematical ideas " +
            "extracted from step text, hints, and answers — instead of coarse skill-level BKT. " +
            "The hint planning module compiles trained beliefs and lesson structure into a per-step plan: " +
            "pivot ideas, relevant training hints, and scored reasoning chains — without calling an LLM.",
        { size: 10 }
    );
    pdf.spacer(4);
    pdf.paragraph("Planning applies only to:", { size: 10 });
    pdf.bullet("Local GPT-OSS + Propositional BKT (local-llm-prop-bkt)");
    pdf.bullet("Local GPT-OSS + Prop BKT Chain Tree (local-llm-prop-chain-tree-bkt)");
    pdf.paragraph("Default: propPlanningEnabled = false (opt-in via LLM settings).", { size: 9 });
    pdf.spacer(8);

    pdf.subheading("2. Skill BKT vs Proposition BKT");
    pdf.tableRow(["Dimension", "Skill BKT", "Prop BKT"], { bold: true });
    pdf.tableRow(["Unit", "Knowledge component", "Individual proposition"]);
    pdf.tableRow(["LLM input", "Hint text list", "Ranked ideas + structure"]);
    pdf.tableRow(["Graph", "None", "Structure + behavioral"]);
    pdf.tableRow(["Graduation", "Avg KC >= 95%", "Answer props >= threshold"]);
    pdf.spacer(8);

    pdf.subheading("3. System Architecture");
    drawFlow(pdf, "High-level data flow", [
        "Lesson content ingest",
        "StructureGraph + BeliefStore",
        "Prop BKT agent training",
        "buildStepPlan (hint-plan-v1)",
        "gpt-oss LLM prompt",
        "Step answer + BKT update",
    ]);

    pdf.subheading("4. Content Ingestion");
    pdf.paragraph(
        "Each step is decomposed into propositions linked by structural edges: sequence, prerequisite, " +
            "supports, depends, step-to-hint, and skill-link.",
        { size: 10 }
    );
    pdf.bullet("Step propositions — from step body text");
    pdf.bullet("Hint propositions — from hint pathway");
    pdf.bullet("Answer proposition — target for reasoning chains");
    pdf.bullet("stepContent stores pathway, hintPropMap, answerPropId per step");
    pdf.spacer(8);

    pdf.subheading("5. Belief Updates (Training)");
    pdf.tableRow(["Event", "Effect"], { bold: true });
    pdf.tableRow(["attempt", "Updates answer + supporting props"]);
    pdf.tableRow(["hint_reveal", "Increases P(know) for hint-linked ideas"]);
    pdf.tableRow(["session_start/end", "Step session bookkeeping"]);
    pdf.paragraph("Default prior P(know) ~ 0.1; mastery threshold 95%.", { size: 9 });
    pdf.spacer(8);

    pdf.subheading("6. Prop BKT Solve Loop");
    drawFlow(pdf, "Per-step agent flow", [
        "Ingest lesson + session_start",
        "Planning on? buildStepPlan : hint ranking",
        "Query gpt-oss (LaTeX answer)",
        "Correct? BKT update : hint fallback (training)",
        "step-complete event",
    ]);

    pdf.subheading("7. Plan C Ranking (plan-c-v1)");
    pdf.paragraph(
        "Without planning, propositions in the prerequisite closure are ranked by uncertainty, " +
            "structural importance, and source type (hint > step > answer).",
        { size: 10 }
    );
    pdf.paragraph("Priority = 0.55*uncertainty + 0.30*structure + 0.15*source - 0.5 if mastered", {
        size: 9,
    });
    pdf.spacer(8);

    pdf._newPage();
    pdf.subheading("8. Hint Planning Module");
    pdf.paragraph(
        "Entry point: buildStepPlan(propEngine, { lessonId, stepId, settings }). Pure JavaScript — no LLM.",
        { size: 10 }
    );
    drawFlow(pdf, "Planning pipeline", [
        "rankPropositionsForStep",
        "selectPivotIdeas (hint-linked first)",
        "mapRelevantHints (training pathway)",
        "buildChainFromPivot per pivot",
        "scoreChain + sort",
    ]);

    pdf.subheading("9. Plan Output Schema");
    pdf.bullet("stepIdeas — ranked propositions (suggest, known, pivot roles)");
    pdf.bullet("pivots — top teachable ideas seeding distinct chains");
    pdf.bullet("relevantHints — hint texts scored by idea relevance");
    pdf.bullet("candidateChains — one scored chain per pivot toward answer");
    pdf.bullet("primaryChain — highest-scoring candidate");
    pdf.spacer(8);

    pdf.subheading("10. Chain Scoring (prop-chain-v1)");
    pdf.paragraph(
        "score = 0.35*readiness + 0.30*history + 0.20*graphBoost + 0.15*urgency",
        { size: 10 }
    );
    pdf.paragraph(
        "readiness = avg P(know) along chain; history = chain store success; " +
            "graphBoost = reasoning graph transitions; urgency = unmastered non-target nodes.",
        { size: 9 }
    );
    pdf.spacer(8);

    pdf.subheading("11. Example Plan (conceptual)");
    pdf.paragraph("Step: Find slope through (1,2) and (3,8).", { size: 10 });
    pdf.bullet("Pivot 1 [42%]: Slope is rise over run.");
    pdf.bullet("Pivot 2 [38%]: Subtract y-values and x-values separately.");
    pdf.bullet("Hint 1: Slope is rise over run.");
    pdf.bullet("Chain (0.71): rise over run -> subtract values -> slope formula");
    pdf.spacer(8);

    pdf.subheading("12. Agent Integration");
    pdf.paragraph("Phase 2 — Prop BKT agent:", { size: 10 });
    pdf.bullet("buildStepPlan per step; emit prop-plan event");
    pdf.bullet("formatStepPlanForPrompt injected into gpt-oss messages");
    pdf.bullet("Falls back to standard hint retrieval if planning fails");
    pdf.spacer(4);
    pdf.paragraph("Phase 3 — Chain Tree agent:", { size: 10 });
    pdf.bullet("Seeds chains from plan.candidateChains");
    pdf.bullet("Merges beam tree if fewer chains than maxAttempts");
    pdf.bullet("Existing _tryChain loop unchanged");
    pdf.spacer(8);

    pdf._newPage();
    pdf.subheading("13. Configuration");
    pdf.tableRow(["Setting", "Default", "Description"], { bold: true });
    pdf.tableRow(["propPlanningEnabled", "false", "Master switch"]);
    pdf.tableRow(["propPlanningMaxPivots", "3", "Max pivot ideas"]);
    pdf.tableRow(["propPlanningMaxChains", "5", "Max candidate chains"]);
    pdf.tableRow(["propPlanningMaxHints", "8", "Max relevant hints"]);
    pdf.tableRow(["propPolicyMasteryThreshold", "0.95", "Mastered cutoff"]);
    pdf.tableRow(["maxBeliefsInPrompt", "12", "Ideas in ranking"]);
    pdf.spacer(8);

    pdf.subheading("14. Strict No-Clue Evaluation");
    pdf.paragraph(
        "Training allows hint fallback on LLM failure (inflates first-try rate). " +
            "Strict no-clue evaluation strips live hints — the hint plan becomes primary injected knowledge.",
        { size: 10 }
    );
    pdf.tableRow(["Mode", "Hint fallback", "Planning value"], { bold: true });
    pdf.tableRow(["Training", "Yes", "Optional assist"]);
    pdf.tableRow(["Strict eval", "No", "High — plan is main memory"]);
    pdf.spacer(8);

    pdf.subheading("15. UI Trace Events");
    pdf.tableRow(["Event", "When"], { bold: true });
    pdf.tableRow(["prop-plan", "Plan built per step"]);
    pdf.tableRow(["hint-retrieval", "Mode hint-plan or relevance"]);
    pdf.tableRow(["prop-policy", "Plan C ranking (planning off)"]);
    pdf.tableRow(["llm-response / llm-error", "gpt-oss result"]);
    pdf.tableRow(["step-complete", "Final correctness"]);
    pdf.spacer(8);

    pdf.subheading("16. Agent Mode Comparison");
    pdf.tableRow(["Mode", "LLM input", "Best for"], { bold: true });
    pdf.tableRow(["Default Prop BKT", "Flat ranking", "General training"]);
    pdf.tableRow(["+ Planning", "Ideas+hints+chains", "Strict no-clue"]);
    pdf.tableRow(["Prop Chain", "One chain at a time", "Chain loops"]);
    pdf.tableRow(["Prop Tree", "Beam branches", "Branching reasoning"]);
    pdf.spacer(8);

    pdf.subheading("17. Key Source Files");
    pdf.bullet("proposition-bkt/ — standalone Prop BKT library");
    pdf.bullet("src/agent/LocalPropositionalLLMAgent.js — Prop BKT + planning");
    pdf.bullet("src/agent/LocalPropositionalChainTreeLLMAgent.js — Tree + plan seeding");
    pdf.bullet("src/agent/llm/propositionHintPlanner.js — planning module");
    pdf.bullet("src/agent/llm/propositionPolicy.js — Plan C ranking");
    pdf.bullet("src/agent/llm/propositionChainReasoning.js — chain build/score");
    pdf.bullet("src/agent/llm/llmSettings.js — planning settings");
    pdf.bullet("npm run test:planner — 10 unit tests");
    pdf.spacer(8);

    pdf.subheading("18. Limitations");
    pdf.bullet("Planning requires prior training — empty beliefs yield weak plans");
    pdf.bullet("Training hint fallback inflates first-try metrics; use strict eval");
    pdf.bullet("Quality depends on hint pathway richness and graph connectivity");
    pdf.bullet("Planner is heuristic — no semantic LLM reasoning in planning");
    pdf.bullet("Linear Prop Chain agent does not use planning");
    pdf.bullet("Longer prompts increase gpt-oss latency; use timeout not max_tokens");
    pdf.spacer(8);

    pdf.subheading("19. Suggested Evaluation Protocol");
    drawFlow(pdf, "Benchmark workflow", [
        "Train Prop BKT (30 problems)",
        "Enable planning + save settings",
        "Strict no-clue eval (held-out)",
        "Compare planning on vs off",
        "Report: accuracy, plan coverage, LLM errors",
    ]);

    pdf.spacer(12);
    pdf.paragraph(
        "OATutor — Propositional Interpretability XAI. " +
            "Report generated from propositionHintPlanner.js (hint-plan-v1) and @oatutor/proposition-bkt.",
        { size: 8 }
    );

    return pdf;
}

export function getPropBktPlanningReportBuffer() {
    return buildPropBktPlanningReportPdf().toBuffer();
}
