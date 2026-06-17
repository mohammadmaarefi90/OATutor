/**
 * Request shape for gpt-oss on llama.cpp (OpenAI-compatible /v1/chat/completions).
 *
 * llama-server requires reasoning effort via chat_template_kwargs (--jinja).
 * Do not set max_tokens: reasoning models emit reasoning_content first, then
 * content; a low cap truncates reasoning and yields an empty final answer.
 *
 * @see https://github.com/ggml-org/llama.cpp/discussions/15142
 * @see https://github.com/ggml-org/llama.cpp/issues/15130
 */

export function buildGptOssHttpBody(settings, messages) {
    const reasoningEffort = settings.reasoningEffort || "medium";
    return {
        model: settings.localModel || "gpt-oss-20b-MXFP4.gguf",
        messages,
        temperature: 1.0,
        top_p: 1.0,
        chat_template_kwargs: {
            reasoning_effort: reasoningEffort,
        },
    };
}

/**
 * OpenAI Node SDK body — chat_template_kwargs must be passed via extra_body
 * for llama.cpp servers.
 */
export function buildGptOssSdkCreateParams(settings, messages) {
    const reasoningEffort = settings.reasoningEffort || "medium";
    return {
        model: settings.localModel || "gpt-oss-20b-MXFP4.gguf",
        messages,
        temperature: 1.0,
        top_p: 1.0,
        extra_body: {
            chat_template_kwargs: {
                reasoning_effort: reasoningEffort,
            },
        },
    };
}
