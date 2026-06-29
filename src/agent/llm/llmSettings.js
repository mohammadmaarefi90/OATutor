/**
 * Browser-persisted settings for local (llama.cpp) and cloud LLM backends.
 * Build-time defaults from REACT_APP_LLM_* (.env); overridable in LLM settings UI.
 */

export const LLM_PROVIDER = {
    CLOUD_GPT4: "cloud-gpt4",
    LOCAL_GPT_OSS: "local-gpt-oss",
};

export const BKT_MODE = {
    SKILL: "skill",
    PROPOSITION: "proposition",
};

/** Hint retrieval for skill-based Local GPT-OSS (LLMBeliefStore). */
export const SKILL_HINT_MODES = {
    RECENCY: "recency",
    OLDEST: "oldest",
    RANDOM: "random",
};

/** Hint retrieval for Propositional BKT local agent. */
export const PROP_HINT_MODES = {
    RELEVANCE: "relevance",
    HIGHEST_MASTERY: "highest-mastery",
    LOWEST_MASTERY: "lowest-mastery",
};

/** Training write path — how hints are revealed during Prop BKT training. */
export const PROP_TRAINING_HINT_MODES = {
    FULL_PATHWAY: "full-pathway",
    PARTIAL_SEQUENTIAL: "partial-sequential",
    PLANNER_GUIDED: "planner-guided",
};

/** APS — abstractive proposition segmentation for Prop BKT ingest / attempts. */
export const PROP_APS_MODES = {
    HEURISTIC: "heuristic",
    LLM_PROMPT: "llm-prompt",
};

/** Skill BKT backend for Local GPT-OSS only. */
export const SKILL_BKT_BACKEND = {
    CLASSIC: "classic",
    PYBKT: "pybkt",
};

function envInt(name, fallback) {
    const raw = process.env[name];
    if (raw == null || raw === "") return fallback;
    const n = Number(raw);
    return Number.isFinite(n) ? n : fallback;
}

/** Defaults baked at build time from .env (Create React App). */
export const ENV_LLM_DEFAULTS = {
    localBaseUrl: process.env.REACT_APP_LLM_BASE_URL || "http://10.10.102.139:8080/v1",
    localModel: process.env.REACT_APP_LLM_MODEL || "gpt-oss-20b-MXFP4.gguf",
    localApiKey: process.env.REACT_APP_LLM_API_KEY || "not-needed",
    reasoningEffort: process.env.REACT_APP_LLM_REASONING_EFFORT || "medium",
    requestTimeoutMs: envInt("REACT_APP_LLM_TIMEOUT_MS", 180000),
};

/**
 * REACT_APP_LLM_* overrides win over browser-stored values so deployment
 * can point all clients at the shared inference host without manual UI edits.
 */
export function applyEnvLLMOverrides(settings) {
    const out = { ...settings };
    if (process.env.REACT_APP_LLM_BASE_URL) {
        out.localBaseUrl = process.env.REACT_APP_LLM_BASE_URL;
    }
    if (process.env.REACT_APP_LLM_MODEL) {
        out.localModel = process.env.REACT_APP_LLM_MODEL;
    }
    if (process.env.REACT_APP_LLM_API_KEY) {
        out.localApiKey = process.env.REACT_APP_LLM_API_KEY;
    }
    if (process.env.REACT_APP_LLM_REASONING_EFFORT) {
        out.reasoningEffort = process.env.REACT_APP_LLM_REASONING_EFFORT;
    }
    if (process.env.REACT_APP_LLM_TIMEOUT_MS) {
        out.requestTimeoutMs = envInt("REACT_APP_LLM_TIMEOUT_MS", out.requestTimeoutMs);
    }
    return out;
}

