import OpenAI from "openai";
import { DYNAMIC_HINT_URL } from "../../config/config.js";
import { LLM_PROVIDER, getLLMSettingsSync } from "./llmSettings.js";
import {
    extractAnswerFromModelText,
    parseGptOssCompletionChoice,
} from "./llmResponseParse.js";
import { buildGptOssSdkCreateParams } from "./gptOssRequest.js";

export { extractAnswerFromModelText, resolveAssistantAnswer } from "./llmResponseParse.js";
export { buildGptOssHttpBody, buildGptOssSdkCreateParams } from "./gptOssRequest.js";

let _clientCache = null;
let _clientKey = "";

function buildClientKey(settings) {
    return `${settings.provider}|${settings.localBaseUrl}|${settings.localApiKey}`;
}

/**
 * OpenAI SDK client pointed at llama.cpp's /v1 OpenAI-compatible API.
 */
export function getOpenAIClient(settings = getLLMSettingsSync()) {
    const key = buildClientKey(settings);
    if (_clientCache && _clientKey === key) {
        return _clientCache;
    }

    const baseURL =
        settings.provider === LLM_PROVIDER.LOCAL_GPT_OSS
            ? settings.localBaseUrl.replace(/\/$/, "")
            : undefined;

    _clientCache = new OpenAI({
        apiKey: settings.localApiKey || "not-needed",
        baseURL,
        dangerouslyAllowBrowser: true,
    });
    _clientKey = key;
    return _clientCache;
}

export function resetOpenAIClient() {
    _clientCache = null;
    _clientKey = "";
}

/**
 * Non-streaming chat completion via OpenAI client (llama.cpp or cloud).
 */
export async function completeChat(messages, options = {}) {
    const settings = { ...getLLMSettingsSync(), ...options.settings };
    const timeoutMs = options.timeoutMs ?? settings.requestTimeoutMs ?? 120000;

    if (settings.provider === LLM_PROVIDER.CLOUD_GPT4 && !DYNAMIC_HINT_URL) {
        throw new Error("Cloud GPT-4 endpoint is not configured (AI_HINT_GENERATION_AWS_ENDPOINT).");
    }

    if (settings.provider === LLM_PROVIDER.LOCAL_GPT_OSS) {
        const client = getOpenAIClient(settings);
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);

        try {
            const completion = await client.chat.completions.create(
                buildGptOssSdkCreateParams(settings, messages),
                { signal: controller.signal }
            );

            const choice = completion.choices?.[0];
            const parsed = parseGptOssCompletionChoice(choice);

            if (parsed.incompleteReasoning) {
                throw new Error(
                    "gpt-oss response truncated during reasoning (finish_reason=length); " +
                        "final content was empty. Do not set max_tokens on reasoning models."
                );
            }

            return {
                rawText: parsed.rawText,
                content: parsed.content,
                answer: parsed.answer,
                reasoning: parsed.reasoning,
                finishReason: parsed.finishReason,
                truncated: parsed.truncated,
                provider: settings.provider,
                model: completion.model || settings.localModel,
            };
        } finally {
            clearTimeout(timer);
        }
    }

    // Cloud path: reuse existing AWS streaming endpoint with a single user message.
    const prompt = messages.filter((m) => m.role === "user").pop()?.content || "";
    return queryCloudHintEndpoint(prompt, timeoutMs);
}

function queryCloudHintEndpoint(prompt, timeoutMs) {
    return new Promise((resolve, reject) => {
        let resolved = false;
        let streamed = "";
        const timer = setTimeout(() => {
            if (!resolved) {
                resolved = true;
                reject(new Error("Cloud LLM request timed out"));
            }
        }, timeoutMs);

        import("../../components/problem-layout/DynamicHintHelper.js")
            .then(({ fetchDynamicHint }) => {
                fetchDynamicHint(
                    DYNAMIC_HINT_URL,
                    { role: "user", message: prompt },
                    (chunk) => {
                        streamed = chunk || streamed;
                    },
                    () => {
                        if (!resolved) {
                            resolved = true;
                            clearTimeout(timer);
                            resolve({
                                rawText: streamed,
                                answer: extractAnswerFromModelText(streamed),
                                reasoning: null,
                                provider: LLM_PROVIDER.CLOUD_GPT4,
                            });
                        }
                    },
                    (err) => {
                        if (!resolved) {
                            resolved = true;
                            clearTimeout(timer);
                            reject(err);
                        }
                    },
                    "llm-agent",
                    {},
                    {}
                ).catch((err) => {
                    if (!resolved) {
                        resolved = true;
                        clearTimeout(timer);
                        reject(err);
                    }
                });
            })
            .catch(reject);
    });
}

export async function probeLocalLLMServer(settings = getLLMSettingsSync()) {
    const base = (settings.localBaseUrl || "").replace(/\/$/, "");
    const modelsUrl = `${base}/models`;
    const root = base.endsWith("/v1") ? base.slice(0, -3) : base;
    const healthUrl = `${root}/health`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    try {
        const headers = { Authorization: `Bearer ${settings.localApiKey || "not-needed"}` };

        let healthOk = false;
        try {
            const healthRes = await fetch(healthUrl, { method: "GET", signal: controller.signal });
            healthOk = healthRes.ok;
        } catch {
            healthOk = false;
        }

        const res = await fetch(modelsUrl, {
            method: "GET",
            headers,
            signal: controller.signal,
        });
        if (!res.ok) {
            return { ok: false, message: `HTTP ${res.status}`, healthOk };
        }
        const data = await res.json().catch(() => ({}));
        const models = data?.data || [];
        const modelIds = models.map((m) => m.id || m.name).filter(Boolean);
        const suggestedModel = modelIds[0] || null;
        const configuredModel = settings.localModel;
        const modelMatch =
            !configuredModel || modelIds.length === 0
                ? true
                : modelIds.includes(configuredModel);

        return {
            ok: true,
            healthOk,
            models,
            modelIds,
            suggestedModel,
            modelMatch,
            message: modelMatch
                ? `Connected (${modelIds.length} model(s))`
                : `Connected but configured model "${configuredModel}" not in [${modelIds.join(", ")}]`,
        };
    } catch (err) {
        return { ok: false, message: err.message || "Connection failed" };
    } finally {
        clearTimeout(timer);
    }
}
