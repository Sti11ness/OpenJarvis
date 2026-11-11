"""Local Silero VAD and microphone capture, adapted from the Windows Jarvis app."""

import wave
from collections import deque
from dataclasses import dataclass
from io import BytesIO
from queue import Empty, Full, Queue
from threading import Event, Lock, Thread, current_thread
from time import monotonic

import av
import numpy as np
import sounddevice
from faster_whisper.vad import get_vad_model

SAMPLE_RATE = 16_000
BLOCK_SAMPLES = 512  # 32 ms, the input window of the bundled Silero model.
BLOCK_BYTES = BLOCK_SAMPLES * 2
PAUSE_BLOCKS = 15  # 480 ms before submitting a phrase.
MAX_PHRASE_BLOCKS = 938  # About 30 seconds, including the pre-roll.


class _StreamingVad:
    """Keep the recurrent state that faster-whisper's batch API starts afresh."""

    def __init__(self):
        self._session = get_vad_model().session
        self.reset()

    def reset(self):
        self._h = np.zeros((1, 1, 128), dtype=np.float32)
        self._c = np.zeros_like(self._h)
        self._context = np.zeros((1, 64), dtype=np.float32)

    def probability(self, samples):
        audio = np.concatenate((self._context, samples.reshape(1, -1)), axis=1)
        score, self._h, self._c = self._session.run(
            None,
            {"input": audio, "h": self._h, "c": self._c},
        )
        self._context = audio[:, -64:]
        return float(score.item())


class _Utterance:
    def __init__(self):
        self._prefix = deque(maxlen=8)
        self.reset()

    def reset(self):
        self._prefix.clear()
        self._blocks = []
        self._onset = 0
        self._voiced = 0
        self._silent = 0
        self._barge = False

    @property
    def recording(self):
        return bool(self._blocks)

    def feed(self, block, probability, *, barge=False):
        """Return a speech-start flag and completed PCM, if either is ready."""
        if not self.recording:
            if self._barge != barge:
                self._onset = 0
                self._barge = barge
            self._prefix.append(block)
            threshold = 0.70 if barge else 0.52
            self._onset = self._onset + 1 if probability >= threshold else 0
            if self._onset < (5 if barge else 3):
                return False, None
            self._blocks = list(self._prefix)
            self._voiced = self._onset
            return True, None

        self._blocks.append(block)
        self._silent = self._silent + 1 if probability < 0.36 else 0
        self._voiced += probability >= 0.52
        if self._silent < PAUSE_BLOCKS and len(self._blocks) < MAX_PHRASE_BLOCKS:
            return False, None

        trim = max(0, self._silent - 4)
        blocks = self._blocks[:-trim] if trim else self._blocks
        audio = b"".join(blocks) if self._voiced >= 4 else b""
        self.reset()
        return False, audio


def _as_wave(pcm):
    output = BytesIO()
    with wave.open(output, "wb") as audio:
        audio.setparams((1, 2, SAMPLE_RATE, 0, "NONE", "not compressed"))
        audio.writeframes(pcm)
    output.seek(0)
    return output


class _Resampler:
    def __init__(self, rate):
        self.rate = rate
        self.reset()

    def reset(self):
        self._resampler = av.AudioResampler(
            format="s16", layout="mono", rate=SAMPLE_RATE
        )

    def convert(self, pcm):
        if self.rate == SAMPLE_RATE:
            return pcm
        samples = np.frombuffer(pcm, dtype=np.int16).reshape(1, -1)
        frame = av.AudioFrame.from_ndarray(samples, format="s16", layout="mono")
        frame.sample_rate = self.rate
        return b"".join(
            out.to_ndarray().tobytes() for out in self._resampler.resample(frame)
        )


@dataclass(frozen=True, slots=True)
class _Playback:
    active: bool = False
    barge: bool = False
    resume_after: float = 0.0


