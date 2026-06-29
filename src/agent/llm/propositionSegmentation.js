/**
 * Abstractive Proposition Segmentation (APS) — optional layer for Prop BKT.
 * Replaces coarse sentence splitting with finer atomic propositions at ingest,
 * and optionally aligns LLM attempts to lesson props (no fine-tuning required).
 */

import {
    normalizePropositionText,
    propositionId,
} from "@oatutor/proposition-bkt";
import { AGENT_TYPES } from "../agentTypes.js";

export const PROP_APS_MODES = {
    HEURISTIC: "heuristic",
    LLM_PROMPT: "llm-prompt",
};

export const PROP_APS_MODE_META = {
    [PROP_APS_MODES.HEURISTIC]: {
        label: "Heuristic APS (no LLM, no fine-tuning)",
        description:
            "Rule-based atomic splits (clauses, discourse markers). Fast, offline, default.",
    },
    [PROP_APS_MODES.LLM_PROMPT]: {
        label: "LLM prompt APS (no fine-tuning)",
        description:
            "Few-shot gpt-oss segmentation at lesson ingest. Slower; uses existing inference server.",
    },
};

export const APS_VERSION = "prop-aps-v1";

/** Prop BKT family agents that support optional APS. */
export const PROP_APS_AGENT_TYPES = new Set([
    AGENT_TYPES.LOCAL_LLM_PROP,
    AGENT_TYPES.LOCAL_LLM_PROP_CHAIN,
    AGENT_TYPES.LOCAL_LLM_PROP_CHAIN_TREE,
]);

export function isPropApsEnabled(settings, agentType) {
    if (!settings?.propApsEnabled) return false;
    return PROP_APS_AGENT_TYPES.has(agentType);
}

export function resolvePropApsMode(settings) {
    return settings?.propApsMode || PROP_APS_MODES.HEURISTIC;
}

const CLAUSE_SPLIT =
    /\s*(?:;\s+|,\s+(?:which|that|so|because|therefore|thus)\s+|\s+(?:then|so|because|therefore|thus|which means|and so)\s+)/i;

/**
 * Heuristic APS — no LLM, no fine-tuning. Finer than regex sentence split.
 */
export function segmentTextHeuristic(text, { minLength = 10, maxSegments = 12 } = {}) {
    const normalized = normalizePropositionText(text);
    if (!normalized) return [];

    const sentences = normalized
        .split(/(?<=[.!?])\s+/)
        .flatMap((sentence) => sentence.split(CLAUSE_SPLIT))
        .map((s) => s.trim())
        .filter((s) => s.length >= minLength);

    const unique = [];
    const seen = new Set();
    for (const s of sentences) {
        const key = s.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        unique.push(s);
        if (unique.length >= maxSegments) break;
    }

    if (unique.length === 0 && normalized.length >= minLength) {
        return [normalized.slice(0, 500)];
    }
    return unique;
}

export function parseApsJsonResponse(rawText) {
    if (!rawText) return null;
    const trimmed = rawText.trim();
    const jsonMatch = trimmed.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;
    try {
        return JSON.parse(jsonMatch[0]);
    } catch {
        return null;
    }
}

function normalizeSegmentList(items, maxSegments) {
    if (!Array.isArray(items)) return [];
    return items
        .map((s) => (typeof s === "string" ? normalizePropositionText(s) : ""))
        .filter((s) => s.length >= 8)
        .slice(0, maxSegments);
}

/**
 * LLM prompt APS — uses existing gpt-oss; fine-tuning not required.
 */
