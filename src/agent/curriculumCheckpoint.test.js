import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
    buildTrainingUnits,
    canResumeCheckpoint,
    CHECKPOINT_STATUS,
    isTrainingProgressComplete,
    reconcileCompletedUnitsIfAllProblemsDone,
    splitConfigMatches,
} from "./curriculumCheckpoint.js";

const lessons = [
    { id: "L1", name: "Lesson 1", topics: "A" },
    { id: "L2", name: "Lesson 2", topics: "B" },
];

const trainByLesson = {
    L1: { train: ["p1", "p2"] },
    L2: { train: ["p3"] },
};

const units = buildTrainingUnits(["local-llm-prop-bkt"], lessons, trainByLesson);

describe("curriculumCheckpoint resume", () => {
    it("splitConfigMatches treats null testRatio as equal", () => {
        assert.equal(
            splitConfigMatches(
                { mode: "full-train-stratified-test", seed: "s", testRatio: null, testPerLesson: 3, testProblemIds: ["t1"] },
                { mode: "full-train-stratified-test", seed: "s", testRatio: undefined, testPerLesson: 3, testProblemIds: ["t1"] }
            ),
            true
        );
    });

    it("reconcileCompletedUnitsIfAllProblemsDone adds missing unit keys", () => {
        const unitsDup = [
            { key: "agent::L1", trainIds: ["p1", "p2", "p3"] },
            { key: "agent::L2", trainIds: ["p1", "p2", "p3"] },
        ];
        const added = reconcileCompletedUnitsIfAllProblemsDone(unitsDup, [
            "agent::L1",
            "agent::L2",
        ]);
        assert.deepEqual(added, []);

        const partial = reconcileCompletedUnitsIfAllProblemsDone(unitsDup, ["agent::L1"]);
        assert.deepEqual(partial, []);
    });

    it("canResumeCheckpoint allows resume when all train problems done but unit count short", () => {
        const checkpoint = {
            status: CHECKPOINT_STATUS.IN_PROGRESS,
            agentTypes: ["local-llm-prop-bkt"],
            completedUnits: [units[0].key],
            split: {
                mode: "full-train-stratified-test",
                seed: "s",
                testRatio: null,
                testPerLesson: 3,
                testProblemIds: [],
            },
            progress: {
                completedUnits: 1,
                totalUnits: 2,
                completedProblems: 3,
                totalProblems: 3,
            },
        };

        assert.equal(
            canResumeCheckpoint(checkpoint, {
                agentTypes: ["local-llm-prop-bkt"],
                split: checkpoint.split,
            }),
            true
        );
    });

    it("isTrainingProgressComplete accepts all-problems-done with incomplete unit count", () => {
        assert.equal(
            isTrainingProgressComplete({
                status: CHECKPOINT_STATUS.IN_PROGRESS,
                progress: {
                    completedUnits: 23,
                    totalUnits: 24,
                    completedProblems: 2335,
                    totalProblems: 2335,
                },
            }),
            true
        );
    });
});
