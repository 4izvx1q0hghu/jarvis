"""Hands-free voice: wake word → listen → think → speak → follow-up.

  Wake word   openWakeWord (free, offline). "hey_jarvis" ships with it; for
              "Hey Danya", train a custom model (see README) and point
              JARVIS_WAKE_WORD at its .onnx file.
  Listening   your microphone at 16 kHz; an utterance ends after ~0.8 s of quiet.
  Speech→text faster-whisper (offline; "base.en" by default, JARVIS_WHISPER to change).
  Text→speech edge-tts neural voices (natural, needs internet), falling back to
              pyttsx3 (offline, robotic) if edge-tts or playback is unavailable.
  Interrupt   say the wake word while JARVIS is talking and it stops.
  Follow-up   after a reply it listens for 6 s without needing the wake word.
  Mute        type m + Enter in this window, or use the dashboard's Mute button
              (both flip the same switch). While muted, nothing is listened to.

Install the extras first:  pip install -r requirements-voice.txt
"""

from __future__ import annotations

import asyncio
import os
import queue
import sys
import tempfile
import threading
import time

from .agent import Session
from .runtime import Runtime

RATE = 16000
FRAME = 1280  # 80 ms, what openWakeWord expects
SILENCE_RMS = 450  # raise if your room is noisy, lower for a quiet mic
END_SILENCE_S = 0.8
MAX_UTTERANCE_S = 15
FOLLOW_UP_S = 6


def _need(module: str, pip_name: str):
    try:
        return __import__(module)
    except ImportError:
        sys.exit(f"Voice needs '{pip_name}'. Run: pip install -r requirements-voice.txt")


class Speaker:
    """Speaks a reply; `stop()` cuts it off (for barge-in)."""

    def __init__(self, voice: str):
        self.voice = voice
        self._stop = threading.Event()
        self.speaking = False
        try:
            import edge_tts  # noqa: F401
            import miniaudio  # noqa: F401

            self.mode = "edge"
        except ImportError:
            self.mode = "pyttsx3"

    def stop(self) -> None:
        self._stop.set()

    def say(self, text: str) -> None:
        self._stop.clear()
        self.speaking = True
        try:
            if self.mode == "edge":
                try:
                    self._edge(text)
                    return
                except Exception as exc:  # offline, or no audio device
                    print(f"[voice] neural voice failed ({exc}); using the offline voice")
                    self.mode = "pyttsx3"
            self._offline(text)
        finally:
            self.speaking = False

    def _edge(self, text: str) -> None:
        import edge_tts
        import miniaudio

        path = os.path.join(tempfile.gettempdir(), "jarvis_reply.mp3")
        asyncio.run(edge_tts.Communicate(text, self.voice).save(path))
        info = miniaudio.get_file_info(path)
        stream = miniaudio.stream_file(path)
        with miniaudio.PlaybackDevice() as device:
            device.start(stream)
            end = time.time() + info.duration + 0.2
            while time.time() < end and not self._stop.is_set():
                time.sleep(0.05)

    def _offline(self, text: str) -> None:
        import pyttsx3

        engine = pyttsx3.init()
        engine.say(text)
        engine.runAndWait()


