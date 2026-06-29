import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
    segmentTextHeuristic,
    segmentStepHeuristic,
    alignAttemptToPropositions,
    isPropApsEnabled,
    applyApsToPropEngine,
    PROP_APS_MODES,
    APS_VERSION,
} from "./propositionSegmentation.js";
import { createPropositionBKTEngine } from "@oatutor/proposition-bkt";
import { AGENT_TYPES } from "../agentTypes.js";

describe("propositionSegmentation", () => {
    it("segmentTextHeuristic splits on discourse markers", () => {
        const segments = segmentTextHeuristic(
            "Slope is rise over run. Then subtract y-values and x-values separately."
        );
        assert.ok(segments.length >= 2);
        assert.ok(segments.some((s) => /rise over run/i.test(s)));
    });

    it("isPropApsEnabled respects agent type", () => {
        assert.equal(
            isPropApsEnabled({ propApsEnabled: true }, AGENT_TYPES.LOCAL_LLM_PROP),
            true
        );
        assert.equal(
            isPropApsEnabled({ propApsEnabled: true }, AGENT_TYPES.LOCAL_LLM),
            false
        );
        assert.equal(
            isPropApsEnabled({ propApsEnabled: false }, AGENT_TYPES.LOCAL_LLM_PROP),
            false
        );
    });

    it("segmentStepHeuristic produces step and hint props", () => {
        const step = {
            id: "step-1",
            stepTitle: "Find slope",
            stepBody: "Use rise over run. Then compute the difference.",
            stepAnswer: ["$$2$$"],
        };
        const stepContent = {
            pathway: [{ id: "h1", text: "Slope equals change in y over change in x." }],
            answerPropId: null,
        };
        const result = segmentStepHeuristic(step, stepContent, {
            propApsMaxPropositions: 8,
        });
        assert.ok(result.step.length >= 1);
        assert.ok(result.hints.h1.length >= 1);
        assert.equal(result.source, PROP_APS_MODES.HEURISTIC);
    });

    it("alignAttemptToPropositions matches overlapping text", async () => {
        const engine = createPropositionBKTEngine({ firstTryOnly: false });
        const problems = [
            {
                id: "p1",
                steps: [
                    {
                        id: "step-1",
                        stepTitle: "Slope",
                        stepBody: "Compute slope using rise over run.",
                        stepAnswer: ["$$2$$"],
                        hints: {
                            DefaultPathway: [
                                { id: "h1", text: "Slope is rise over run." },
                            ],
                        },
                    },
                ],
            },
        ];
        engine.ingestLesson({ lessonId: "L1", problems, skillModel: {} });

        await applyApsToPropEngine(engine, "L1", problems, {
            propApsMode: PROP_APS_MODES.HEURISTIC,
        });

        const aligned = alignAttemptToPropositions(
            "The slope is rise over run so the answer is 2",
            engine,
            { lessonId: "L1", stepId: "step-1" }
        );
        assert.ok(aligned.matchedPropIds.length >= 1);
    });

    it("APS_VERSION is defined", () => {
        assert.equal(typeof APS_VERSION, "string");
        assert.ok(APS_VERSION.includes("aps"));
    });
});
