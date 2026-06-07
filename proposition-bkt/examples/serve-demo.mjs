#!/usr/bin/env node
import { createServer } from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createPropositionBKTEngine, exportBeliefGraphJSON } from "../src/index.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const PORT = Number(process.env.PROP_BKT_PORT || 8787);

function loadFixture(name) {
    const path = join(root, "test/fixtures", name);
    if (!existsSync(path)) throw new Error(`Fixture not found: ${name}`);
    return JSON.parse(readFileSync(path, "utf8"));
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

function runSimulation(fixture) {
    const engine = createPropositionBKTEngine({ firstTryOnly: false, hintEvidenceWeight: 0.5 });
    engine.ingestLesson({
        lessonId: fixture.lessonId,
        problems: fixture.problems,
        skillModel: fixture.skillModel || {},
    });

    const steps = [];
    for (const event of fixture.events) {
        engine.processEvent(event);
        const beliefs = engine.getBeliefs();
        const props = engine.beliefStore.getAllPropositions();
        const deltas = engine.getBeliefDeltas();
        const top5 = topByMastery(beliefs, props).map((p) => ({
            ...p,
            delta: deltas[p.id]?.delta ?? null,
        }));
        const label = `${event.type}${event.hintId ? ` (${event.hintId})` : ""}${event.correct != null ? ` correct=${event.correct}` : ""}`;
        steps.push({ label, top5 });
    }

    const graph = exportBeliefGraphJSON(engine, { lessonId: fixture.lessonId });
    const kc = engine.getKCAggregates();
    return { steps, graph, kc };
}

let lastGraph = null;

const server = createServer((req, res) => {
    const url = new URL(req.url, `http://localhost:${PORT}`);

    if (url.pathname === "/" || url.pathname === "/demo") {
        const html = readFileSync(join(__dirname, "demo.html"), "utf8");
        res.writeHead(200, { "Content-Type": "text/html" });
        res.end(html);
        return;
    }

    if (url.pathname === "/api/run") {
        try {
            const fixtureName = url.searchParams.get("fixture") || "one-step-three-hints.json";
            const result = runSimulation(loadFixture(fixtureName));
            lastGraph = result.graph;
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify(result));
        } catch (err) {
            res.writeHead(500, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: err.message }));
        }
        return;
    }

    if (url.pathname === "/api/graph") {
        try {
            const fixtureName = url.searchParams.get("fixture");
            const graph = fixtureName
                ? runSimulation(loadFixture(fixtureName)).graph
                : lastGraph || runSimulation(loadFixture("one-step-three-hints.json")).graph;
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify(graph, null, 2));
        } catch (err) {
            res.writeHead(500, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: err.message }));
        }
        return;
    }

    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end("Not found");
});

server.listen(PORT, () => {
    console.log(`Proposition-BKT demo server running at http://localhost:${PORT}/`);
    console.log(`Belief graph API: http://localhost:${PORT}/api/graph`);
});
