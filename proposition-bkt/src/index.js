export {
    createPropositionBKTEngine,
    default as PropositionBKTEngine,
    exportBeliefGraph,
    exportBeliefGraphJSON,
} from "./PropositionBKTEngine.js";
export { updateBelief, updateBeliefWeighted } from "./core/PropositionBKT.js";
export { DEFAULT_BELIEF, cloneBeliefModel, isMastered } from "./core/BeliefModel.js";
export { default as BeliefStore } from "./core/BeliefStore.js";
export { default as StructureGraph } from "./graph/StructureGraph.js";
export { default as BehavioralGraph } from "./graph/BehavioralGraph.js";
export { computeKCAggregates } from "./bridge/KCAggregate.js";
export { mapOATutorEvent } from "./bridge/OATutorAdapter.js";
export {
    normalizePropositionText,
    extractPropositionsFromText,
    propositionId,
    extractStepPropositions,
    extractHintPropositions,
} from "./extract/propositionExtractor.js";
