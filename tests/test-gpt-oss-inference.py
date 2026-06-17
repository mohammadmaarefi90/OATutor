#!/usr/bin/env python3
"""
Smoke-test gpt-oss-20b served by llama.cpp (OpenAI-compatible API).

Works from any machine that can reach the server (localhost, Docker host, LAN).

Examples:
  python3 scripts/test-gpt-oss-inference.py
  python3 scripts/test-gpt-oss-inference.py --base-url http://10.10.102.139:8080/v1
  OPENAI_BASE_URL=http://192.168.1.50:8080/v1 python3 scripts/test-gpt-oss-inference.py

Dependencies: Python 3.9+ standard library only.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import time
import urllib.error
import urllib.request
from typing import Any


def _normalize_base_url(url: str) -> str:
    out = url.strip().rstrip("/")
    if not out.endswith("/v1"):
        out += "/v1"
    return out


def _request(
    method: str,
    url: str,
    *,
    api_key: str = "",
    body: dict[str, Any] | None = None,
    timeout: float = 120.0,
) -> tuple[int, Any]:
    headers = {"Accept": "application/json"}
    if api_key:
        headers["Authorization"] = f"Bearer {api_key}"
    data = None
    if body is not None:
        headers["Content-Type"] = "application/json"
        data = json.dumps(body).encode("utf-8")

    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            raw = resp.read().decode("utf-8", errors="replace")
            status = int(resp.status)
    except urllib.error.HTTPError as exc:
        raw = exc.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"HTTP {exc.code} {url}\n{raw[:800]}") from exc
    except urllib.error.URLError as exc:
        raise RuntimeError(f"Connection failed: {url}\n{exc}") from exc

    if not raw.strip():
        return status, None
    try:
        return status, json.loads(raw)
    except json.JSONDecodeError:
        return status, raw


def _root_url(base_url: str) -> str:
    if base_url.endswith("/v1"):
        return base_url[:-3].rstrip("/")
    return base_url.rstrip("/")


def _print_section(title: str) -> None:
    print(f"\n{'=' * 60}")
    print(title)
    print("=" * 60)


def _message_fields(message: dict[str, Any]) -> tuple[str, str]:
    content = (message.get("content") or "").strip()
    reasoning = (message.get("reasoning_content") or "").strip()
    return content, reasoning


def test_health(base_url: str, api_key: str, timeout: float) -> None:
    url = f"{_root_url(base_url)}/health"
    status, payload = _request("GET", url, api_key=api_key, timeout=timeout)
    if status != 200:
        raise RuntimeError(f"health check failed: HTTP {status}")
    if isinstance(payload, dict) and payload.get("status") not in (None, "ok"):
        raise RuntimeError(f"unexpected health payload: {payload!r}")
    print(f"OK  GET {url} -> {payload!r}")


def test_models(base_url: str, api_key: str, timeout: float) -> str:
    url = f"{base_url}/models"
    status, payload = _request("GET", url, api_key=api_key, timeout=timeout)
    if status != 200 or not isinstance(payload, dict):
        raise RuntimeError(f"models list failed: HTTP {status}")

    models = payload.get("data") or []
    if not models:
        raise RuntimeError("models list is empty")

    model_id = models[0].get("id") or models[0].get("name") or ""
    if not model_id:
        raise RuntimeError(f"could not read model id from: {models[0]!r}")

    ids = [m.get("id", m.get("name", "?")) for m in models]
    print(f"OK  GET {url}")
    print(f"    models: {ids}")
    return str(model_id)


def test_chat_completion(
    base_url: str,
    api_key: str,
    model: str,
    *,
    prompt: str,
    reasoning_effort: str,
    max_tokens: int,
    timeout: float,
    label: str,
) -> dict[str, Any]:
    url = f"{base_url}/chat/completions"
    body = {
        "model": model,
        "messages": [{"role": "user", "content": prompt}],
        "max_tokens": max_tokens,
        "temperature": 0.7,
        "chat_template_kwargs": {"reasoning_effort": reasoning_effort},
    }

    t0 = time.perf_counter()
    status, payload = _request("POST", url, api_key=api_key, body=body, timeout=timeout)
    elapsed_ms = (time.perf_counter() - t0) * 1000.0

    if status != 200 or not isinstance(payload, dict):
        raise RuntimeError(f"{label}: chat completion failed: HTTP {status}")

    choices = payload.get("choices") or []
    if not choices:
        raise RuntimeError(f"{label}: no choices in response")

    message = choices[0].get("message") or {}
    content, reasoning = _message_fields(message)
    usage = payload.get("usage") or {}
    timings = payload.get("timings") or {}

    print(f"OK  POST {url} [{label}]")
    print(f"    wall time: {elapsed_ms:.0f} ms")
    if usage:
        print(
            f"    tokens: prompt={usage.get('prompt_tokens')} "
            f"completion={usage.get('completion_tokens')} "
            f"total={usage.get('total_tokens')}"
        )
    if timings.get("predicted_per_second"):
        print(f"    server decode: {timings['predicted_per_second']:.1f} tok/s")

    if reasoning:
        preview = reasoning.replace("\n", " ")[:240]
        print(f"    reasoning: {preview}{'…' if len(reasoning) > 240 else ''}")
    else:
        print("    reasoning: (empty)")

    if content:
        preview = content.replace("\n", " ")[:240]
        print(f"    content:   {preview}{'…' if len(content) > 240 else ''}")
    else:
        print("    content:   (empty)")

    if not content and not reasoning:
        raise RuntimeError(f"{label}: both content and reasoning_content are empty")

    return payload


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Test gpt-oss inference via llama.cpp OpenAI API")
    parser.add_argument(
        "--base-url",
        default=os.environ.get("OPENAI_BASE_URL", "http://127.0.0.1:8080/v1"),
        help="OpenAI-compatible base URL (env: OPENAI_BASE_URL)",
    )
    parser.add_argument(
        "--model",
        default=os.environ.get("MODEL_NAME", ""),
        help="Model id (default: first model from GET /v1/models)",
    )
    parser.add_argument(
        "--api-key",
        default=os.environ.get("OPENAI_API_KEY", "not-needed"),
        help="API key (env: OPENAI_API_KEY; local llama.cpp usually ignores it)",
    )
    parser.add_argument(
        "--reasoning-effort",
        choices=["low", "medium", "high"],
        default=os.environ.get("LLAMA_REASONING", "medium"),
        help="gpt-oss Harmony reasoning_effort template kwarg",
    )
    parser.add_argument(
        "--max-tokens",
        type=int,
        default=int(os.environ.get("MAX_NEW_TOKENS", "128")),
        help="Max completion tokens per test",
    )
    parser.add_argument(
        "--timeout",
        type=float,
        default=float(os.environ.get("LLAMA_TEST_TIMEOUT", "180")),
        help="HTTP timeout in seconds",
    )
    parser.add_argument(
        "--skip-reasoning",
        action="store_true",
        help="Only run connectivity + short reply test",
    )
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    base_url = _normalize_base_url(args.base_url)

    print(f"Target: {base_url}")
    print(f"Reasoning effort: {args.reasoning_effort}")

    try:
        _print_section("1/3 Health")
        test_health(base_url, args.api_key, min(args.timeout, 30.0))

        _print_section("2/3 Models")
        model = args.model or test_models(base_url, args.api_key, min(args.timeout, 30.0))
        if args.model:
            test_models(base_url, args.api_key, min(args.timeout, 30.0))
            print(f"    using model: {model}")
        else:
            print(f"    using model: {model}")

        _print_section("3/3 Chat completions")
        test_chat_completion(
            base_url,
            args.api_key,
            model,
            prompt="Reply with exactly one word: ready",
            reasoning_effort=args.reasoning_effort,
            max_tokens=min(args.max_tokens, 32),
            timeout=args.timeout,
            label="short-reply",
        )

        if not args.skip_reasoning:
            test_chat_completion(
                base_url,
                args.api_key,
                model,
                prompt=(
                    "A bat and a ball cost $1.10 in total. The bat costs $1.00 more than the ball. "
                    "How much does the ball cost? Think step by step, then give the final answer."
                ),
                reasoning_effort=args.reasoning_effort,
                max_tokens=args.max_tokens,
                timeout=args.timeout,
                label="reasoning-math",
            )

    except RuntimeError as exc:
        print(f"\nFAILED: {exc}", file=sys.stderr)
        return 1

    _print_section("All tests passed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
