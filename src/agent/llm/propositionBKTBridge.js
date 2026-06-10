import {
    createPropositionBKTEngine,
    PropositionBKTEngine,
    exportBeliefGraphJSON,
} from "@oatutor/proposition-bkt";
import { cleanArray } from "../../util/cleanObject.js";
import {
    buildPromptPropositionBundle,
    formatPropPolicyForPrompt,
    rankPropositionsForStep,
    POLICY_VERSION,
} from "./propositionPolicy.js";

export { buildPromptPropositionBundle, formatPropPolicyForPrompt, rankPropositionsForStep, POLICY_VERSION };

export const PROP_BKT_ENGINE_CONFIG = {
    firstTryOnly: false,
    hintEvidenceWeight: 0.5,
    masteryThreshold: 0.95,
};

export function createAgentPropBKTEngine() {
    return createPropositionBKTEngine(PROP_BKT_ENGINE_CONFIG);
}

export function attachKnowledgeComponents(problems, skillModel = {}) {
    return problems.map((problem) => ({
        ...problem,
        steps: (problem.steps || []).map((step) => ({
            ...step,
            knowledgeComponents: cleanArray(
                skillModel[step.id] || step.knowledgeComponents || []
            ),
        })),
    }));
}

export function computePropLessonMastery(lesson, propEngine) {
    const kcAgg = propEngine?.getKCAggregates?.() || {};
    const los = Object.keys(lesson?.learningObjectives || {});
    if (los.length === 0) return 0;
    const sum = los.reduce((s, kc) => s + (kcAgg[kc] ?? 0), 0);
    return sum / los.length;
}

export function computePropositionMasterySummary(propEngine, threshold = 0.95) {
    const beliefs = propEngine?.getBeliefs?.() || {};
    const structure = propEngine?.structureGraphs?.[propEngine.lessonId];
    if (!structure) return { mastered: 0, total: 0, rate: 0 };

    const answerProps = Object.values(structure.nodes || {}).filter(
        (n) => n.sourceType === "answer"
    );
    const total = answerProps.length;
    if (total === 0) return { mastered: 0, total: 0, rate: 0 };

    const mastered = answerProps.filter(
        (n) => (beliefs[n.id]?.probMastery ?? 0) >= threshold
    ).length;
    return { mastered, total, rate: mastered / total };
}

/** @deprecated Use buildPromptPropositionBundle — ranks by highest mastery, not relevance. */
export function getPropositionsForPrompt(propEngine, lessonId, stepId, limit = 12) {
    const structure = propEngine?.structureGraphs?.[lessonId];
    const stepContent = propEngine?.stepContent?.[stepId];
    const beliefs = propEngine?.getBeliefs?.() || {};

    if (!structure || !stepContent) return [];

    let propIds = [];
    const targetId = stepContent.answerPropId;
    if (targetId) {
        propIds = [...structure.getPrerequisiteClosure(targetId)];
    } else {
        propIds = [...(stepContent.stepPropIds || [])];
    }

    return propIds
        .map((id) => {
            const node = structure.nodes[id];
            const belief = beliefs[id];
            return {
                id,
                text: node?.text || belief?.text || id,
                probMastery: belief?.probMastery ?? 0,
                sourceType: node?.sourceType,
            };
        })
        .filter((p) => p.text && p.text.length > 2)
        .sort((a, b) => b.probMastery - a.probMastery)
        .slice(0, limit);
}

export function formatPropBeliefsForPrompt(propositions) {
    if (!propositions.length) {
        return "(No proposition beliefs learned yet for this step.)";
    }
    return propositions
        .map((p, i) => {
            const pct = Math.round((p.probMastery || 0) * 100);
            return `${i + 1}. [${pct}%] ${p.text}`;
        })
        .join("\n");
}

export function exportPropBeliefGraph(propEngine, lessonId) {
    return exportBeliefGraphJSON(propEngine, { lessonId });
}

export { PropositionBKTEngine };
