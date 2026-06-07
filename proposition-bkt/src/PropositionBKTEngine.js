import BeliefStore from "./core/BeliefStore.js";
import { DEFAULT_BELIEF, cloneBeliefModel } from "./core/BeliefModel.js";
import StructureGraph from "./graph/StructureGraph.js";
import BehavioralGraph from "./graph/BehavioralGraph.js";
import { exportBeliefGraph, exportBeliefGraphJSON } from "./graph/BeliefGraphExport.js";
import {
    ingestStepContent,
    ingestHintPathway,
    linkHintsToStep,
} from "./extract/contentIngest.js";
import { applyAttemptEvidence } from "./evidence/AttemptEvidence.js";
import { applyHintEvidence, applyWrongPathAfterHint } from "./evidence/HintEvidence.js";
import { mapAttemptEvent, mapHintRevealEvent } from "./evidence/EvidenceMapper.js";
import { computeKCAggregates } from "./bridge/KCAggregate.js";
import { selectNextProblem } from "./selection/propositionProblemSelect.js";
import { checkGraduation } from "./selection/graduation.js";

export function createPropositionBKTEngine(config = {}) {
    return new PropositionBKTEngine(config);
}

export default class PropositionBKTEngine {
    constructor(config = {}) {
        this.defaultBelief = cloneBeliefModel(config.defaultBelief || DEFAULT_BELIEF);
        this.masteryThreshold = config.masteryThreshold ?? 0.95;
        this.hintEvidenceWeight = config.hintEvidenceWeight ?? 0.5;
        this.firstTryOnly = config.firstTryOnly ?? true;
        this.kcAggregateStrategy = config.kcAggregateStrategy ?? "noisy-or";

        this.beliefStore = new BeliefStore(this.defaultBelief);
        this.lessonId = null;
        /** @type {Record<string, StructureGraph>} */
        this.structureGraphs = {};
        /** @type {Record<string, BehavioralGraph>} */
        this.behavioralGraphs = {};
        /** @type {Record<string, object>} */
        this.problemContent = {};
        /** @type {Record<string, object>} */
        this.stepContent = {};
        this.session = null;
        this.previousBeliefs = {};
    }

    ingestLesson({ lessonId, problems, skillModel = {} }) {
        this.lessonId = lessonId;
        const structure = new StructureGraph(lessonId);
        const behavioral = new BehavioralGraph(lessonId);

        for (const problem of problems) {
            for (const step of problem.steps || []) {
                const skills = skillModel[step.id] || step.knowledgeComponents || [];
                const stepResult = ingestStepContent(step, problem.id, skills);
                const hintResult = step.hints
                    ? ingestHintPathway(step.hints, step, problem.id, skills)
                    : { propositions: [], edges: [], hintNodeMap: {}, pathway: [] };

                const allProps = [...stepResult.propositions, ...hintResult.propositions];
                const allEdges = [
                    ...stepResult.edges,
                    ...hintResult.edges,
                    ...linkHintsToStep(stepResult, hintResult),
                ];

                for (const p of allProps) {
                    structure.addProposition(p);
                    this.beliefStore.ensureProposition(p.id, p);
                }
                structure.addEdges(allEdges);

                this.stepContent[step.id] = {
                    problemId: problem.id,
                    stepPropIds: stepResult.stepPropIds,
                    answerPropId: stepResult.answerPropId,
                    hintPropMap: hintResult.hintNodeMap,
                    pathway: hintResult.pathway,
                };
            }
            this.problemContent[problem.id] = {
                steps: (problem.steps || []).map((s) => this.stepContent[s.id]),
            };
        }

        this.structureGraphs[lessonId] = structure;
        this.behavioralGraphs[lessonId] = behavioral;
        return structure;
    }

    _snapshotBeliefs() {
        this.previousBeliefs = this.beliefStore.getBeliefs();
    }

    _startSession(event) {
        this.session = {
            startedAt: event.timestamp ?? Date.now(),
            stepId: event.stepId,
            hintsRevealed: [],
            hintPropMap: {},
            lastActivePropId: null,
            wrongAttemptsOnPath: 0,
        };
        const stepContent = this.stepContent[event.stepId];
        if (stepContent) {
            this.session.hintPropMap = stepContent.hintPropMap || {};
        }
    }

