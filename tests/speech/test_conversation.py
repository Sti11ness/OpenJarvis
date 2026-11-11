"""Hands-free API checks with no physical microphone access."""

import sys
from io import BytesIO
from threading import Event
from time import monotonic, sleep
from types import SimpleNamespace

import pytest

from openjarvis.speech.conversation import ConversationVoice


class FakeSession:
    last = None

    def __init__(self, on_utterance, **callbacks):
        self.on_utterance = on_utterance
        self.callbacks = callbacks
        self.stopped = Event()
        self.playback = None
        FakeSession.last = self

    def start(self):
        self.callbacks["on_status"]("listening")

    def stop(self):
        self.stopped.set()

    def set_playback(self, active, *, allow_barge_in=False):
        self.playback = (active, allow_barge_in)


@pytest.fixture(autouse=True)
def fake_capture(monkeypatch):
    FakeSession.last = None
    monkeypatch.setitem(
        sys.modules,
        "openjarvis.speech._conversation_audio",
        SimpleNamespace(VoiceSession=FakeSession),
    )


def test_local_voice_result_acknowledgement():
    fastapi = pytest.importorskip("fastapi")
    from fastapi.testclient import TestClient

    from openjarvis.server.api_routes import speech_router

    captured = []

    def transcribe(audio, *, format, language):
        captured.append((audio, format, language))
        return SimpleNamespace(text="  Доброе утро  ")

    app = fastapi.FastAPI()
    app.state.speech_backend = SimpleNamespace(
        backend_id="faster-whisper",
        transcribe=transcribe,
    )
    app.state.config = SimpleNamespace(speech=SimpleNamespace(language="ru"))
    app.include_router(speech_router)
    endpoint = "/v1/speech/conversation"
    with TestClient(
        app,
        base_url="http://127.0.0.1",
        client=("127.0.0.1", 40000),
    ) as client:
        assert client.get(endpoint).json()["phase"] == "off"
        assert FakeSession.last is None
        forbidden = client.post(
            endpoint,
            json={"enabled": True},
            headers={"Origin": "https://example.com"},
        )
        assert forbidden.status_code == 403
        assert FakeSession.last is None
        response = client.post(
            endpoint,
            json={"enabled": True, "headphones": True, "playing": True},
            headers={"Origin": "http://tauri.localhost"},
        )
        assert response.status_code == 200
        capture = FakeSession.last
        try:
            assert capture.playback == (True, True)
            capture.callbacks["on_speech_start"]()
            capture.on_utterance(BytesIO(b"test wave"))
            end = monotonic() + 1
            while monotonic() < end:
                state = client.get(endpoint).json()
                if state["utterance"] is not None:
                    break
                sleep(0.01)
            assert state["started"] == 1
            assert state["utterance"] == {"id": 1, "text": "Доброе утро"}
            assert captured == [(b"test wave", "wav", "ru")]
            assert client.get(endpoint).json()["utterance"] == state["utterance"]
            assert (
                client.post(endpoint, json={"acknowledge": 1}).json()["utterance"]
                is None
            )
            assert (
                client.post(endpoint, json={"enabled": False}).json()["phase"] == "off"
            )
            assert capture.stopped.is_set()
        finally:
            app.state.conversation_voice.close()


def test_expired_ui_lease_releases_microphone():
    voice = ConversationVoice(SimpleNamespace(), lease_seconds=0.05)
    try:
        assert voice.configure(enabled=True)["enabled"]
        assert FakeSession.last.stopped.wait(timeout=1.0)
        assert not voice.snapshot()["enabled"]
    finally:
        voice.close()
