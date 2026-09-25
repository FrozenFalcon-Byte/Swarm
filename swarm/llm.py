"""LLM access with automatic provider fallback.

Providers are tried in order (SWARM_LLM_PROVIDERS, default
"groq,gemini,openrouter,anthropic"); a provider is used only if it is
configured and reachable, and a failing call falls through to the next one.
Add "ollama" to the list to use a local model.

* ollama     — local, no key. Model: SWARM_OLLAMA_MODEL (default qwen2.5-coder:7b,
               falls back to any installed model).
* groq       — free tier, GROQ_API_KEY        (OpenAI-compatible; SWARM_GROQ_MODEL, default openai/gpt-oss-120b)
* gemini     — free tier, GEMINI_API_KEY      (OpenAI-compatible; SWARM_GEMINI_MODEL, default gemini-flash-latest)
* openrouter — free models, OPENROUTER_API_KEY (SWARM_OPENROUTER_MODEL, default openrouter/free)
* anthropic  — ANTHROPIC_API_KEY

Every agent works without any of them: when nothing is available,
`LLM.available` is False and agents use deterministic heuristics.
"""

from __future__ import annotations

import json
import os
import re
import time
from dataclasses import dataclass
from typing import Any

import httpx

from .config import Settings


class LLMError(RuntimeError):
    pass


_THINK = re.compile(r"<think>.*?</think>", re.S)


@dataclass
class Provider:
    name: str

    def ready(self) -> bool:  # pragma: no cover - interface
        raise NotImplementedError

    def complete(self, system: str, prompt: str, max_tokens: int, json_mode: bool) -> str:  # pragma: no cover
        raise NotImplementedError

    @property
    def model(self) -> str:  # pragma: no cover
        raise NotImplementedError


class Ollama(Provider):
    def __init__(self) -> None:
        super().__init__("ollama")
        self.base = os.environ.get("OLLAMA_HOST", "http://127.0.0.1:11434").rstrip("/")
        self.wanted = os.environ.get("SWARM_OLLAMA_MODEL", "qwen2.5-coder:7b")
        self._model: str | None = None
        self._checked = 0.0

    def ready(self) -> bool:
        if time.monotonic() - self._checked < 30:
            return self._model is not None
        self._checked = time.monotonic()
        try:
            tags = httpx.get(f"{self.base}/api/tags", timeout=1.5).json().get("models", [])
        except (httpx.HTTPError, ValueError):
            self._model = None
            return False
        names = [m["name"] for m in tags]
        self._model = next((n for n in names if n == self.wanted or n.split(":")[0] == self.wanted), None)
        if self._model is None:  # use the most code-capable installed model we can recognise
            prefer = ("coder", "code", "qwen", "llama", "deepseek", "mistral", "gemma")
            ranked = sorted(names, key=lambda n: next((i for i, p in enumerate(prefer) if p in n), 99))
            self._model = ranked[0] if ranked else None
        return self._model is not None

    @property
    def model(self) -> str:
        return self._model or self.wanted

    def complete(self, system: str, prompt: str, max_tokens: int, json_mode: bool) -> str:
        body: dict[str, Any] = {
            "model": self.model,
            "stream": False,
            "messages": [{"role": "system", "content": system}, {"role": "user", "content": prompt}],
            "options": {"num_predict": max_tokens, "temperature": 0.1},
        }
        if json_mode:
            body["format"] = "json"
        if any(k in self.model for k in ("r1", "qwq", "think", "qwen3")):
            # Reasoning models otherwise spend the whole budget thinking and answer with nothing.
            body["think"] = False
            body["options"]["num_predict"] = max(max_tokens, 2048)
        resp = httpx.post(f"{self.base}/api/chat", json=body, timeout=600)
        if resp.status_code != 200:
            raise LLMError(f"ollama {resp.status_code}: {resp.text[:200]}")
        return resp.json()["message"]["content"]


class OpenAICompatible(Provider):
    def __init__(self, name: str, base: str, key_env: str, model_env: str, default_model: str) -> None:
        super().__init__(name)
        self.base = base.rstrip("/")
        self.key = os.environ.get(key_env, "")
        self._model = os.environ.get(model_env, default_model)

    def ready(self) -> bool:
        return bool(self.key)

    @property
    def model(self) -> str:
        return self._model

    def complete(self, system: str, prompt: str, max_tokens: int, json_mode: bool) -> str:
        body: dict[str, Any] = {
            "model": self.model,
            "max_tokens": max_tokens,
            "temperature": 0.1,
            "messages": [{"role": "system", "content": system}, {"role": "user", "content": prompt}],
        }
        if json_mode:
            body["response_format"] = {"type": "json_object"}
        resp = httpx.post(f"{self.base}/chat/completions", json=body, timeout=180,
                          headers={"Authorization": f"Bearer {self.key}"})
        if resp.status_code != 200:
            raise LLMError(f"{self.name} {resp.status_code}: {resp.text[:200]}")
        return resp.json()["choices"][0]["message"]["content"] or ""


