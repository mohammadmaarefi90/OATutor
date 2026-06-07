#!/usr/bin/env node
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createPropositionBKTEngine, exportBeliefGraphJSON } from "../src/index.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");

function parseArgs(argv) {
    const args = { fixture: "test/fixtures/one-step-three-hints.json", export: null };
    for (let i = 2; i < argv.length; i++) {
        if (argv[i] === "--fixture" && argv[i + 1]) args.fixture = argv[++i];
        else if (argv[i] === "--export" && argv[i + 1]) args.export = argv[++i];
    }
    return args;
}

function topByMastery(beliefs, propositions, n = 5) {
    return Object.entries(beliefs)
        .map(([id, m]) => ({
            id,
            text: propositions[id]?.text?.slice(0, 60) || id,
            probMastery: m.probMastery,
        }))
        .sort((a, b) => b.probMastery - a.probMastery)
        .slice(0, n);
}

function topUncertain(beliefs, propositions, n = 3) {
    return Object.entries(beliefs)
        .map(([id, m]) => ({
            id,
            text: propositions[id]?.text?.slice(0, 60) || id,
            probMastery: m.probMastery,
        }))
        .sort((a, b) => Math.abs(a.probMastery - 0.5) - Math.abs(b.probMastery - 0.5))
        .slice(0, n);
}

function printState(label, engine) {
    console.log(`\n=== ${label} ===`);
    const beliefs = engine.getBeliefs();
    const props = engine.beliefStore.getAllPropositions();
    const deltas = engine.getBeliefDeltas();

    console.log("\nTop 5 by P(know):");
    topByMastery(beliefs, props).forEach((p, i) => {
        console.log(`  ${i + 1}. [${p.probMastery.toFixed(3)}] ${p.text}`);
    });

    console.log("\nTop 3 uncertain:");
    topUncertain(beliefs, props).forEach((p, i) => {
        console.log(`  ${i + 1}. [${p.probMastery.toFixed(3)}] ${p.text}`);
    });

    if (Object.keys(deltas).length > 0) {
        console.log("\nDelta since previous event:");
        Object.values(deltas)
            .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))
            .slice(0, 5)
            .forEach((d) => {
                const sign = d.delta >= 0 ? "+" : "";
                console.log(`  ${sign}${d.delta.toFixed(4)} → [${d.probMastery.toFixed(3)}] ${d.text?.slice(0, 50) || ""}`);
            });
    }
}

const args = parseArgs(process.argv);
const fixturePath = resolve(root, args.fixture);
const fixture = JSON.parse(readFileSync(fixturePath, "utf8"));

const engine = createPropositionBKTEngine({
    firstTryOnly: false,
    hintEvidenceWeight: 0.5,
});

engine.ingestLesson({
    lessonId: fixture.lessonId,
    problems: fixture.problems,
    skillModel: fixture.skillModel || {},
});

console.log(`Proposition-BKT Demo — ${fixture.description || fixture.lessonId}`);
console.log(`Fixture: ${args.fixture}`);

for (const event of fixture.events) {
    const label = `${event.type}${event.hintId ? ` (${event.hintId})` : ""}${event.correct != null ? ` correct=${event.correct}` : ""}`;
    engine.processEvent(event);
    printState(label, engine);
}

const graph = exportBeliefGraphJSON(engine, { lessonId: fixture.lessonId });
console.log("\n=== Belief Summary ===");
console.log(`  Mastered: ${graph.beliefSummary.mastered.length}`);
console.log(`  Uncertain: ${graph.beliefSummary.uncertain.length}`);
console.log(`  Bottlenecks: ${graph.beliefSummary.bottlenecks.length}`);
console.log(`  Behavioral edges: ${graph.behavioralEdges.length}`);

const kcAggregates = engine.getKCAggregates();
console.log("\nKC Aggregates (noisy-OR):");
for (const [kcName, p] of Object.entries(kcAggregates)) {
    console.log(`  ${kcName}: ${p.toFixed(3)}`);
}

if (args.export) {
    const outPath = resolve(root, args.export);
    mkdirSync(dirname(outPath), { recursive: true });
    writeFileSync(outPath, JSON.stringify(graph, null, 2));
    console.log(`\nExported belief graph → ${args.export}`);
}
