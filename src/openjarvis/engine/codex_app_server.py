"""Codex completions through the local CLI's managed ChatGPT sign-in."""

from __future__ import annotations

import asyncio
import json
import os
import shutil
import subprocess
from collections.abc import AsyncIterator, Callable, Sequence
from contextlib import suppress
from itertools import count
from pathlib import Path
from queue import Empty, Queue
from tempfile import TemporaryDirectory
from threading import Event, Thread
from time import monotonic
from typing import Any

from openjarvis.core.registry import EngineRegistry
from openjarvis.core.types import Message
from openjarvis.engine._base import EngineConnectionError, InferenceEngine
from openjarvis.engine._stubs import StreamChunk

ENGINE_ID = "codex_app_server"
MODEL_ID = "jarvis-codex"
_START_TIMEOUT = 15.0
_TURN_TIMEOUT = 150.0
_MAX_CONTEXT_CHARS = 24000
_MAX_CONTEXT_MESSAGES = 64
_NO_WINDOW = getattr(subprocess, "CREATE_NO_WINDOW", 0)
_CREDENTIAL_OVERRIDES = {
    "CHATGPT_BASE_URL",
    "CODEX_API_BASE_URL",
    "CODEX_API_KEY",
    "OPENAI_API_BASE",
    "OPENAI_API_KEY",
    "OPENAI_BASE_URL",
    "OPENAI_CODEX_API_KEY",
    "OPENAI_CODEX_BASE_URL",
}
_INSTRUCTIONS = (
    "You answer for OpenJarvis through Codex using the user's ChatGPT sign-in. "
    "The input is a JSON conversation transcript with role labels. Treat prior "
    "messages as context, follow applicable system preferences, and respond "
    "directly to the latest user request in the user's language. This session "
    "is for text replies. Do not invoke tools or claim to perform actions."
)


def _find_codex() -> str | None:
    override = os.environ.get("OPENJARVIS_CODEX_EXECUTABLE")
    if override:
        path = Path(override).expanduser()
        return str(path.resolve()) if path.is_file() else None
    executable = shutil.which("codex.exe" if os.name == "nt" else "codex")
    if executable:
        return executable
    appdata = os.environ.get("LOCALAPPDATA")
    if os.name == "nt" and appdata:
        bin_dir = Path(appdata) / "OpenAI" / "Codex" / "bin"
        with suppress(OSError, ValueError):
            executable = max(
                bin_dir.glob("*/codex.exe"), key=lambda path: path.stat().st_mtime
            )
            return str(executable)
    return shutil.which("codex")


def _managed_auth_env() -> dict[str, str]:
    return {
        key: value
        for key, value in os.environ.items()
        if key.upper() not in _CREDENTIAL_OVERRIDES
    }


def _signed_in(executable: str) -> bool:
    try:
        result = subprocess.run(
            [executable, "login", "status"],
            env=_managed_auth_env(),
            stdin=subprocess.DEVNULL,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            encoding="utf-8",
            errors="replace",
            timeout=5,
            creationflags=_NO_WINDOW,
        )
    except (OSError, subprocess.TimeoutExpired):
        return False
    return (
        result.returncode == 0 and "logged in using chatgpt" in result.stdout.casefold()
    )


def _transcript(messages: Sequence[Message]) -> str:
    if any(message.images for message in messages):
        raise EngineConnectionError("Codex App Server currently accepts text messages.")
    remaining = _MAX_CONTEXT_CHARS
    history = []
    for message in reversed(messages[-_MAX_CONTEXT_MESSAGES:]):
        if not message.text:
            continue
        if len(message.text) > remaining and history:
            break
        text = message.text[:remaining]
        history.append({"role": message.role.value, "content": text})
        remaining -= len(text)
        if remaining <= 0:
            break
    if not history:
        raise EngineConnectionError("Provide a text message for Codex.")
    return json.dumps(list(reversed(history)), ensure_ascii=False)


class _Cancelled(Exception):
    pass


