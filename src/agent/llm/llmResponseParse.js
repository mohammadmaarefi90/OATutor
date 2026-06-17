/**
 * Parse gpt-oss / Harmony-style chat responses where reasoning and final
 * answer are returned in separate fields (reasoning_content vs content).
 */

export function normalizeMessageContent(message) {
    if (!message) return { content: "", reasoning: "" };

    let content = "";
    if (typeof message.content === "string") {
        content = message.content;
    } else if (Array.isArray(message.content)) {
        content = message.content
            .filter((b) => b?.type === "text" && b.text)
            .map((b) => b.text)
            .join("\n");
    }

    const reasoning =
        typeof message.reasoning_content === "string" ? message.reasoning_content : "";

    return { content: content.trim(), reasoning: reasoning.trim() };
}

export function extractMessageText(message) {
    const { content, reasoning } = normalizeMessageContent(message);
    return [reasoning, content].filter(Boolean).join("\n").trim();
}

export function extractAnswerFromModelText(text) {
    if (!text) return null;
    const dollarBlock = text.match(/\$\$([^$]+)\$\$/);
    if (dollarBlock) return `$$${dollarBlock[1].trim()}$$`;
    const dollarInline = text.match(/(?:^|[^\$])\$([^$\n]+)\$(?:[^\$]|$)/);
    if (dollarInline) return `$$${dollarInline[1].trim()}$$`;
    const lines = text.trim().split("\n").filter(Boolean);
    return lines[lines.length - 1]?.trim() || null;
}

/**
 * Final answer: prefer `content` (Harmony final channel). Fall back to
 * `reasoning_content` only when content is empty — e.g. server still
 * generating or truncated mid-reasoning.
 */
export function resolveAssistantAnswer(message) {
    const { content, reasoning } = normalizeMessageContent(message);

    if (content) {
        const fromContent = extractAnswerFromModelText(content);
        if (fromContent) return fromContent;
        if (content.length <= 240) return content;
    }

    if (reasoning) {
        return extractAnswerFromModelText(reasoning);
    }

    return null;
}

export function parseGptOssCompletionChoice(choice) {
    const message = choice?.message || null;
    const finishReason = choice?.finish_reason || null;
    const { content, reasoning } = normalizeMessageContent(message);
    const answer = resolveAssistantAnswer(message);
    const truncated = finishReason === "length";
    const incompleteReasoning = truncated && !content && !!reasoning;

    return {
        message,
        content: content || null,
        reasoning: reasoning || null,
        answer,
        rawText: extractMessageText(message),
        finishReason,
        truncated,
        incompleteReasoning,
    };
}
