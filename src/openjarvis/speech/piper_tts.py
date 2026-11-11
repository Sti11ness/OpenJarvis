"""Optional local Piper synthesis for an existing ONNX voice."""

from __future__ import annotations

import os
import wave
from io import BytesIO
from pathlib import Path
from threading import Lock
from typing import TYPE_CHECKING

from openjarvis.core.registry import TTSRegistry
from openjarvis.speech.tts import TTSBackend, TTSResult

if TYPE_CHECKING:
    from piper import PiperVoice


@TTSRegistry.register("piper")
class PiperTTSBackend(TTSBackend):
    """Use a locally configured voice without downloading assets."""

    backend_id = "piper"

    def __init__(self) -> None:
        configured_path = os.environ.get("OPENJARVIS_PIPER_MODEL")
        self._path = Path(configured_path).expanduser() if configured_path else None
        self._voice: PiperVoice | None = None
        self._lock = Lock()

    def health(self) -> bool:
        try:
            from piper import PiperVoice  # noqa: F401
        except ImportError:
            return False
        return bool(
            self._path
            and self._path.is_file()
            and self._path.with_suffix(".onnx.json").is_file()
        )

    def available_voices(self) -> list[str]:
        return [self._path.stem] if self._path else []

    def synthesize(
        self,
        text: str,
        *,
        voice_id: str = "",
        speed: float = 1.0,
        output_format: str = "wav",
    ) -> TTSResult:
        from piper import PiperVoice, SynthesisConfig

        if not 0.25 <= speed <= 4.0:
            raise ValueError("Piper speed must be between 0.25 and 4")
        if self._path is None:
            raise RuntimeError("Set OPENJARVIS_PIPER_MODEL to a local ONNX voice")

        output = BytesIO()
        with self._lock:
            if self._voice is None:
                self._voice = PiperVoice.load(self._path)
            with wave.open(output, "wb") as audio:
                self._voice.synthesize_wav(
                    text,
                    audio,
                    syn_config=SynthesisConfig(length_scale=1 / speed),
                )
                sample_rate = audio.getframerate()
                duration = audio.getnframes() / sample_rate
        return TTSResult(
            audio=output.getvalue(),
            format="wav",
            duration_seconds=duration,
            voice_id=self._path.stem,
            sample_rate=sample_rate,
        )