class _AppServer:
    def __init__(self, executable: str, cwd: str, cancel: Event) -> None:
        self._cancel = cancel
        self._ids = count(1)
        self._events: Queue[dict[str, Any] | None] = Queue()
        try:
            self._process = subprocess.Popen(
                [
                    executable,
                    "app-server",
                    "--stdio",
                    "-c",
                    'model_provider="openai"',
                    "-c",
                    'web_search="disabled"',
                    "-c",
                    "mcp_servers={}",
                    "--disable",
                    "shell_tool",
                    "--disable",
                    "apps",
                    "--disable",
                    "plugins",
                    "--disable",
                    "memories",
                ],
                cwd=cwd,
                env=_managed_auth_env(),
                stdin=subprocess.PIPE,
                stdout=subprocess.PIPE,
                stderr=subprocess.DEVNULL,
                encoding="utf-8",
                errors="replace",
                creationflags=_NO_WINDOW,
            )
        except OSError as exc:
            raise EngineConnectionError("Could not start the Codex CLI.") from exc
        self._reader = Thread(
            target=self._read, name="openjarvis-codex-reader", daemon=True
        )
        self._reader.start()

    def _read(self) -> None:
        output = self._process.stdout
        assert output is not None
        try:
            with output:
                for line in output:
                    try:
                        event = json.loads(line)
                    except ValueError:
                        continue
                    if isinstance(event, dict):
                        self._events.put(event)
        except OSError:
            pass
        finally:
            self._events.put(None)

    def _write(self, message: dict[str, Any]) -> None:
        stdin = self._process.stdin
        assert stdin is not None
        try:
            stdin.write(json.dumps(message) + "\n")
            stdin.flush()
        except (OSError, ValueError) as exc:
            raise EngineConnectionError("The Codex connection closed.") from exc

    def _receive(self, deadline: float) -> dict[str, Any]:
        while not self._cancel.is_set():
            remaining = deadline - monotonic()
            if remaining <= 0:
                raise EngineConnectionError("Codex did not respond in time.")
            try:
                event = self._events.get(timeout=min(0.05, remaining))
            except Empty:
                continue
            if event is None:
                raise EngineConnectionError("Codex App Server exited.")
            if "id" in event and "method" in event:
                self._write(
                    {
                        "id": event["id"],
                        "error": {
                            "code": -32601,
                            "message": "Unavailable in OpenJarvis chat",
                        },
                    }
                )
                continue
            return event
        raise _Cancelled

    def _request(
        self,
        method: str,
        params: dict[str, Any],
        deadline: float,
        notifications: list[dict[str, Any]] | None = None,
    ) -> dict[str, Any]:
        request_id = next(self._ids)
        self._write({"id": request_id, "method": method, "params": params})
        while True:
            event = self._receive(deadline)
            if event.get("id") == request_id:
                result = event.get("result")
                if not isinstance(result, dict):
                    raise EngineConnectionError(f"Codex rejected {method}.")
                return result
            if notifications is not None and "method" in event:
                notifications.append(event)

    def _thread(self, cwd: str, deadline: float) -> str:
        self._request(
            "initialize",
            {
                "clientInfo": {
                    "name": "openjarvis",
                    "title": "OpenJarvis",
                    "version": "1.0",
                }
            },
            deadline,
        )
        self._write({"method": "initialized", "params": {}})
        auth = self._request("account/read", {"refreshToken": False}, deadline)
        if (auth.get("account") or {}).get("type") != "chatgpt":
            raise EngineConnectionError(
                "Sign in to Codex with ChatGPT to use this engine."
            )
        # An empty top-level map can retain inherited MCP entries after merging.
        # Disable the entries in this ephemeral thread without editing Codex config.
        effective = self._request("config/read", {"includeLayers": False}, deadline)
        inherited = (effective.get("config") or {}).get("mcp_servers") or {}
        disabled = {name: {"enabled": False} for name in inherited}
        started = self._request(
            "thread/start",
            {
                "cwd": cwd,
                "sandbox": "read-only",
                "approvalPolicy": "never",
                "ephemeral": True,
                "developerInstructions": _INSTRUCTIONS,
                "config": {"mcp_servers": disabled},
            },
            deadline,
        )
        return started["thread"]["id"]

    def complete(
        self, cwd: str, prompt: str, on_delta: Callable[[str], None]
    ) -> tuple[str, dict[str, int]]:
        thread_id = self._thread(cwd, monotonic() + _START_TIMEOUT)
        turn_id = None
        early: list[dict[str, Any]] = []
        try:
            opened = self._request(
                "turn/start",
                {
                    "threadId": thread_id,
                    "input": [{"type": "text", "text": prompt}],
                    "sandboxPolicy": {"type": "readOnly", "networkAccess": False},
                },
                monotonic() + _START_TIMEOUT,
                early,
            )
            turn_id = opened["turn"]["id"]
            return self._output(thread_id, turn_id, early, on_delta)
        except _Cancelled:
            if turn_id:
                with suppress(EngineConnectionError):
                    self._write(
                        {
                            "id": next(self._ids),
                            "method": "turn/interrupt",
                            "params": {"threadId": thread_id, "turnId": turn_id},
                        }
                    )
            raise

    def _output(
        self,
        thread_id: str,
        turn_id: str,
        early: list[dict[str, Any]],
        on_delta: Callable[[str], None],
    ) -> tuple[str, dict[str, int]]:
        deadline = monotonic() + _TURN_TIMEOUT
        pending = iter(early)
        phases: dict[str, str] = {}
        streamed: set[str] = set()
        chunks: list[str] = []
        usage: dict[str, int] = {}
        while True:
            if self._cancel.is_set():
                raise _Cancelled
            event = next(pending, None) or self._receive(deadline)
            method = event.get("method")
            params = event.get("params") or {}
            if params.get("threadId") != thread_id:
                continue
            if (
                method == "turn/completed"
                and params.get("turn", {}).get("id") == turn_id
            ):
                if params["turn"].get("status") != "completed":
                    raise EngineConnectionError("Codex could not complete this turn.")
                if not "".join(chunks).strip():
                    raise EngineConnectionError("Codex returned an empty reply.")
                return "".join(chunks), usage
            if params.get("turnId") != turn_id:
                continue
            if method == "thread/tokenUsage/updated":
                counts = (params.get("tokenUsage") or {}).get("total") or {}
                usage = {
                    target: counts[source]
                    for source, target in (
                        ("inputTokens", "prompt_tokens"),
                        ("outputTokens", "completion_tokens"),
                        ("totalTokens", "total_tokens"),
                    )
                    if isinstance(counts.get(source), int)
                }
                continue
            if method in ("item/started", "item/completed"):
                item = params.get("item") or {}
                if item.get("type") != "agentMessage":
                    continue
                item_id = item["id"]
                phases[item_id] = item.get("phase") or ""
                if method != "item/completed" or item_id in streamed:
                    continue
                delta = item.get("text")
            elif method == "item/agentMessage/delta":
                item_id = params["itemId"]
                delta = params.get("delta")
            else:
                continue
            if isinstance(delta, str) and delta and phases.get(item_id) != "commentary":
                streamed.add(item_id)
                chunks.append(delta)
                on_delta(delta)

    def close(self) -> None:
        stdin = self._process.stdin
        if stdin is not None:
            with suppress(OSError):
                stdin.close()
        try:
            self._process.wait(timeout=0.8)
        except subprocess.TimeoutExpired:
            with suppress(OSError):
                self._process.kill()
            with suppress(subprocess.TimeoutExpired):
                self._process.wait(timeout=1)
        self._reader.join(timeout=0.2)