    processEvent(event) {
        this._snapshotBeliefs();

        if (event.type === "session_start") {
            this._startSession(event);
            return { type: "session_start" };
        }

        if (event.type === "session_end") {
            this.session = null;
            return { type: "session_end" };
        }

        if (!this.session && event.stepId) {
            this._startSession(event);
        }

        const stepContent = this.stepContent[event.stepId] || {};
        const structure = this.structureGraphs[this.lessonId];
        const behavioral = this.behavioralGraphs[this.lessonId];
        const evidenceConfig = {
            firstTryOnly: this.firstTryOnly,
            hintEvidenceWeight: this.hintEvidenceWeight,
            masteryThreshold: this.masteryThreshold,
        };

        if (event.type === "hint_reveal") {
            const mapped = mapHintRevealEvent(event, stepContent.hintPropMap || {});
            const result = applyHintEvidence(
                this.beliefStore,
                structure,
                mapped,
                evidenceConfig
            );

            if (this.session) {
                this.session.hintsRevealed.push(mapped.hintId);
                const firstProp = mapped.propIds[0];
                if (this.session.lastActivePropId && firstProp) {
                    behavioral.recordTransition(this.session.lastActivePropId, firstProp, {
                        type: "hint",
                        label: mapped.hintId,
                    });
                }
                if (firstProp) this.session.lastActivePropId = mapped.propIds[mapped.propIds.length - 1];
            }

            return { type: "hint_reveal", ...result };
        }

        if (event.type === "attempt") {
            const mapped = mapAttemptEvent(event, this.session || {}, stepContent);
            const result = applyAttemptEvidence(
                this.beliefStore,
                structure,
                mapped,
                evidenceConfig
            );

            if (!mapped.correct && this.session?.hintsRevealed?.length) {
                const pathProps = this.session.hintsRevealed.flatMap(
                    (hid) => stepContent.hintPropMap?.[hid] || []
                );
                applyWrongPathAfterHint(this.beliefStore, pathProps, evidenceConfig);
            }

            if (this.session) {
                const lastProp = mapped.propIds[mapped.propIds.length - 1];
                if (this.session.lastActivePropId && lastProp) {
                    behavioral.recordTransition(this.session.lastActivePropId, lastProp, {
                        type: mapped.correct ? "correct-attempt" : "incorrect-attempt",
                    });
                }
                if (lastProp) this.session.lastActivePropId = lastProp;
            }

            return { type: "attempt", ...result };
        }

        return { type: "unknown", event };
    }

    getBeliefs() {
        return this.beliefStore.getBeliefs();
    }

    getBeliefGraph(lessonId) {
        return exportBeliefGraph(this, { lessonId: lessonId || this.lessonId });
    }

    getKCAggregates() {
        const structure = this.structureGraphs[this.lessonId];
        if (!structure) return {};
        return computeKCAggregates(
            this.beliefStore,
            structure,
            this.kcAggregateStrategy
        );
    }

    selectNextProblem(options) {
        return selectNextProblem(this, options);
    }

    checkGraduation(options) {
        return checkGraduation(this, { lessonId: this.lessonId, ...options });
    }

    getBeliefDeltas() {
        const current = this.getBeliefs();
        const deltas = {};
        for (const [id, model] of Object.entries(current)) {
            const prev = this.previousBeliefs[id]?.probMastery ?? this.defaultBelief.probMastery;
            const delta = model.probMastery - prev;
            if (Math.abs(delta) > 1e-9) {
                deltas[id] = { probMastery: model.probMastery, delta, text: this.beliefStore.getProposition(id)?.text };
            }
        }
        return deltas;
    }

    toJSON() {
        return {
            defaultBelief: cloneBeliefModel(this.defaultBelief),
            masteryThreshold: this.masteryThreshold,
            hintEvidenceWeight: this.hintEvidenceWeight,
            firstTryOnly: this.firstTryOnly,
            kcAggregateStrategy: this.kcAggregateStrategy,
            lessonId: this.lessonId,
            beliefStore: this.beliefStore.toJSON(),
            structureGraphs: Object.fromEntries(
                Object.entries(this.structureGraphs).map(([k, g]) => [k, g.toJSON()])
            ),
            behavioralGraphs: Object.fromEntries(
                Object.entries(this.behavioralGraphs).map(([k, g]) => [k, g.toJSON()])
            ),
            problemContent: this.problemContent,
            stepContent: this.stepContent,
        };
    }

    static fromJSON(data) {
        const engine = new PropositionBKTEngine({
            defaultBelief: data.defaultBelief,
            masteryThreshold: data.masteryThreshold,
            hintEvidenceWeight: data.hintEvidenceWeight,
            firstTryOnly: data.firstTryOnly,
            kcAggregateStrategy: data.kcAggregateStrategy,
        });
        engine.lessonId = data.lessonId;
        engine.beliefStore = BeliefStore.fromJSON(data.beliefStore, data.defaultBelief);
        engine.structureGraphs = Object.fromEntries(
            Object.entries(data.structureGraphs || {}).map(([k, g]) => [k, StructureGraph.fromJSON(g)])
        );
        engine.behavioralGraphs = Object.fromEntries(
            Object.entries(data.behavioralGraphs || {}).map(([k, g]) => [k, BehavioralGraph.fromJSON(g)])
        );
        engine.problemContent = data.problemContent || {};
        engine.stepContent = data.stepContent || {};
        return engine;
    }
}

export { exportBeliefGraphJSON, exportBeliefGraph };