class Anthropic(Provider):
    def __init__(self, settings: Settings) -> None:
        super().__init__("anthropic")
        self.settings = settings

    def ready(self) -> bool:
        return bool(self.settings.anthropic_api_key)

    @property
    def model(self) -> str:
        return self.settings.model

    def complete(self, system: str, prompt: str, max_tokens: int, json_mode: bool) -> str:
        resp = httpx.post(
            f"{self.settings.anthropic_base_url.rstrip('/')}/v1/messages",
            headers={"x-api-key": self.settings.anthropic_api_key, "anthropic-version": "2023-06-01",
                     "content-type": "application/json"},
            json={"model": self.model, "max_tokens": max_tokens, "system": system,
                  "messages": [{"role": "user", "content": prompt}]},
            timeout=180,
        )
        if resp.status_code != 200:
            raise LLMError(f"anthropic {resp.status_code}: {resp.text[:200]}")
        return "".join(b.get("text", "") for b in resp.json().get("content", []) if b.get("type") == "text")


def build_providers(settings: Settings) -> list[Provider]:
    table: dict[str, Provider] = {
        "ollama": Ollama(),
        "groq": OpenAICompatible("groq", "https://api.groq.com/openai/v1", "GROQ_API_KEY",
                                 "SWARM_GROQ_MODEL", "openai/gpt-oss-120b"),
        "gemini": OpenAICompatible("gemini", "https://generativelanguage.googleapis.com/v1beta/openai",
                                   "GEMINI_API_KEY", "SWARM_GEMINI_MODEL", "gemini-flash-latest"),
        "openrouter": OpenAICompatible("openrouter", "https://openrouter.ai/api/v1", "OPENROUTER_API_KEY",
                                       "SWARM_OPENROUTER_MODEL", "openrouter/free"),
        "anthropic": Anthropic(settings),
    }
    order = os.environ.get("SWARM_LLM_PROVIDERS", "groq,gemini,openrouter,anthropic")
    return [table[n.strip()] for n in order.split(",") if n.strip() in table]


class LLM:
    def __init__(self, settings: Settings, providers: list[Provider] | None = None):
        self.settings = settings
        self.providers = providers if providers is not None else build_providers(settings)
        self.last_used: str | None = None

    def _ready(self) -> list[Provider]:
        if self.settings.llm_disabled:
            return []
        return [p for p in self.providers if p.ready()]

    @property
    def available(self) -> bool:
        return bool(self._ready())

    def describe(self) -> dict[str, Any]:
        ready = self._ready()
        return {"enabled": bool(ready), "active": f"{ready[0].name}:{ready[0].model}" if ready else None,
                "fallbacks": [f"{p.name}:{p.model}" for p in ready[1:]], "last_used": self.last_used}

    def complete(self, system: str, prompt: str, max_tokens: int = 4096, json_mode: bool = False) -> str:
        errors = []
        for p in self._ready():
            try:
                text = _THINK.sub("", p.complete(system, prompt, max_tokens, json_mode)).strip()
                self.last_used = f"{p.name}:{p.model}"
                return text
            except (LLMError, httpx.HTTPError, KeyError, ValueError) as e:
                errors.append(f"{p.name}: {e}")
        raise LLMError("no LLM provider succeeded" + (f" ({'; '.join(errors)})" if errors else " (none configured)"))

    def complete_json(self, system: str, prompt: str, max_tokens: int = 4096) -> dict[str, Any]:
        text = self.complete(system + "\nRespond with a single JSON object and nothing else.", prompt,
                             max_tokens, json_mode=True)
        return extract_json(text)


def extract_json(text: str) -> dict[str, Any]:
    fenced = re.search(r"```(?:json)?\s*(\{.*?\})\s*```", text, re.S)
    candidate = fenced.group(1) if fenced else text[text.find("{") : text.rfind("}") + 1]
    try:
        return json.loads(candidate)
    except json.JSONDecodeError as e:
        raise LLMError(f"LLM did not return valid JSON: {e}") from e