class VoiceSession:
    """Manage one microphone stream. Callbacks run on its worker thread."""

    def __init__(
        self,
        on_utterance,
        *,
        on_speech_start=lambda: None,
        on_status=lambda state: None,
        on_error=lambda message: None,
        on_level=lambda level: None,
    ):
        self._on_utterance = on_utterance
        self._on_speech_start = on_speech_start
        self._on_status = on_status
        self._on_error = on_error
        self._on_level = on_level
        self._lock = Lock()
        self._thread = None
        self._stop = Event()
        self._playback = _Playback()

    @property
    def running(self):
        return (
            self._thread is not None
            and self._thread.is_alive()
            and not self._stop.is_set()
        )

    def start(self):
        """Start listening in the background using the current Windows default input."""
        with self._lock:
            if self.running:
                return
            previous = self._thread
            self._stop = Event()
            self._thread = Thread(
                target=self._run,
                args=(self._stop, previous),
                name="jarvis-microphone",
                daemon=True,
            )
            self._thread.start()

    def stop(self):
        """Release the input stream and discard any incomplete phrase."""
        with self._lock:
            thread = self._thread
            self._stop.set()
        if thread is not None and thread is not current_thread():
            thread.join(timeout=0.5)

    def set_playback(self, active, *, allow_barge_in=False):
        """Gate speaker echo, or continue listening in headphone mode."""
        with self._lock:
            previous = self._playback
            resume_after = previous.resume_after
            if (
                previous.active
                and not previous.barge
                and (not active or allow_barge_in)
            ):
                resume_after = monotonic() + 0.22
            self._playback = _Playback(active, active and allow_barge_in, resume_after)

    def _run(self, stop, previous):
        # A rapid off/on waits for the previous PortAudio stream to release its device.
        while previous is not None and previous.is_alive() and not stop.is_set():
            previous.join(timeout=0.1)
        if stop.is_set():
            return
        pending = Queue(maxsize=32)
        discontinuity = Event()

        def capture(data, _count, _time, status):
            if stop.is_set():
                return
            if status.input_overflow:
                discontinuity.set()
            try:
                pending.put_nowait((bytes(data), monotonic()))
            except Full:
                discontinuity.set()

        try:
            vad = _StreamingVad()
            if stop.is_set():
                return
            rate = int(sounddevice.query_devices(kind="input")["default_samplerate"])
            with sounddevice.RawInputStream(
                samplerate=rate,
                channels=1,
                dtype="int16",
                latency="low",
                blocksize=round(rate * BLOCK_SAMPLES / SAMPLE_RATE),
                callback=capture,
            ) as stream:
                if not stop.is_set():
                    self._on_status("listening")
                    self._listen(stop, stream, pending, discontinuity, vad, rate)
        except sounddevice.PortAudioError as error:
            if not stop.is_set():
                self._on_error(
                    f"Не удалось открыть или прочитать микрофон Windows. {error}"
                )
        except Exception as error:
            if not stop.is_set():
                self._on_error(f"Ошибка голосового режима. {error}")
        finally:
            stop.set()
            self._on_level(0.0)
            self._on_status("off")

    def _listen(self, stop, stream, pending, discontinuity, vad, rate):
        utterance = _Utterance()
        resampler = _Resampler(rate)
        buffer = bytearray()
        gated = False
        last_level = 0.0
        while not stop.is_set():
            try:
                pcm, captured_at = pending.get(timeout=0.07)
            except Empty:
                if not stream.active and not stop.is_set():
                    raise RuntimeError("Поток микрофона остановился.")
                continue

            playback = self._playback
            blocked = (
                playback.active and not playback.barge
            ) or captured_at < playback.resume_after
            lost_input = discontinuity.is_set()
            if lost_input or (blocked and not gated):
                discontinuity.clear()
                if utterance.recording and not stop.is_set():
                    self._on_status("listening")
                if blocked and not stop.is_set():
                    self._on_level(0.0)
                utterance.reset()
                resampler.reset()
                vad.reset()
                buffer.clear()
            gated = blocked
            if lost_input:
                while not pending.empty():
                    pending.get_nowait()
            if gated or lost_input:
                continue

            buffer.extend(resampler.convert(pcm))
            while len(buffer) >= BLOCK_BYTES and not stop.is_set():
                block = bytes(buffer[:BLOCK_BYTES])
                del buffer[:BLOCK_BYTES]
                samples = (
                    np.frombuffer(block, dtype=np.int16).astype(np.float32) / 32768
                )
                now = monotonic()
                if now - last_level >= 0.08:
                    self._on_level(min(1.0, float(np.sqrt(np.mean(samples**2))) * 8))
                    last_level = now
                started, audio = utterance.feed(
                    block, vad.probability(samples), barge=playback.barge
                )
                if started and not stop.is_set():
                    self._on_status("recording")
                    self._on_speech_start()
                if audio is not None and not stop.is_set():
                    self._on_status("listening")
                    if audio and not stop.is_set():
                        self._on_utterance(_as_wave(audio))
