"""MCP profile tests for the Codex App Server engine."""

from __future__ import annotations

import json
from threading import Event
from unittest.mock import Mock

import pytest

from openjarvis.core.types import Message, Role
from openjarvis.engine import codex_app_server
from openjarvis.engine._base import EngineConnectionError
from openjarvis.engine.codex_app_server import (
    MODEL_ID,
    CodexAppServerEngine,
    _AppServer,
)


def _thread_options(requested_model: str | None = None) -> dict:
    server = object.__new__(_AppServer)
    server._initialized = False
    results = {
        "initialize": {},
        "account/read": {"account": {"type": "chatgpt"}},
        "config/read": {
            "config": {
                "mcp_servers": {
                    "playwright": {"command": "ambient", "env": {"TEST": "inherited"}},
                    "other": {"command": "ambient"},
                }
            }
        },
        "thread/start": {"thread": {"id": "thread"}},
    }
    server._request = Mock(side_effect=lambda method, *_args: results[method])
    server._write = Mock()

    assert server._thread(".", 0, requested_model) == "thread"
    method, options, _deadline = server._request.call_args.args
    assert method == "thread/start"
    assert options["sandbox"] == "read-only"
    assert options["approvalPolicy"] == "never"
    return options


def test_codex_mcp_profile_defaults_to_text(monkeypatch):
    monkeypatch.delenv("OPENJARVIS_CODEX_MCP_CONFIG", raising=False)

    options = _thread_options()

    assert "model" not in options
    assert "Do not invoke tools" in options["developerInstructions"]
    assert options["config"]["mcp_servers"] == {
        "playwright": {"enabled": False},
        "other": {"enabled": False},
    }


def test_codex_exact_model_is_passed_to_thread_start(monkeypatch):
    monkeypatch.delenv("OPENJARVIS_CODEX_MCP_CONFIG", raising=False)
    assert _thread_options("example-model")["model"] == "example-model"


def test_codex_catalog_reports_effective_default_and_visible_aliases():
    server = object.__new__(_AppServer)
    server._initialized = True
    server._request = Mock(
        side_effect=[
            {"account": {"type": "chatgpt"}},
            {"config": {"model": "example-fast"}},
            {
                "data": [
                    {"id": "example-auto", "displayName": "Auto", "isDefault": True},
                    {"id": "example-hidden", "hidden": True},
                ],
                "nextCursor": "second",
            },
            {
                "data": [
                    {"id": "another-id", "model": "example-fast", "displayName": "Fast"}
                ]
            },
        ]
    )

    assert server.model_catalog(0) == {
        "default_model": "example-fast",
        "models": [
            {
                "id": "jarvis-codex/example-auto",
                "model": "example-auto",
                "display_name": "Auto",
                "is_default": False,
            },
            {
                "id": "jarvis-codex/example-fast",
                "model": "example-fast",
                "display_name": "Fast",
                "is_default": True,
            },
        ],
    }
    assert server._request.call_args.args[:2] == (
        "model/list",
        {"includeHidden": False, "cursor": "second"},
    )


def test_codex_mcp_profile_preserves_only_explicit_tools_and_approvals(
    monkeypatch, tmp_path
):
    browser = {
        "command": "fixture",
        "args": ["--profile", "test-profile"],
        "enabled_tools": ["browser_snapshot", "browser_click"],
        "tools": {"browser_click": {"approval_mode": "approve"}},
    }
    profile = tmp_path / "mcp.json"
    profile.write_text(
        json.dumps(
            {"mcp_servers": {"playwright": browser, "disabled": {"enabled": False}}}
        ),
        encoding="utf-8",
    )
    monkeypatch.setenv("OPENJARVIS_CODEX_MCP_CONFIG", str(profile))

    options = _thread_options()

    assert "Use the configured MCP tools" in options["developerInstructions"]
    assert options["config"]["mcp_servers"] == {
        "playwright": {"enabled": False},
        "other": {"enabled": False},
        "openjarvis_playwright": browser,
    }


def test_codex_mcp_profile_rejects_invalid_config_without_exposing_it(
    monkeypatch, tmp_path
):
    profile = tmp_path / "mcp.json"
    profile.write_text("invalid config with a private value", encoding="utf-8")
    monkeypatch.setenv("OPENJARVIS_CODEX_MCP_CONFIG", str(profile))

    with pytest.raises(
        EngineConnectionError, match="Could not read the Codex MCP config"
    ):
        _thread_options()


def test_warm_server_checks_account_and_starts_a_fresh_thread_each_time(monkeypatch):
    monkeypatch.delenv("OPENJARVIS_CODEX_MCP_CONFIG", raising=False)
    server = object.__new__(_AppServer)
    server._initialized = False
    results = [
        {},
        {"account": {"type": "chatgpt"}},
        {"config": {}},
        {"thread": {"id": "first"}},
        {"account": {"type": "chatgpt"}},
        {"config": {}},
        {"thread": {"id": "second"}},
    ]
    server._request = Mock(side_effect=results)
    server._write = Mock()

    assert server._thread(".", 0) == "first"
    assert server._thread(".", 0) == "second"
    assert [call.args[0] for call in server._request.call_args_list] == [
        "initialize",
        "account/read",
        "config/read",
        "thread/start",
        "account/read",
        "config/read",
        "thread/start",
    ]
    server._write.assert_called_once_with({"method": "initialized", "params": {}})


def test_unsubscribe_requires_the_finished_threads_closed_event():
    server = object.__new__(_AppServer)
    server._request = Mock(return_value={"status": "unsubscribed"})
    server._receive = Mock(
        side_effect=[
            {"method": "thread/closed", "params": {"threadId": "other"}},
            {"method": "thread/closed", "params": {"threadId": "finished"}},
        ]
    )

    assert server._unload_thread("finished")
    assert server._receive.call_count == 2
    server._receive = Mock(side_effect=EngineConnectionError("timed out"))
    assert not server._unload_thread("finished")


def test_engine_keeps_one_idle_session_and_closes_it_on_expiry(monkeypatch):
    app_server = Mock()
    app_server.complete.return_value = ("Готов.", {})
    app_server.reusable = True
    app_server.lease.return_value = True
    start = Mock(return_value=app_server)
    monkeypatch.setattr(codex_app_server, "_AppServer", start)
    monkeypatch.setattr(codex_app_server, "_find_codex", lambda: "codex")
    engine = CodexAppServerEngine()
    messages = [Message(role=Role.USER, content="Ответь коротко.")]

    for _ in range(2):
        assert engine._complete(messages, MODEL_ID, Event(), Mock()) == ("Готов.", {})

    start.assert_called_once()
    assert app_server.complete.call_count == 2
    app_server.lease.assert_called_once()
    app_server.close.assert_not_called()

    engine._expire_session(engine._idle)
    assert engine._idle is None
    app_server.close.assert_called_once()
