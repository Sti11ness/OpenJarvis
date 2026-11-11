"""MCP profile tests for the Codex App Server engine."""

from __future__ import annotations

import json
from unittest.mock import Mock

import pytest

from openjarvis.engine._base import EngineConnectionError
from openjarvis.engine.codex_app_server import _AppServer


def _thread_options() -> dict:
    server = object.__new__(_AppServer)
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

    assert server._thread(".", 0) == "thread"
    method, options, _deadline = server._request.call_args.args
    assert method == "thread/start"
    assert options["sandbox"] == "read-only"
    assert options["approvalPolicy"] == "never"
    return options


def test_codex_mcp_profile_defaults_to_text(monkeypatch):
    monkeypatch.delenv("OPENJARVIS_CODEX_MCP_CONFIG", raising=False)

    options = _thread_options()

    assert "Do not invoke tools" in options["developerInstructions"]
    assert options["config"]["mcp_servers"] == {
        "playwright": {"enabled": False},
        "other": {"enabled": False},
    }


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
