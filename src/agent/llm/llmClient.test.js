import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
    extractAnswerFromModelText,
    parseGptOssCompletionChoice,
    resolveAssistantAnswer,
} from "./llmResponseParse.js";
import { buildGptOssHttpBody } from "./gptOssRequest.js";

const REMOTE_BASE_URL =
    process.env.REACT_APP_LLM_BASE_URL || "http://10.10.102.139:8080/v1";
const REMOTE_MODEL =
    process.env.REACT_APP_LLM_MODEL || "gpt-oss-20b-MXFP4.gguf";

const remoteSettings = {
    localModel: REMOTE_MODEL,
    reasoningEffort: "medium",
};

describe("llmResponseParse", () => {
    it("resolveAssistantAnswer prefers content over reasoning", () => {
        assert.equal(
            resolveAssistantAnswer({ content: "$$4$$", reasoning_content: "long think..." }),
            "$$4$$"
        );
    });

    it("resolveAssistantAnswer falls back to reasoning when content empty", () => {
        assert.equal(
            resolveAssistantAnswer({ content: "", reasoning_content: "Thus $$5$$" }),
            "$$5$$"
        );
    });

    it("parseGptOssCompletionChoice flags truncated reasoning-only responses", () => {
        const parsed = parseGptOssCompletionChoice({
            finish_reason: "length",
            message: { reasoning_content: "still thinking...", content: "" },
        });
        assert.equal(parsed.incompleteReasoning, true);
        assert.equal(parsed.truncated, true);
    });
});

describe("gptOssRequest", () => {
    it("buildGptOssHttpBody omits max_tokens and sets chat_template_kwargs", () => {
        const body = buildGptOssHttpBody(remoteSettings, [
            { role: "user", content: "hi" },
        ]);
        assert.equal(body.model, REMOTE_MODEL);
        assert.equal(body.chat_template_kwargs.reasoning_effort, "medium");
        assert.equal("max_tokens" in body, false);
    });
});

describe("remote gpt-oss chat/completions (app request shape)", () => {
    it("returns content answer without max_tokens cap", async () => {
        const body = buildGptOssHttpBody(remoteSettings, [
            {
                role: "system",
                content:
                    "Respond with ONLY the final answer in LaTeX wrapped in $$...$$ with no explanation.",
            },
            { role: "user", content: "What is 2+2? Final answer:" },
        ]);

        const url = `${REMOTE_BASE_URL.replace(/\/$/, "")}/chat/completions`;
        const res = await fetch(url, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Authorization: "Bearer not-needed",
            },
            body: JSON.stringify(body),
        });
        assert.equal(res.ok, true, `HTTP ${res.status}`);
        const payload = await res.json();
        const parsed = parseGptOssCompletionChoice(payload?.choices?.[0]);
        assert.ok(parsed.answer, JSON.stringify(parsed));
        assert.match(parsed.answer, /4/);
        assert.ok(parsed.content || parsed.reasoning, "expected content or reasoning");
    });
});
