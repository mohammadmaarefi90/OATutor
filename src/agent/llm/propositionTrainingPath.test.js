import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createPropositionBKTEngine } from "../../../proposition-bkt/src/index.js";
import {
    selectNextTrainingHint,
    resolveTrainingAnswer,
    isFullPathwayTrainingMode,
    PROP_TRAINING_HINT_MODES,
} from "./propositionTrainingPath.js";

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

function pathwayFromEngine(engine, stepId = "step-123") {
    return engine.stepContent[stepId]?.pathway || [];
}

describe("propositionTrainingPath", () => {
    it("isFullPathwayTrainingMode detects legacy mode", () => {
        assert.equal(
            isFullPathwayTrainingMode({ propTrainingHintMode: PROP_TRAINING_HINT_MODES.FULL_PATHWAY }),
            true
        );
        assert.equal(
            isFullPathwayTrainingMode({ propTrainingHintMode: PROP_TRAINING_HINT_MODES.PLANNER_GUIDED }),
            false
        );
    });

    it("partial-sequential reveals hints in pathway order", () => {
        const engine = trainedEngine();
        const pathway = pathwayFromEngine(engine);
        const settings = { propTrainingHintMode: PROP_TRAINING_HINT_MODES.PARTIAL_SEQUENTIAL };

        const first = selectNextTrainingHint(engine, {
            lessonId: FIXTURE.lessonId,
            stepId: "step-123",
            pathway,
            revealedHintIds: [],
            settings,
        });
        assert.equal(first.hint.id, pathway[0].id);
        assert.equal(first.reason, "pathway-order");

        const second = selectNextTrainingHint(engine, {
            lessonId: FIXTURE.lessonId,
            stepId: "step-123",
            pathway,
            revealedHintIds: [pathway[0].id],
            settings,
        });
        assert.equal(second.hint.id, pathway[1].id);
    });

    it("planner-guided picks a hint-linked pivot before fallback", () => {
        const engine = trainedEngine();
        const pathway = pathwayFromEngine(engine);
        const settings = { propTrainingHintMode: PROP_TRAINING_HINT_MODES.PLANNER_GUIDED };

        const pick = selectNextTrainingHint(engine, {
            lessonId: FIXTURE.lessonId,
            stepId: "step-123",
            pathway,
            revealedHintIds: [],
            settings,
        });

        assert.ok(pick?.hint?.id);
        assert.ok(
            ["planner-relevance", "pivot-hint", "weakest-chain-link", "pivot-hint-map", "pathway-fallback"].includes(
                pick.reason
            )
        );
    });

    it("returns null when all hints already revealed", () => {
        const engine = trainedEngine();
        const pathway = pathwayFromEngine(engine);
        const allIds = pathway.map((h) => h.id);

        const pick = selectNextTrainingHint(engine, {
            lessonId: FIXTURE.lessonId,
            stepId: "step-123",
            pathway,
            revealedHintIds: allIds,
            settings: { propTrainingHintMode: PROP_TRAINING_HINT_MODES.PLANNER_GUIDED },
        });
        assert.equal(pick, null);
    });

    it("resolveTrainingAnswer honors allowAnswerKey=false", () => {
        const engine = trainedEngine();
        const pathway = pathwayFromEngine(engine);
        const step = {
            stepAnswer: ["$$42$$"],
        };

        const fromHint = resolveTrainingAnswer(
            [{ id: "h1", hintAnswer: ["$$7$$"] }],
            new Set(["h1"]),
            step,
            { propTrainingAllowAnswerKey: false }
        );
        assert.equal(fromHint, "$$7$$");

        const withKey = resolveTrainingAnswer(pathway, [], step, { propTrainingAllowAnswerKey: true });
        assert.equal(withKey, "$$42$$");

        const noKey = resolveTrainingAnswer(pathway, [], step, { propTrainingAllowAnswerKey: false });
        assert.equal(noKey, null);
    });
});
