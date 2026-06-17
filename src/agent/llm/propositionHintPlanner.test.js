import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createPropositionBKTEngine } from "../../../proposition-bkt/src/index.js";
import {
    buildStepPlan,
    selectPivotIdeas,
    mapRelevantHints,
    buildChainFromPivot,
    formatStepPlanForPrompt,
    isPropPlanningEnabled,
    buildChainContextFromPlan,
    summarizePlanForEvent,
    PLAN_VERSION,
} from "./propositionHintPlanner.js";
import { rankPropositionsForStep } from "./propositionPolicy.js";

const AGENT_LOCAL_LLM_PROP = "local-llm-prop-bkt";
const AGENT_LOCAL_LLM_PROP_CHAIN = "local-llm-prop-chain-bkt";
const AGENT_LOCAL_LLM_PROP_CHAIN_TREE = "local-llm-prop-chain-tree-bkt";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE = JSON.parse(
    readFileSync(
        join(__dirname, "../../../proposition-bkt/test/fixtures/one-step-three-hints.json"),
        "utf8"
    )
);

function trainedEngine() {
    const engine = createPropositionBKTEngine({ firstTryOnly: false });
    engine.ingestLesson({
        lessonId: FIXTURE.lessonId,
        problems: FIXTURE.problems,
        skillModel: FIXTURE.skillModel,
    });

    for (const event of FIXTURE.events) {
        engine.processEvent(event);
    }
    return engine;
}

describe("propositionHintPlanner", () => {
    it("returns empty plan when structure is missing", () => {
        const engine = createPropositionBKTEngine();
        const plan = buildStepPlan(engine, { stepId: "missing" });
        assert.equal(plan.stepIdeas.length, 0);
        assert.equal(plan.candidateChains.length, 0);
        assert.equal(plan.planVersion, PLAN_VERSION);
    });

    it("ranks step ideas after hint training", () => {
        const engine = trainedEngine();
        const plan = buildStepPlan(engine, {
            lessonId: FIXTURE.lessonId,
            stepId: "step-123",
        });

        assert.ok(plan.stepIdeas.length > 0);
        assert.ok(plan.closureSize > 0);
        assert.equal(plan.answerPropId, engine.stepContent["step-123"].answerPropId);
        assert.ok(
            plan.stepIdeas.every((idea) => idea.text && idea.text.length > 2),
            "each idea should have readable text"
        );
    });

    it("selects hint-linked pivot ideas", () => {
        const engine = trainedEngine();
        const ranking = rankPropositionsForStep(engine, {
            lessonId: FIXTURE.lessonId,
            stepId: "step-123",
        });
        const pivots = selectPivotIdeas(ranking, { maxPivots: 3 });

        assert.ok(pivots.length >= 1);
        assert.ok(pivots.every((p) => p.role === "pivot"));
        assert.ok(
            pivots.some((p) => p.sourceType === "hint"),
            "at least one pivot should come from a hint proposition"
        );
    });

    it("maps relevant hints from training pathway", () => {
        const engine = trainedEngine();
        const ranking = rankPropositionsForStep(engine, {
            lessonId: FIXTURE.lessonId,
            stepId: "step-123",
        });
        const hints = mapRelevantHints(engine, {
            lessonId: FIXTURE.lessonId,
            stepId: "step-123",
            ideas: ranking.ranked,
        });

        assert.ok(hints.length >= 2, "should surface multiple trained hints");
        const texts = hints.map((h) => h.text);
        assert.ok(
            texts.some((t) => t.includes("rise over run")),
            "hint-1 text should appear"
        );
        assert.ok(
            hints.every((h) => h.hintId && h.relevanceScore > 0),
            "each hint should have id and score"
        );
    });

    it("builds distinct chains per pivot idea", () => {
        const engine = trainedEngine();
        const plan = buildStepPlan(engine, {
            lessonId: FIXTURE.lessonId,
            stepId: "step-123",
            settings: { propPlanningMaxPivots: 3, propPlanningMaxChains: 5 },
        });

        assert.ok(plan.pivots.length >= 1);
        assert.ok(plan.candidateChains.length >= 1);

        const keys = new Set(plan.candidateChains.map((c) => c.key));
        assert.equal(keys.size, plan.candidateChains.length, "chains should be unique");

        for (const chain of plan.candidateChains) {
            assert.ok(chain.rootPropId, "chain should record its pivot root");
            assert.ok(chain.nodes?.length >= 1);
            assert.ok(typeof chain.score === "number");
            assert.ok(chain.propIds.includes(chain.rootPropId));
        }
    });

    it("buildChainFromPivot reaches the answer proposition", () => {
        const engine = trainedEngine();
        const plan = buildStepPlan(engine, {
            lessonId: FIXTURE.lessonId,
            stepId: "step-123",
        });
        const pivot = plan.pivots[0];
        assert.ok(pivot);

        const chain = buildChainFromPivot(engine, pivot.id, {
            lessonId: FIXTURE.lessonId,
            stepId: "step-123",
        });

        const answerId = engine.stepContent["step-123"].answerPropId;
        assert.ok(chain.propIds.includes(answerId));
        assert.ok(chain.linkedHintIds.length >= 1);
    });

    it("formatStepPlanForPrompt is human-readable", () => {
        const engine = trainedEngine();
        const plan = buildStepPlan(engine, {
            lessonId: FIXTURE.lessonId,
            stepId: "step-123",
        });
        const text = formatStepPlanForPrompt(plan);

        assert.ok(text.includes("Pivot ideas"));
        assert.ok(text.includes("Relevant hints"));
        assert.ok(text.includes("Candidate chains"));
        assert.ok(text.includes("rise over run"));
    });

    it("isPropPlanningEnabled only for Prop BKT and Tree agents", () => {
        const on = { propPlanningEnabled: true };
        assert.equal(isPropPlanningEnabled(on, AGENT_LOCAL_LLM_PROP), true);
        assert.equal(isPropPlanningEnabled(on, AGENT_LOCAL_LLM_PROP_CHAIN_TREE), true);
        assert.equal(isPropPlanningEnabled(on, AGENT_LOCAL_LLM_PROP_CHAIN), false);
        assert.equal(isPropPlanningEnabled({ propPlanningEnabled: false }, AGENT_LOCAL_LLM_PROP), false);
    });

    it("buildChainContextFromPlan seeds tree chains from plan", () => {
        const engine = trainedEngine();
        const plan = buildStepPlan(engine, {
            lessonId: FIXTURE.lessonId,
            stepId: "step-123",
        });
        const context = buildChainContextFromPlan(plan, { maxChains: 5 });

        assert.ok(context.chains.length >= 1);
        assert.equal(context.treeMeta.planSeeded, true);
        assert.equal(context.plan.stepId, "step-123");
        assert.ok(context.primaryChain);
    });

    it("summarizePlanForEvent produces trace-friendly payload", () => {
        const engine = trainedEngine();
        const plan = buildStepPlan(engine, {
            lessonId: FIXTURE.lessonId,
            stepId: "step-123",
        });
        const event = summarizePlanForEvent(plan, {
            agentType: AGENT_LOCAL_LLM_PROP,
            strictNoClues: true,
        });

        assert.equal(event.planVersion, PLAN_VERSION);
        assert.ok(event.pivotCount >= 1);
        assert.ok(event.relevantHints.length >= 1);
        assert.ok(event.candidateChains.length >= 1);
        assert.equal(event.strictNoClues, true);
    });
});