export async function segmentStepWithLLM(step, stepContent, settings) {
    const maxSegments = settings.propApsMaxPropositions ?? 12;
    const hints = (stepContent.pathway || [])
        .map((h) => `- ${h.id}: ${normalizePropositionText(h.text || h.title || "")}`)
        .join("\n");
    const answerText =
        step.stepAnswer?.[0] ||
        step.canonicalAnswer ||
        step.answer ||
        "";

    const prompt = `Segment this tutoring step into atomic, self-contained propositions (one idea each).
Math notation may appear without LaTeX delimiters. Return JSON only, no markdown:
{
  "step": ["proposition 1", "proposition 2"],
  "hints": { "hintId": ["proposition a"] },
  "answer": "single answer proposition or empty string"
}

Step title: ${normalizePropositionText(step.stepTitle || "")}
Step body: ${normalizePropositionText(step.stepBody || "")}
Hints:
${hints || "(none)"}
Expected answer: ${normalizePropositionText(String(answerText))}`;

    const { completeChat } = await import("./llmClient.js");
    const result = await completeChat(
        [
            {
                role: "system",
                content:
                    "You are a proposition segmentation model for math tutoring. Output valid JSON only.",
            },
            { role: "user", content: prompt },
        ],
        { settings, timeoutMs: settings.requestTimeoutMs ?? 120000 }
    );

    const parsed =
        parseApsJsonResponse(result.content) || parseApsJsonResponse(result.rawText);
    if (!parsed) {
        return segmentStepHeuristic(step, stepContent, settings);
    }

    return {
        step: normalizeSegmentList(parsed.step, maxSegments),
        hints: Object.fromEntries(
            Object.entries(parsed.hints || {}).map(([id, list]) => [
                id,
                normalizeSegmentList(list, maxSegments),
            ])
        ),
        answer: normalizePropositionText(parsed.answer || "") || null,
        source: "llm-prompt",
    };
}

export function segmentStepHeuristic(step, stepContent, settings) {
    const maxSegments = settings.propApsMaxPropositions ?? 12;
    const stepText = [step.stepTitle, step.stepBody].filter(Boolean).join(". ");

    const hints = {};
    for (const hint of stepContent.pathway || []) {
        hints[hint.id] = segmentTextHeuristic(hint.text || hint.title || "", {
            maxSegments,
        });
    }

    const answerText =
        step.stepAnswer?.[0] ||
        step.canonicalAnswer ||
        step.answer ||
        "";

    return {
        step: segmentTextHeuristic(stepText, { maxSegments }),
        hints,
        answer: normalizePropositionText(String(answerText)) || null,
        source: "heuristic",
    };
}

function registerPropositions(structure, beliefStore, segments, meta, skills) {
    const ids = [];
    for (let i = 0; i < segments.length; i++) {
        const text = segments[i];
        if (!text) continue;
        const sourceId = meta.hintId || meta.stepId || meta.problemId || "";
        const id = propositionId(text, sourceId);
        const record = {
            id,
            text,
            sourceType: meta.sourceType,
            stepId: meta.stepId,
            problemId: meta.problemId,
            hintId: meta.hintId,
            hintIndex: meta.hintIndex,
            skills: [...skills],
            apsVersion: APS_VERSION,
        };
        structure.addProposition(record);
        beliefStore.ensureProposition(id, record);
        ids.push(id);
        if (i > 0) {
            structure.addEdges([
                { from: ids[i - 1], to: id, type: "sequence", weight: 1.0 },
            ]);
        }
        for (const skill of skills) {
            structure.addEdges([
                { from: id, to: `skill:${skill}`, type: "skill-link", weight: 1.0 },
            ]);
        }
    }
    return ids;
}

function applySegmentsToStep(propEngine, structure, step, stepContent, segments, skills, problemId) {
    const stepPropIds = registerPropositions(
        structure,
        propEngine.beliefStore,
        segments.step,
        { sourceType: "step", stepId: step.id, problemId },
        skills
    );

    const hintPropMap = {};
    for (const hint of stepContent.pathway || []) {
        const hintSegments = segments.hints?.[hint.id] || [];
        hintPropMap[hint.id] = registerPropositions(
            structure,
            propEngine.beliefStore,
            hintSegments,
            {
                sourceType: "hint",
                stepId: step.id,
                problemId,
                hintId: hint.id,
                hintIndex: hint.hintIndex,
            },
            skills
        );
    }

    let answerPropId = stepContent.answerPropId;
    if (segments.answer) {
        answerPropId = propositionId(segments.answer, step.id);
        structure.addProposition({
            id: answerPropId,
            text: segments.answer,
            sourceType: "answer",
            stepId: step.id,
            problemId,
            skills: [...skills],
            apsVersion: APS_VERSION,
        });
        propEngine.beliefStore.ensureProposition(answerPropId, {
            id: answerPropId,
            text: segments.answer,
            sourceType: "answer",
        });
    }

    if (stepPropIds.length > 0 && answerPropId) {
        structure.addEdges([
            {
                from: stepPropIds[stepPropIds.length - 1],
                to: answerPropId,
                type: "supports",
                weight: 1.0,
            },
        ]);
    }

    for (const hintId of Object.keys(hintPropMap)) {
        const propIds = hintPropMap[hintId];
        if (propIds.length > 0 && stepPropIds.length > 0) {
            structure.addEdges([
                {
                    from: stepPropIds[stepPropIds.length - 1],
                    to: propIds[0],
                    type: "step-to-hint",
                    weight: 1.0,
                },
            ]);
        }
    }

    stepContent.stepPropIds = stepPropIds;
    stepContent.hintPropMap = hintPropMap;
    stepContent.answerPropId = answerPropId;
    stepContent.apsVersion = APS_VERSION;
    stepContent.apsSource = segments.source;

    return {
        stepPropCount: stepPropIds.length,
        hintPropCount: Object.values(hintPropMap).reduce((n, arr) => n + arr.length, 0),
        source: segments.source,
    };
}

