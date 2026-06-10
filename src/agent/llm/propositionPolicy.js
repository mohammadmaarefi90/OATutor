/**
 * Plan C Phase 1 — rank propositions by relevance (uncertainty + structure),
 * not by highest mastery or recency. Used only by LocalPropositionalLLMAgent.
 */

const STRUCTURAL_TYPES = new Set([
    "sequence",
    "prerequisite",
    "supports",
    "depends",
    "step-to-hint",
]);

const SOURCE_TYPE_WEIGHT = {
    hint: 1.0,
    step: 0.7,
    answer: 0.2,
};

export const DEFAULT_POLICY_WEIGHTS = {
    uncertainty: 0.55,
    structure: 0.3,
    source: 0.15,
};

export const POLICY_VERSION = "plan-c-v1";

function getClosurePropIds(structure, stepContent) {
    if (!structure || !stepContent) return [];
    const targetId = stepContent.answerPropId;
    if (targetId) {
        return [...structure.getPrerequisiteClosure(targetId)].filter(
            (id) => !id.startsWith("skill:")
        );
    }
    return [...(stepContent.stepPropIds || [])];
}

function computeStructuralImportance(propId, structure, closureSet) {
    if (!structure?.edges) return 0;
    let count = 0;
    for (const edge of structure.edges) {
        if (
            edge.from === propId &&
            STRUCTURAL_TYPES.has(edge.type) &&
            closureSet.has(edge.to) &&
            !edge.to.startsWith("skill:")
        ) {
            count += 1;
        }
    }
    const maxPossible = Math.max(1, closureSet.size - 1);
    return Math.min(1, count / maxPossible);
}

function sourceTypeWeight(sourceType) {
    return SOURCE_TYPE_WEIGHT[sourceType] ?? 0.5;
}

function buildCandidate(propId, structure, beliefs, defaultBelief, closureSet, weights, masteryThreshold) {
    const node = structure.nodes[propId] || {};
    const belief = beliefs[propId];
    const probMastery = belief?.probMastery ?? defaultBelief?.probMastery ?? 0.1;
    const uncertainty = 1 - probMastery;
    const structuralImportance = computeStructuralImportance(propId, structure, closureSet);
    const sourceW = sourceTypeWeight(node.sourceType);
    const mastered = probMastery >= masteryThreshold;

    const priority =
        weights.uncertainty * uncertainty +
        weights.structure * structuralImportance +
        weights.source * sourceW +
        (mastered ? -0.5 : 0);

    return {
        id: propId,
        text: node.text || belief?.text || propId,
        probMastery,
        sourceType: node.sourceType,
        hintId: node.hintId,
        uncertainty,
        structuralImportance,
        priority,
        mastered,
    };
}

/**
 * Rank propositions in prerequisite closure by teaching relevance (higher = more urgent).
 */
export function rankPropositionsForStep(
    propEngine,
    { lessonId, stepId, limit = 12, weights = DEFAULT_POLICY_WEIGHTS, masteryThreshold = 0.95 } = {}
) {
    const lid = lessonId || propEngine.lessonId;
    const structure = propEngine.structureGraphs?.[lid];
    const stepContent = propEngine.stepContent?.[stepId];
    const beliefs = propEngine.getBeliefs?.() || {};
    const defaultBelief = propEngine.defaultBelief;

    if (!structure || !stepContent) {
        return {
            stepId,
            answerPropId: null,
            closureSize: 0,
            ranked: [],
            primarySuggestion: null,
            knownAnchors: [],
            policyVersion: POLICY_VERSION,
        };
    }

    const propIds = getClosurePropIds(structure, stepContent);
    const closureSet = new Set(propIds);

    const ranked = propIds
        .map((id) =>
            buildCandidate(
                id,
                structure,
                beliefs,
                defaultBelief,
                closureSet,
                weights,
                masteryThreshold
            )
        )
        .filter((p) => p.text && p.text.length > 2)
        .sort((a, b) => b.priority - a.priority)
        .slice(0, limit)
        .map((p, i) => ({
            ...p,
            rank: i + 1,
            role: p.mastered ? "known" : "suggest",
        }));

    const teachable = ranked.filter((p) => !p.mastered && p.sourceType !== "answer");
    const primaryPool = teachable.length > 0 ? teachable : ranked.filter((p) => !p.mastered);
    const primarySuggestion = primaryPool[0]
        ? {
              id: primaryPool[0].id,
              text: primaryPool[0].text,
              probMastery: primaryPool[0].probMastery,
              reason: "highest priority uncertain proposition in reasoning closure",
          }
        : null;

    const knownAnchors = [...ranked]
        .filter((p) => p.mastered || p.sourceType === "answer")
        .sort((a, b) => b.probMastery - a.probMastery)
        .slice(0, 3);

    return {
        stepId,
        answerPropId: stepContent.answerPropId,
        closureSize: propIds.length,
        ranked,
        primarySuggestion,
        knownAnchors,
        policyVersion: POLICY_VERSION,
    };
}

