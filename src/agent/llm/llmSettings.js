/**
 * Browser-persisted settings for local (llama.cpp) and cloud LLM backends.
 * Defaults match scripts/serve-gpt-oss-20b-gpu.sh (127.0.0.1:8080).
 */

export const LLM_PROVIDER = {
    CLOUD_GPT4: "cloud-gpt4",
    LOCAL_GPT_OSS: "local-gpt-oss",
};

export const DEFAULT_LLM_SETTINGS = {
    provider: LLM_PROVIDER.LOCAL_GPT_OSS,
    localBaseUrl: "http://127.0.0.1:8080/v1",
    localModel: "gpt-oss-20b",
    localApiKey: "not-needed",
    reasoningEffort: "medium",
    requestTimeoutMs: 120000,
    maxBeliefsInPrompt: 12,
    cloudModel: "gpt-4",
};

const STORAGE_KEY = "oatutor-llm-settings";

export function loadLLMSettings(browserStorage) {
    if (!browserStorage?.getByKey) {
        return { ...DEFAULT_LLM_SETTINGS };
    }
    return browserStorage
        .getByKey(STORAGE_KEY)
        .then((saved) => ({ ...DEFAULT_LLM_SETTINGS, ...(saved || {}) }))
        .catch(() => ({ ...DEFAULT_LLM_SETTINGS }));
}

export function saveLLMSettings(browserStorage, settings) {
    const merged = { ...DEFAULT_LLM_SETTINGS, ...settings };
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
        if (!raw) return { ...DEFAULT_LLM_SETTINGS };
        return { ...DEFAULT_LLM_SETTINGS, ...JSON.parse(raw) };
    } catch {
        return { ...DEFAULT_LLM_SETTINGS };
    }
}

export { STORAGE_KEY as LLM_SETTINGS_STORAGE_KEY };