/**
 * Apply APS layer after standard ingestLesson (replaces per-step prop pointers).
 */
export async function applyApsToPropEngine(
    propEngine,
    lessonId,
    problems,
    settings,
    { onStep = null } = {}
) {
    const structure = propEngine.structureGraphs[lessonId];
    if (!structure) return { stepsProcessed: 0, mode: resolvePropApsMode(settings) };

    const mode = resolvePropApsMode(settings);
    let stepsProcessed = 0;
    let totalStepProps = 0;
    let totalHintProps = 0;

    for (const problem of problems) {
        for (const step of problem.steps || []) {
            const stepContent = propEngine.stepContent[step.id];
            if (!stepContent) continue;

            const skills = step.knowledgeComponents || [];
            let segments;
            if (mode === PROP_APS_MODES.LLM_PROMPT) {
                segments = await segmentStepWithLLM(step, stepContent, settings);
            } else {
                segments = segmentStepHeuristic(step, stepContent, settings);
            }

            const summary = applySegmentsToStep(
                propEngine,
                structure,
                step,
                stepContent,
                segments,
                skills,
                problem.id
            );
            stepsProcessed += 1;
            totalStepProps += summary.stepPropCount;
            totalHintProps += summary.hintPropCount;
            onStep?.({ stepId: step.id, ...summary });
        }
    }

    return {
        stepsProcessed,
        mode,
        apsVersion: APS_VERSION,
        totalStepProps,
        totalHintProps,
        requiresFinetuning: false,
    };
}

function tokenSet(text) {
    return new Set(
        normalizePropositionText(text)
            .toLowerCase()
            .split(/\W+/)
            .filter((t) => t.length > 2)
    );
}

function overlapScore(a, b) {
    const sa = tokenSet(a);
    const sb = tokenSet(b);
    if (sa.size === 0 || sb.size === 0) return 0;
    let inter = 0;
    for (const t of sa) {
        if (sb.has(t)) inter += 1;
    }
    return inter / Math.max(sa.size, sb.size);
}

/**
 * Align LLM attempt text to lesson propositions in step closure (no fine-tuning).
 */
export function alignAttemptToPropositions(
    attemptText,
    propEngine,
    { lessonId, stepId, minScore = 0.35, maxMatches = 8 } = {}
) {
    if (!attemptText) return { matchedPropIds: [], segments: [] };

    const lid = lessonId || propEngine.lessonId;
    const structure = propEngine.structureGraphs?.[lid];
    const stepContent = propEngine.stepContent?.[stepId];
    if (!structure || !stepContent) {
        return { matchedPropIds: [], segments: [] };
    }

    const segments = segmentTextHeuristic(attemptText, { maxSegments: maxMatches });
    const closureIds = new Set([
        ...(stepContent.stepPropIds || []),
        ...(stepContent.answerPropId ? [stepContent.answerPropId] : []),
        ...Object.values(stepContent.hintPropMap || {}).flat(),
    ]);

    const matchedPropIds = [];
    const seen = new Set();

    for (const segment of segments) {
        let bestId = null;
        let bestScore = minScore;
        for (const propId of closureIds) {
            const node = structure.nodes[propId];
            if (!node?.text) continue;
            const score = overlapScore(segment, node.text);
            if (score > bestScore) {
                bestScore = score;
                bestId = propId;
            }
        }
        if (bestId && !seen.has(bestId)) {
            seen.add(bestId);
            matchedPropIds.push(bestId);
        }
    }

    return { matchedPropIds, segments };
}

export function summarizeApsIngestForEvent(result) {
    return {
        apsVersion: result.apsVersion || APS_VERSION,
        mode: result.mode,
        stepsProcessed: result.stepsProcessed,
        totalStepProps: result.totalStepProps,
        totalHintProps: result.totalHintProps,
        requiresFinetuning: false,
    };
}
