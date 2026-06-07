import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createPropositionBKTEngine } from "../src/index.js";
import { applyHintEvidence } from "../src/evidence/HintEvidence.js";
import BeliefStore from "../src/core/BeliefStore.js";
import StructureGraph from "../src/graph/StructureGraph.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

function loadFixture(name) {
    return JSON.parse(readFileSync(join(__dirname, "fixtures", name), "utf8"));
}

describe("HintEvidence", () => {
    it("increases belief on hint propositions with configurable weight", () => {
        const store = new BeliefStore();
        const graph = new StructureGraph("test");
        const propId = "prop-test";
        store.ensureProposition(propId, { id: propId, text: "Slope is rise over run." });
        graph.addProposition({ id: propId, text: "Slope is rise over run.", skills: [] });

        const before = store.getBelief(propId).probMastery;
        applyHintEvidence(
            store,
            graph,
            { propIds: [propId] },
            { hintEvidenceWeight: 0.5 }
        );
        const after = store.getBelief(propId).probMastery;
        assert.ok(after > before);
    });

    it("records behavioral transitions along hint pathway", () => {
        const fixture = loadFixture("one-step-three-hints.json");
        const engine = createPropositionBKTEngine({ firstTryOnly: false });
        engine.ingestLesson({
            lessonId: fixture.lessonId,
            problems: fixture.problems,
            skillModel: fixture.skillModel,
        });

        engine.processEvent({ type: "session_start", stepId: "step-123" });
        engine.processEvent(fixture.events[1]);
        engine.processEvent(fixture.events[2]);
        engine.processEvent(fixture.events[3]);

        const behavioral = engine.behavioralGraphs[fixture.lessonId];
        const edges = behavioral.getTransitionProbabilities();
        assert.ok(edges.length >= 1);
        assert.ok(edges.every((e) => e.probability >= 0 && e.probability <= 1));
    });
});