/**
 * Build prompt sections: suggestions (uncertain) + anchors (known) within line budget.
 */
export function buildPromptPropositionBundle(
    propEngine,
    { lessonId, stepId, settings = {} } = {}
) {
    const maxTotal = settings.maxBeliefsInPrompt || 12;
    const maxSuggestions = settings.propPolicyMaxSuggestions ?? 3;
    const maxAnchors = settings.propPolicyMaxAnchors ?? 2;
    const masteryThreshold = settings.propPolicyMasteryThreshold ?? 0.95;

    const ranking = rankPropositionsForStep(propEngine, {
        lessonId,
        stepId,
        limit: maxTotal + 4,
        masteryThreshold,
    });

    const suggestions = ranking.ranked
        .filter((p) => !p.mastered && p.sourceType !== "answer")
        .slice(0, maxSuggestions);

    const fallbackSuggestions =
        suggestions.length > 0
            ? suggestions
            : ranking.ranked.filter((p) => !p.mastered).slice(0, maxSuggestions);

    const anchors = ranking.knownAnchors.slice(0, maxAnchors);

    const used = new Set();
    const bundleSuggestions = [];
    for (const p of fallbackSuggestions) {
        if (used.has(p.id)) continue;
        used.add(p.id);
        bundleSuggestions.push({ ...p, role: "suggest" });
    }
    const bundleAnchors = [];
    for (const p of anchors) {
        if (used.has(p.id)) continue;
        used.add(p.id);
        bundleAnchors.push({ ...p, role: "anchor" });
    }

    return {
        ...ranking,
        suggestions: bundleSuggestions,
        anchors: bundleAnchors,
        primarySuggestion:
            ranking.primarySuggestion ||
            (bundleSuggestions[0]
                ? {
                      id: bundleSuggestions[0].id,
                      text: bundleSuggestions[0].text,
                      probMastery: bundleSuggestions[0].probMastery,
                      reason: "top uncertain proposition for this step",
                  }
                : null),
        policyVersion: POLICY_VERSION,
    };
}

export function formatPropPolicyForPrompt(bundle) {
    if (!bundle) return "(No proposition beliefs learned yet for this step.)";

    const lines = [];

    if (bundle.primarySuggestion?.text) {
        const pct = Math.round((bundle.primarySuggestion.probMastery || 0) * 100);
        lines.push(
            `Suggested focus (strengthen next): [${pct}%] ${bundle.primarySuggestion.text}`
        );
        lines.push("");
    }

    if (bundle.suggestions?.length > 0) {
        lines.push("Ideas to strengthen:");
        bundle.suggestions.forEach((p, i) => {
            const pct = Math.round((p.probMastery || 0) * 100);
            lines.push(`${i + 1}. [${pct}%] ${p.text}`);
        });
        lines.push("");
    }

    if (bundle.anchors?.length > 0) {
        lines.push("Known anchors:");
        bundle.anchors.forEach((p, i) => {
            const pct = Math.round((p.probMastery || 0) * 100);
            lines.push(`${i + 1}. [${pct}%] ${p.text}`);
        });
    }

    if (lines.length === 0) {
        return "(No proposition beliefs learned yet for this step.)";
    }

    return lines.join("\n").trim();
}
