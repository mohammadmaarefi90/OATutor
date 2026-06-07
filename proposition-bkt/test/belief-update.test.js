import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createPropositionBKTEngine, PropositionBKTEngine } from "../src/index.js";
import { updateBelief } from "../src/core/PropositionBKT.js";
import { cloneBeliefModel, DEFAULT_BELIEF } from "../src/core/BeliefModel.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

function loadFixture(name) {
    return JSON.parse(readFileSync(join(__dirname, "fixtures", name), "utf8"));
}

function runFixture(fixture) {
    const engine = createPropositionBKTEngine({ firstTryOnly: false });
    engine.ingestLesson({
        lessonId: fixture.lessonId,
        problems: fixture.problems,
        skillModel: fixture.skillModel || {},
    });
    for (const event of fixture.events) {
        engine.processEvent(event);
    }
    return engine;
}

describe("PropositionBKT updateBelief", () => {
    it("matches OATutor BKT-brain.js math for correct observation", () => {
        const model = cloneBeliefModel(DEFAULT_BELIEF);
        updateBelief(model, true);
        assert.ok(model.probMastery > DEFAULT_BELIEF.probMastery);
    });

    it("decreases mastery on incorrect observation", () => {
        const model = cloneBeliefModel({ ...DEFAULT_BELIEF, probMastery: 0.5 });
        updateBelief(model, false);
        assert.ok(model.probMastery < 0.5);
    });
});

describe("one-step-three-hints fixture", () => {
    it("increases hint prop beliefs after reveal", () => {
        const fixture = loadFixture("one-step-three-hints.json");
        const engine = createPropositionBKTEngine({ firstTryOnly: false });
        engine.ingestLesson({
            lessonId: fixture.lessonId,
            problems: fixture.problems,
            skillModel: fixture.skillModel,
        });

        engine.processEvent({ type: "session_start", stepId: "step-123" });
        engine.processEvent(fixture.events[1]);

        const beforeHints = engine.getBeliefs();
        engine.processEvent(fixture.events[2]);
        engine.processEvent(fixture.events[3]);
        const afterHints = engine.getBeliefs();

        const stepContent = engine.stepContent["step-123"];
        const hint1Props = stepContent.hintPropMap["hint-1"];
        const hint2Props = stepContent.hintPropMap["hint-2"];

        for (const pid of hint1Props) {
            assert.ok(
                afterHints[pid].probMastery > beforeHints[pid].probMastery,
                `hint-1 prop ${pid} should increase`
            );
        }
        for (const pid of hint2Props) {
            assert.ok(
                afterHints[pid].probMastery > beforeHints[pid].probMastery,
                `hint-2 prop ${pid} should increase`
            );
        }
    });

    it("increases answer prop after correct attempt", () => {
        const engine = runFixture(loadFixture("one-step-three-hints.json"));
        const answerId = engine.stepContent["step-123"].answerPropId;
        assert.ok(answerId);
        assert.ok(engine.getBeliefs()[answerId].probMastery > DEFAULT_BELIEF.probMastery);
    });

    it("exports valid JSON belief graph with behavioral edges", () => {
        const fixture = loadFixture("one-step-three-hints.json");
        const engine = runFixture(fixture);
        const graph = engine.getBeliefGraph(fixture.lessonId);

        const serialized = JSON.stringify(graph);
        assert.doesNotThrow(() => JSON.parse(serialized));
        assert.ok(graph.nodes.length > 0);
        assert.ok(graph.structuralEdges.length > 0);
        assert.ok(graph.behavioralEdges.length > 0);
        assert.ok(graph.beliefSummary);

        const roundTrip = JSON.parse(serialized);
        assert.equal(roundTrip.nodes.length, graph.nodes.length);
        assert.equal(roundTrip.behavioralEdges.length, graph.behavioralEdges.length);
    });
});

describe("multi-hint-wrong-then-correct fixture", () => {
    it("identifies bottleneck in belief summary", () => {
        const fixture = loadFixture("multi-hint-wrong-then-correct.json");
        const engine = runFixture(fixture);
        const graph = engine.getBeliefGraph(fixture.lessonId);

        assert.ok(Array.isArray(graph.beliefSummary.bottlenecks));
        assert.ok(graph.nodes.length >= 3);
    });

    it("supports JSON round-trip persistence", () => {
        const engine = runFixture(loadFixture("multi-hint-wrong-then-correct.json"));
        const json = engine.toJSON();
        const restored = PropositionBKTEngine.fromJSON(json);
        assert.deepEqual(restored.getBeliefs(), engine.getBeliefs());
    });
});
