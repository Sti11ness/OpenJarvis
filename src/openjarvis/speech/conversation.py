"""Hands-free voice state for one local OpenJarvis desktop backend."""

from __future__ import annotations

import logging
from collections import deque
from io import BytesIO
from queue import Empty, Full, Queue
from threading import Event, Lock, Thread
from time import monotonic
from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from openjarvis.speech._conversation_audio import VoiceSession
    from openjarvis.speech._stubs import SpeechBackend

logger = logging.getLogger(__name__)


def idle_state() -> dict[str, Any]:
    return {
        "enabled": False,
        "phase": "off",
        "level": 0.0,
        "utterance": None,
        "started": 0,
        "error": None,
    }


class ConversationVoice:
    """Segment microphone input and transcribe completed turns on a worker."""

    def __init__(
        self,
        backend: SpeechBackend,
        *,
        language: str | None = None,
        lease_seconds: float = 5.0,
    ) -> None:
        self._backend = backend
        self._language = language
        self._lease_seconds = lease_seconds
        self._expires_at = 0.0
        self._lock = Lock()
        self._command_lock = Lock()
        self._closed = Event()
        self._session: VoiceSession | None = None
        self._jobs: Queue[tuple[int, bytes]] = Queue(maxsize=2)
        self._results: deque[dict[str, Any]] = deque(maxlen=4)
        self._sequence = 0
        self._generation = 0
        self._enabled = False
        self._phase = "off"
        self._level = 0.0
        self._started = 0
        self._error: str | None = None
        self._headphones = False
        self._playing = False

    def snapshot(self) -> dict[str, Any]:
        """Return current state and renew the active local UI's lease."""
        with self._lock:
            if self._enabled:
                self._expires_at = monotonic() + self._lease_seconds
            return {
                "enabled": self._enabled,
                "phase": self._phase,
                "level": self._level,
                "utterance": self._results[0].copy() if self._results else None,
                "started": self._started,
                "error": self._error,
            }

    def configure(
        self,
        *,
        enabled: bool | None = None,
        headphones: bool | None = None,
        playing: bool | None = None,
        acknowledge: int | None = None,
    ) -> dict[str, Any]:
        with self._command_lock:
            if self._closed.is_set():
                return self.snapshot()
            with self._lock:
                if headphones is not None:
                    self._headphones = headphones
                if playing is not None:
                    self._playing = playing
                if (
                    acknowledge is not None
                    and self._results
                    and self._results[0]["id"] == acknowledge
                ):
                    self._results.popleft()
                changed = enabled is not None and enabled != self._enabled
            if changed and enabled:
                self._enable()
            elif changed:
                self._disable()
            if self._session is not None:
                self._session.set_playback(
                    self._playing,
                    allow_barge_in=self._headphones,
                )
            return self.snapshot()

    def _enable(self) -> None:
        try:
            if self._session is None:
                from openjarvis.speech._conversation_audio import VoiceSession

                self._session = VoiceSession(
                    self._on_utterance,
                    on_speech_start=self._on_start,
                    on_status=self._on_status,
                    on_error=self._on_error,
                    on_level=self._on_level,
                )
                for target, name in (
                    (self._transcribe, "jarvis-voice-transcribe"),
                    (self._watch_lease, "jarvis-voice-lease"),
                ):
                    Thread(target=target, name=name, daemon=True).start()
            with self._lock:
                self._generation += 1
                self._enabled = True
                self._phase = "starting"
                self._error = None
                self._expires_at = monotonic() + self._lease_seconds
            self._session.set_playback(
                self._playing,
                allow_barge_in=self._headphones,
            )
            self._session.start()
        except ImportError:
            self._on_error("Установите зависимости OpenJarvis для записи звука.")
        except Exception:
            logger.exception("Could not start conversation microphone")
            self._on_error("Не удалось запустить микрофон.")

    def _disable(self) -> None:
        with self._lock:
            self._generation += 1
            self._enabled = False
            self._phase = "off"
            self._level = 0.0
            self._error = None
            self._results.clear()
        if self._session is not None:
            self._session.stop()
        self._discard_audio()

    def _discard_audio(self) -> None:
        while True:
            try:
                self._jobs.get_nowait()
            except Empty:
                return

    def close(self) -> None:
        """Release the microphone even if its frontend has disconnected."""
        with self._command_lock:
            self._closed.set()
            self._disable()

    def _watch_lease(self) -> None:
        while not self._closed.wait(0.25):
            with self._command_lock:
                with self._lock:
                    expired = self._enabled and monotonic() >= self._expires_at
                if expired:
                    self._disable()

    def _on_status(self, phase: str) -> None:
        with self._lock:
            if self._enabled and phase in {"listening", "recording"}:
                self._phase = phase

    def _on_level(self, level: float) -> None:
        with self._lock:
            if self._enabled:
                self._level = level

    def _on_start(self) -> None:
        with self._lock:
            if self._enabled:
                self._started += 1

    def _on_error(self, message: str) -> None:
        with self._lock:
            self._generation += 1
            self._enabled = False
            self._phase = "error"
            self._level = 0.0
            self._error = message
            self._results.clear()
        self._discard_audio()

    def _on_utterance(self, audio: BytesIO) -> None:
        with self._lock:
            if not self._enabled:
                return
            try:
                self._jobs.put_nowait((self._generation, audio.getvalue()))
            except Full:
                self._error = "Распознавание занято. Повторите последнюю фразу."
                return
            self._phase = "transcribing"

    def _transcribe(self) -> None:
        while not self._closed.is_set():
            try:
                generation, audio = self._jobs.get(timeout=0.25)
            except Empty:
                continue
            with self._lock:
                if not self._enabled or generation != self._generation:
                    continue
            text = ""
            error = None
            try:
                transcribe_turn = getattr(self._backend, "transcribe_utterance", None)
                if transcribe_turn is None:
                    result = self._backend.transcribe(
                        audio, format="wav", language=self._language
                    )
                else:
                    result = transcribe_turn(audio, language=self._language)
                text = result.text.strip()
            except Exception:
                logger.exception("Local conversation transcription failed")
                error = "Не удалось распознать фразу."
            with self._lock:
                if not self._enabled or generation != self._generation:
                    continue
                if text:
                    self._sequence += 1
                    self._results.append({"id": self._sequence, "text": text})
                self._error = error
                if self._phase == "transcribing" and self._jobs.empty():
                    self._phase = "listening"
