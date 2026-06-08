import OpenAI from "openai";
import { DYNAMIC_HINT_URL } from "../../config/config.js";
import { LLM_PROVIDER, getLLMSettingsSync } from "./llmSettings.js";

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

function extractMessageText(message) {
    if (!message) return "";
    const parts = [];
    if (message.reasoning_content) parts.push(message.reasoning_content);
    if (message.content) {
        if (typeof message.content === "string") {
            parts.push(message.content);
        } else if (Array.isArray(message.content)) {
            message.content.forEach((block) => {
                if (block?.type === "text" && block.text) parts.push(block.text);
            });
        }
    }
    return parts.join("\n").trim();
}

export function extractAnswerFromModelText(text) {
    if (!text) return null;
    const dollarMatch = text.match(/\$\$([^$]+)\$\$/);
    if (dollarMatch) return `$$${dollarMatch[1].trim()}$$`;
    const lines = text.trim().split("\n").filter(Boolean);
    return lines[lines.length - 1]?.trim() || null;
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
                {
                    model: settings.localModel || "gpt-oss-20b",
                    messages,
                    temperature: 1.0,
                    top_p: 1.0,
                    reasoning_effort: settings.reasoningEffort || "medium",
                    extra_body: {
                        chat_template_kwargs: {
                            reasoning_effort: settings.reasoningEffort || "medium",
                        },
                    },
                },
                { signal: controller.signal }
            );

            const message = completion.choices?.[0]?.message;
            const content =
                typeof message?.content === "string"
                    ? message.content
                    : Array.isArray(message?.content)
                      ? message.content
                            .filter((b) => b?.type === "text" && b.text)
                            .map((b) => b.text)
                            .join("\n")
                      : "";
            const reasoning = message?.reasoning_content || null;
            const rawText = extractMessageText(message);
            return {
                rawText,
                content: content || null,
                answer: extractAnswerFromModelText(content || rawText),
                reasoning,
                provider: settings.provider,
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
    const url = `${base}/models`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    try {
        const res = await fetch(url, {
            method: "GET",
            headers: { Authorization: `Bearer ${settings.localApiKey || "not-needed"}` },
            signal: controller.signal,
        });
        if (!res.ok) {
            return { ok: false, message: `HTTP ${res.status}` };
        }
        const data = await res.json().catch(() => ({}));
        return { ok: true, models: data?.data || [] };
    } catch (err) {
        return { ok: false, message: err.message || "Connection failed" };
    } finally {
        clearTimeout(timer);
    }
}