export const DEFAULT_LLM_SETTINGS = {
    provider: LLM_PROVIDER.LOCAL_GPT_OSS,
    localBaseUrl: ENV_LLM_DEFAULTS.localBaseUrl,
    localModel: ENV_LLM_DEFAULTS.localModel,
    localApiKey: ENV_LLM_DEFAULTS.localApiKey,
    reasoningEffort: ENV_LLM_DEFAULTS.reasoningEffort,
    requestTimeoutMs: ENV_LLM_DEFAULTS.requestTimeoutMs,
    maxBeliefsInPrompt: 12,
    /** Propositional BKT only — Plan C uncertainty-first policy */
    propPolicyMaxSuggestions: 3,
    propPolicyMaxAnchors: 2,
    propPolicyMasteryThreshold: 0.95,
    skillHintRetrieval: SKILL_HINT_MODES.RECENCY,
    propHintRetrieval: PROP_HINT_MODES.RELEVANCE,
    /** Prop BKT + Tree agents: hint-grounded planning (ideas, hints, chains per pivot) */
    propPlanningEnabled: false,
    propPlanningMaxPivots: 3,
    propPlanningMaxChains: 5,
    propPlanningMaxHints: 8,
    /** Prop BKT training write path — hint reveal strategy */
    propTrainingHintMode: PROP_TRAINING_HINT_MODES.PLANNER_GUIDED,
    propTrainingRetryLlm: true,
    propTrainingAllowAnswerKey: true,
    propTrainingMaxHintsPerStep: 8,
    /** Prop BKT family: optional APS layer (no fine-tuning required for heuristic / llm-prompt) */
    propApsEnabled: false,
    propApsMode: PROP_APS_MODES.HEURISTIC,
    propApsAlignAttempts: false,
    propApsMaxPropositions: 12,
    /** Local GPT-OSS only: classic in-browser BKT vs pyBKT roster service */
    skillBktBackend: SKILL_BKT_BACKEND.CLASSIC,
    pyBktBaseUrl: "http://127.0.0.1:8090",
    cloudModel: "gpt-4",
    /** Read-only default per agent type; local-llm uses skill, local-llm-prop-bkt uses proposition. */
    bktMode: BKT_MODE.SKILL,
};

const STORAGE_KEY = "oatutor-llm-settings";

export function loadLLMSettings(browserStorage) {
    if (!browserStorage?.getByKey) {
        return applyEnvLLMOverrides({ ...DEFAULT_LLM_SETTINGS });
    }
    return browserStorage
        .getByKey(STORAGE_KEY)
        .then((saved) => applyEnvLLMOverrides({ ...DEFAULT_LLM_SETTINGS, ...(saved || {}) }))
        .catch(() => applyEnvLLMOverrides({ ...DEFAULT_LLM_SETTINGS }));
}

export function saveLLMSettings(browserStorage, settings) {
    const merged = applyEnvLLMOverrides({ ...DEFAULT_LLM_SETTINGS, ...settings });
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(merged));
    } catch {
        /* ignore */
    }
    if (!browserStorage?.setByKey) {
        return Promise.resolve(merged);
    }
    return browserStorage.setByKey(STORAGE_KEY, merged).then(() => merged);
}

export function getLLMSettingsSync() {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) return applyEnvLLMOverrides({ ...DEFAULT_LLM_SETTINGS });
        const merged = applyEnvLLMOverrides({ ...DEFAULT_LLM_SETTINGS, ...JSON.parse(raw) });
        if (typeof merged.propPlanningEnabled === "string") {
            merged.propPlanningEnabled = merged.propPlanningEnabled === "true";
        }
        if (typeof merged.propApsEnabled === "string") {
            merged.propApsEnabled = merged.propApsEnabled === "true";
        }
        if (typeof merged.propApsAlignAttempts === "string") {
            merged.propApsAlignAttempts = merged.propApsAlignAttempts === "true";
        }
        return merged;
    } catch {
        return applyEnvLLMOverrides({ ...DEFAULT_LLM_SETTINGS });
    }
}

export { STORAGE_KEY as LLM_SETTINGS_STORAGE_KEY };
