/**
 * Extracts propositions (statements) from tutoring content.
 * Adapted from OATutor src/agent/propositionExtractor.js (read-only reference).
 */

export function normalizePropositionText(text) {
    if (!text) return "";
    return text
        .replace(/\$\$/g, "")
        .replace(/\\n/g, " ")
        .replace(/##[^#]+##/g, "")
        .replace(/\s+/g, " ")
        .trim();
}

export function extractPropositionsFromText(text, metadata = {}) {
    const normalized = normalizePropositionText(text);
    if (!normalized) return [];

    const sentences = normalized
        .split(/(?<=[.!?])\s+/)
        .map((s) => s.trim())
        .filter((s) => s.length > 8);

    if (sentences.length === 0 && normalized.length > 0) {
        return [{ text: normalized, ...metadata }];
    }

    return sentences.map((sentence, index) => ({
        text: sentence,
        sentenceIndex: index,
        ...metadata,
    }));
}

export function propositionId(text, sourceId = "") {
    const key = `${sourceId}::${normalizePropositionText(text).toLowerCase()}`;
    let hash = 0;
    for (let i = 0; i < key.length; i++) {
        hash = (hash << 5) - hash + key.charCodeAt(i);
        hash |= 0;
    }
    return `prop-${Math.abs(hash).toString(36)}`;
}

export function extractStepPropositions(step, problemId) {
    const fields = [
        { field: "stepTitle", text: step.stepTitle },
        { field: "stepBody", text: step.stepBody },
    ];

    const propositions = [];
    for (const { field, text } of fields) {
        extractPropositionsFromText(text, {
            sourceType: "step",
            sourceField: field,
            stepId: step.id,
            problemId,
        }).forEach((p) => propositions.push(p));
    }
    return propositions;
}

export function extractHintPropositions(hint, stepId, problemId, hintIndex) {
    return extractPropositionsFromText(hint.text || hint.title || "", {
        sourceType: hint.type || "hint",
        stepId,
        problemId,
        hintId: hint.id,
        hintIndex,
        title: hint.title || "",
    });
}

export function extractAnswerProposition(step, problemId) {
    const answerText = step.canonicalAnswer || step.answer || step.stepBody || step.stepTitle;
    if (!answerText) return null;
    const props = extractPropositionsFromText(answerText, {
        sourceType: "answer",
        stepId: step.id,
        problemId,
    });
    if (props.length === 0) return null;
    const p = props[props.length - 1];
    return { ...p, id: propositionId(p.text, step.id) };
}