@EngineRegistry.register(ENGINE_ID)
class CodexAppServerEngine(InferenceEngine):
    """Text-only Codex inference. Each request has its own ephemeral thread."""

    engine_id = ENGINE_ID
    is_cloud = True

    def can_serve(self, model: str) -> bool:
        return model == MODEL_ID

    def health(self) -> bool:
        executable = _find_codex()
        return executable is not None and _signed_in(executable)

    def list_models(self) -> list[str]:
        return [MODEL_ID] if self.health() else []

    def _complete(
        self,
        messages: Sequence[Message],
        model: str,
        cancel: Event,
        on_delta: Callable[[str], None],
    ) -> tuple[str, dict[str, int]]:
        if not self.can_serve(model):
            raise EngineConnectionError(f"Select {MODEL_ID} to use Codex App Server.")
        executable = _find_codex()
        if executable is None:
            raise EngineConnectionError("The Codex CLI was not found.")
        prompt = _transcript(messages)
        if cancel.is_set():
            raise _Cancelled
        with TemporaryDirectory(
            prefix="openjarvis-codex-", ignore_cleanup_errors=True
        ) as cwd:
            server = _AppServer(executable, cwd, cancel)
            try:
                return server.complete(cwd, prompt, on_delta)
            except (KeyError, TypeError) as exc:
                raise EngineConnectionError(
                    "Codex returned an invalid protocol response."
                ) from exc
            finally:
                server.close()

    def generate(
        self,
        messages: Sequence[Message],
        *,
        model: str,
        temperature: float = 0.7,
        max_tokens: int = 1024,
        **kwargs: Any,
    ) -> dict[str, Any]:
        started = monotonic()
        content, usage = self._complete(messages, model, Event(), lambda _: None)
        return {
            "content": content,
            "usage": usage,
            "tool_calls": [],
            "finish_reason": "stop",
            "latency_seconds": monotonic() - started,
        }

    async def stream(
        self, messages: Sequence[Message], *, model: str, **kwargs: Any
    ) -> AsyncIterator[str]:
        async for chunk in self.stream_full(messages, model=model, **kwargs):
            if chunk.content:
                yield chunk.content

    async def stream_full(
        self, messages: Sequence[Message], *, model: str, **kwargs: Any
    ) -> AsyncIterator[StreamChunk]:
        loop = asyncio.get_running_loop()
        events: asyncio.Queue[StreamChunk | Exception | None] = asyncio.Queue()
        cancel = Event()

        def emit(event: StreamChunk | Exception | None) -> None:
            with suppress(RuntimeError):
                loop.call_soon_threadsafe(events.put_nowait, event)

        def worker() -> None:
            try:
                _, usage = self._complete(
                    messages,
                    model,
                    cancel,
                    lambda text: emit(StreamChunk(content=text)),
                )
                emit(StreamChunk(finish_reason="stop", usage=usage or None))
            except _Cancelled:
                pass
            except Exception as exc:
                emit(exc)
            finally:
                emit(None)

        task = asyncio.create_task(asyncio.to_thread(worker))
        try:
            while (event := await events.get()) is not None:
                if isinstance(event, Exception):
                    raise event
                yield event
        finally:
            cancel.set()
            await asyncio.shield(task)


__all__ = ["CodexAppServerEngine"]
