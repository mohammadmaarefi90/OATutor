/**
 * Configurable hint / belief retrieval for local LLM agents.
 * Lets you compare which injection strategy performs better on evaluation.
 */

import { cleanArray } from "../../util/cleanObject.js";
import {
    buildPromptPropositionBundle,
    formatPropPolicyForPrompt,
    formatPropBeliefsForPrompt,
    getPropositionsForPrompt,
} from "./propositionBKTBridge.js";
import { SKILL_HINT_MODES, PROP_HINT_MODES, SKILL_BKT_BACKEND } from "./llmSettings.js";

export { SKILL_HINT_MODES, PROP_HINT_MODES };

export const SKILL_HINT_MODE_META = {
    [SKILL_HINT_MODES.RECENCY]: {
        id: SKILL_HINT_MODES.RECENCY,
        label: "Most recent (default)",
        shortLabel: "Recent",
        description: "Newest training hints per skill bucket (learnedAt descending).",
    },
    [SKILL_HINT_MODES.OLDEST]: {
        id: SKILL_HINT_MODES.OLDEST,
        label: "Oldest first",
        shortLabel: "Oldest",
        description: "Earliest learned hints first — tests whether first-seen rules stick.",
    },
    [SKILL_HINT_MODES.RANDOM]: {
        id: SKILL_HINT_MODES.RANDOM,
        label: "Random sample",
        shortLabel: "Random",
        description: "Random hints from skill bucket — baseline for A/B comparison.",
    },
};

export const PROP_HINT_MODE_META = {
    [PROP_HINT_MODES.RELEVANCE]: {
        id: PROP_HINT_MODES.RELEVANCE,
        label: "Most relevant (Plan C)",
        shortLabel: "Relevant",
        description: "Uncertainty + structure policy; suggested focus for this step.",
    },
    [PROP_HINT_MODES.HIGHEST_MASTERY]: {
        id: PROP_HINT_MODES.HIGHEST_MASTERY,
        label: "Highest mastery",
        shortLabel: "High P(know)",
        description: "Ideas the agent believes it knows best in the reasoning closure.",
    },
    [PROP_HINT_MODES.LOWEST_MASTERY]: {
        id: PROP_HINT_MODES.LOWEST_MASTERY,
        label: "Lowest mastery",
        shortLabel: "Low P(know)",
        description: "Most uncertain ideas in the step closure — simple uncertainty sort.",
    },
};

function shuffleInPlace(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
}

/**
 * Skill GPT-OSS: retrieve hint texts for prompt injection.
 */
export function getSkillHintsForPrompt(beliefStore, skills, limit, mode = SKILL_HINT_MODES.RECENCY) {
    if (!beliefStore) return { hints: [], mode, modeLabel: SKILL_HINT_MODE_META[mode]?.shortLabel };

    const skillList = cleanArray(skills || []);
    const seen = new Set();
    const beliefs = [];

    const collect = (skill) => {
        const bucket = beliefStore.beliefsBySkill[skill];
        if (!bucket) return;
        Object.values(bucket).forEach((b) => {
            if (seen.has(b.text)) return;
            seen.add(b.text);
            beliefs.push(b);
        });
    };

    skillList.forEach(collect);
    if (beliefs.length === 0) collect("_general");

    let sorted = [...beliefs];
    if (mode === SKILL_HINT_MODES.OLDEST) {
        sorted.sort((a, b) => (a.learnedAt || 0) - (b.learnedAt || 0));
    } else if (mode === SKILL_HINT_MODES.RANDOM) {
        sorted = shuffleInPlace(sorted);
    } else {
        sorted.sort((a, b) => (b.learnedAt || 0) - (a.learnedAt || 0));
    }

    const hints = sorted.slice(0, limit);
    return {
        hints,
        mode,
        modeLabel: SKILL_HINT_MODE_META[mode]?.shortLabel || mode,
        modeDescription: SKILL_HINT_MODE_META[mode]?.description,
    };
}

export function formatSkillHintsForPrompt(hints) {
    if (!hints?.length) {
        return "(No prior hints learned yet for these skills.)";
    }
    return hints.map((b, i) => `${i + 1}. ${b.text}`).join("\n");
}

function getPropositionsByLowestMastery(propEngine, lessonId, stepId, limit) {
    const props = getPropositionsForPrompt(propEngine, lessonId, stepId, limit * 2);
    return [...props].sort((a, b) => a.probMastery - b.probMastery).slice(0, limit);
}

/**
 * Prop BKT: build prompt block + metadata for the selected retrieval mode.
 */
export function buildPropHintPrompt(propEngine, { lessonId, stepId, settings = {} }) {
    const mode = settings.propHintRetrieval || PROP_HINT_MODES.RELEVANCE;
    const maxBeliefs = settings.maxBeliefsInPrompt || 12;
    const meta = PROP_HINT_MODE_META[mode] || {};

    if (mode === PROP_HINT_MODES.RELEVANCE) {
        const bundle = buildPromptPropositionBundle(propEngine, {
            lessonId,
            stepId,
            settings,
        });
        return {
            mode,
            modeLabel: meta.shortLabel || mode,
            modeDescription: meta.description,
            promptBlock: formatPropPolicyForPrompt(bundle),
            bundle,
            policyVersion: bundle.policyVersion,
        };
    }

    const propositions =
        mode === PROP_HINT_MODES.LOWEST_MASTERY
            ? getPropositionsByLowestMastery(propEngine, lessonId, stepId, maxBeliefs)
            : getPropositionsForPrompt(propEngine, lessonId, stepId, maxBeliefs);

    const sortLabel =
        mode === PROP_HINT_MODES.HIGHEST_MASTERY
            ? "highest P(know) in step closure"
            : "lowest P(know) in step closure";

    return {
        mode,
        modeLabel: meta.shortLabel || mode,
        modeDescription: meta.description,
        promptBlock:
            `Retrieval: ${sortLabel}\n` + formatPropBeliefsForPrompt(propositions),
        propositions,
        policyVersion: null,
    };
}

export function resolveSkillHintMode(settings) {
    return settings?.skillHintRetrieval || SKILL_HINT_MODES.RECENCY;
}

export function resolvePropHintMode(settings) {
    return settings?.propHintRetrieval || PROP_HINT_MODES.RELEVANCE;
}

export function resolveSkillBktBackend(settings) {
    return settings?.skillBktBackend || SKILL_BKT_BACKEND.CLASSIC;
}
