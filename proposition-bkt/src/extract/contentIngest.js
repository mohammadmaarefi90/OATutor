import {
    propositionId,
    extractStepPropositions,
    extractHintPropositions,
    extractAnswerProposition,
} from "./propositionExtractor.js";

/**
 * Ingest step + hint pathway content into proposition records and structural edges.
 */
export function ingestStepContent(step, problemId, skills = []) {
    const propositions = [];
    const edges = [];

    const stepProps = extractStepPropositions(step, problemId);
    const stepIds = stepProps.map((p) => {
        const id = propositionId(p.text, p.stepId || "");
        propositions.push({
            id,
            text: p.text,
            sourceType: "step",
            stepId: step.id,
            problemId,
            skills: [...skills],
            sourceField: p.sourceField,
        });
        return id;
    });

    for (let i = 1; i < stepIds.length; i++) {
        edges.push({ from: stepIds[i - 1], to: stepIds[i], type: "sequence", weight: 1.0 });
    }

    for (const id of stepIds) {
        for (const skill of skills) {
            edges.push({ from: id, to: `skill:${skill}`, type: "skill-link", weight: 1.0 });
        }
    }

    const answerProp = extractAnswerProposition(step, problemId);
    if (answerProp) {
        propositions.push({
            id: answerProp.id,
            text: answerProp.text,
            sourceType: "answer",
            stepId: step.id,
            problemId,
            skills: [...skills],
        });
        if (stepIds.length > 0) {
            edges.push({
                from: stepIds[stepIds.length - 1],
                to: answerProp.id,
                type: "supports",
                weight: 1.0,
            });
        }
    }

    return { propositions, edges, stepPropIds: stepIds, answerPropId: answerProp?.id || null };
}

export function ingestHintPathway(hints, step, problemId, skills = [], pathwayName = "DefaultPathway") {
    const propositions = [];
    const edges = [];
    const hintNodeMap = {};

    const pathway = hints[pathwayName] || hints[Object.keys(hints)[0]] || [];

    pathway.forEach((hint, hintIndex) => {
        const props = extractHintPropositions(hint, step.id, problemId, hintIndex);
        const propIds = props.map((p) => {
            const id = propositionId(p.text, p.hintId || p.stepId || "");
            propositions.push({
                id,
                text: p.text,
                sourceType: "hint",
                stepId: step.id,
                problemId,
                hintId: hint.id,
                hintIndex,
                skills: [...skills],
                title: p.title,
            });
            return id;
        });
        hintNodeMap[hint.id] = propIds;

        for (const id of propIds) {
            for (const skill of skills) {
                edges.push({ from: id, to: `skill:${skill}`, type: "skill-link", weight: 1.0 });
            }
        }

        (hint.dependencies || []).forEach((depId) => {
            const depPropIds = hintNodeMap[depId];
            if (depPropIds?.length > 0 && propIds.length > 0) {
                edges.push({
                    from: depPropIds[depPropIds.length - 1],
                    to: propIds[0],
                    type: "supports",
                    weight: 1.0,
                });
            }
        });

        for (let i = 1; i < propIds.length; i++) {
            edges.push({ from: propIds[i - 1], to: propIds[i], type: "sequence", weight: 1.0 });
        }
    });

    return { propositions, edges, hintNodeMap, pathway };
}

export function linkHintsToStep(stepResult, hintResult) {
    const edges = [];
    const { stepPropIds, answerPropId } = stepResult;
    const pathway = hintResult.pathway || [];
    if (pathway.length === 0) return edges;

    const firstHintProps = hintResult.hintNodeMap[pathway[0].id] || [];
    if (stepPropIds.length > 0 && firstHintProps.length > 0) {
        edges.push({
            from: stepPropIds[stepPropIds.length - 1],
            to: firstHintProps[0],
            type: "prerequisite",
            weight: 1.0,
        });
    }

    const lastHintId = pathway[pathway.length - 1]?.id;
    const lastHintProps = hintResult.hintNodeMap[lastHintId] || [];
    if (answerPropId && lastHintProps.length > 0) {
        edges.push({
            from: lastHintProps[lastHintProps.length - 1],
            to: answerPropId,
            type: "supports",
            weight: 1.0,
        });
    }

    return edges;
}

export function addContradictEdges(pathways, hintNodeMaps) {
    const edges = [];
    if (pathways.length < 2) return edges;

    const pathwayEnds = pathways.map((pathway, idx) => {
        const lastHint = pathway[pathway.length - 1];
        const map = hintNodeMaps[idx];
        const props = map[lastHint?.id] || [];
        return props[props.length - 1];
    }).filter(Boolean);

    for (let i = 0; i < pathwayEnds.length; i++) {
        for (let j = i + 1; j < pathwayEnds.length; j++) {
            edges.push({
                from: pathwayEnds[i],
                to: pathwayEnds[j],
                type: "contradicts",
                weight: 1.0,
            });
            edges.push({
                from: pathwayEnds[j],
                to: pathwayEnds[i],
                type: "contradicts",
                weight: 1.0,
            });
        }
    }
    return edges;
}