class VoiceLoop:
    def __init__(self, runtime: Runtime):
        self.rt = runtime
        np = _need("numpy", "numpy")
        sd = _need("sounddevice", "sounddevice")
        _need("openwakeword", "openwakeword")
        from faster_whisper import WhisperModel
        from openwakeword.model import Model

        self.np, self.sd = np, sd
        wake = runtime.settings.wake_word
        try:
            self.wake = Model(wakeword_models=[wake], inference_framework="onnx")
        except Exception:
            import openwakeword.utils

            print("[voice] downloading wake-word models (first run only)…")
            openwakeword.utils.download_models()
            self.wake = Model(wakeword_models=[wake], inference_framework="onnx")
        print("[voice] loading speech recognition…")
        self.whisper = WhisperModel(os.environ.get("JARVIS_WHISPER", "base.en"), device="cpu", compute_type="int8")
        self.speaker = Speaker(runtime.settings.voice_name)
        self.agent = runtime.agent(notify=self._notify)
        self.session = Session()
        self.frames: queue.Queue = queue.Queue()
        self.running = True

    def _notify(self, message: str) -> None:
        print(f"[jarvis] {message}")
        self.speaker.say(message)

    # -- audio --------------------------------------------------------------

    def _callback(self, indata, frames, time_info, status) -> None:
        self.frames.put(indata[:, 0].copy())

    def _rms(self, frame) -> float:
        return float(self.np.sqrt(self.np.mean(frame.astype(self.np.float32) ** 2)))

    def _wake_heard(self, frame) -> bool:
        scores = self.wake.predict(frame)
        return max(scores.values(), default=0) > 0.5

    def _record(self, first_frame=None, wait_for_speech_s: float = 0) -> str:
        """Record until a pause; return the transcript ('' if nothing said)."""
        np = self.np
        chunks = [first_frame] if first_frame is not None else []
        started = first_frame is not None
        quiet = 0.0
        deadline = time.time() + (wait_for_speech_s or MAX_UTTERANCE_S)
        while time.time() < deadline:
            frame = self.frames.get()
            loud = self._rms(frame) > SILENCE_RMS
            if not started:
                if loud:
                    started, deadline = True, time.time() + MAX_UTTERANCE_S
                else:
                    continue
            chunks.append(frame)
            quiet = 0.0 if loud else quiet + FRAME / RATE
            if quiet >= END_SILENCE_S:
                break
        if not chunks:
            return ""
        audio = np.concatenate(chunks).astype(np.float32) / 32768.0
        segments, _ = self.whisper.transcribe(audio, language="en", vad_filter=True)
        return " ".join(s.text for s in segments).strip()

    # -- conversation -----------------------------------------------------

    def _answer(self, text: str) -> None:
        print(f"you: {text}")
        reply = self.agent.run(self.session, text)
        print(f"danya: {reply}")
        # Speak in the background and keep listening, so the wake word can
        # interrupt.
        speaking = threading.Thread(target=self.speaker.say, args=(reply,), daemon=True)
        speaking.start()
        while speaking.is_alive():
            try:
                frame = self.frames.get(timeout=0.1)
            except queue.Empty:
                continue
            if self._wake_heard(frame):
                self.speaker.stop()
                print("[voice] interrupted")
                break
        speaking.join(timeout=2)
        while not self.frames.empty():  # drop audio of our own voice
            self.frames.get_nowait()

    def _console(self) -> None:
        print("Type m + Enter to mute/unmute, q + Enter to quit, or type a message.")
        for line in sys.stdin:
            cmd = line.strip()
            if cmd.lower() == "q":
                self.running = False
                break
            if cmd.lower() == "m":
                self.rt.set_muted(not self.rt.muted)
                print("[voice] muted" if self.rt.muted else "[voice] listening")
            elif cmd:
                self._answer(cmd)

    def run(self) -> None:
        threading.Thread(target=self._console, daemon=True).start()
        say = self.rt.settings.wake_word.replace("_", " ")
        print(f"[voice] ready — say '{say}'. Brain: {getattr(self.rt.llm, 'name', '?')}")
        with self.sd.InputStream(samplerate=RATE, channels=1, dtype="int16", blocksize=FRAME, callback=self._callback):
            while self.running:
                for r in self.rt.due_reminders():
                    self._notify(f"Reminder: {r['text']}")
                try:
                    frame = self.frames.get(timeout=0.5)
                except queue.Empty:
                    continue
                if self.rt.muted:
                    continue  # muted: audio is discarded, never analysed
                if not self._wake_heard(frame):
                    continue
                print("[voice] yes?")
                self.wake.reset()
                text = self._record(wait_for_speech_s=5)
                while text and self.running:
                    self._answer(text)
                    if self.rt.muted:
                        break
                    text = self._record(wait_for_speech_s=FOLLOW_UP_S)  # follow-up, no wake word


def run_voice(runtime: Runtime | None = None) -> None:
    VoiceLoop(runtime or Runtime()).run()
