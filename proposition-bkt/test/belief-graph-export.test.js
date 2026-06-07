import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
    createPropositionBKTEngine,
    exportBeliefGraphJSON,
} from "../src/index.js";
import { computeKCAggregates } from "../src/bridge/KCAggregate.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

function loadFixture(name) {
    return JSON.parse(readFileSync(join(__dirname, "fixtures", name), "utf8"));
}

function runFixture(name) {
    const fixture = loadFixture(name);
    const engine = createPropositionBKTEngine({ firstTryOnly: false });
    engine.ingestLesson({
        lessonId: fixture.lessonId,
        problems: fixture.problems,
        skillModel: fixture.skillModel || {},
    });
    for (const event of fixture.events) engine.processEvent(event);
    return { engine, fixture };
}

describe("BeliefGraphExport", () => {
    it("produces JSON-safe export without circular references", () => {
        const { engine, fixture } = runFixture("one-step-three-hints.json");
        const exported = exportBeliefGraphJSON(engine, { lessonId: fixture.lessonId });

        assert.doesNotThrow(() => JSON.stringify(exported));
        assert.equal(typeof exported.timestamp, "number");
        assert.ok(exported.nodes.every((n) => typeof n.probMastery === "number"));
        assert.ok(exported.structuralEdges.every((e) => e.from && e.to && e.type));
    });

    it("includes beliefSummary with mastered and uncertain lists", () => {
        const { engine, fixture } = runFixture("one-step-three-hints.json");
        const exported = exportBeliefGraphJSON(engine, { lessonId: fixture.lessonId });

        assert.ok(Array.isArray(exported.beliefSummary.mastered));
        assert.ok(Array.isArray(exported.beliefSummary.uncertain));
        assert.ok(Array.isArray(exported.beliefSummary.bottlenecks));
    });

    it("computes KC aggregates via noisy-OR", () => {
        const { engine, fixture } = runFixture("one-step-three-hints.json");
        const kc = engine.getKCAggregates();
        assert.ok(kc.linear_slope >= 0 && kc.linear_slope <= 1);

        const structure = engine.structureGraphs[fixture.lessonId];
        const direct = computeKCAggregates(engine.beliefStore, structure, "noisy-or");
        assert.equal(kc.linear_slope, direct.linear_slope);
    });
});
