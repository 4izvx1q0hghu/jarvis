"""Sight: an image file, the camera, or the screen — each only when allowed.

The camera and screen tools refuse unless JARVIS_CAMERA / JARVIS_SCREEN are
switched on, and say so plainly. JARVIS never describes what it "sees"
without one of these tools having actually returned an image.
"""

from __future__ import annotations

import io
import mimetypes

from .files import safe_path
from .registry import Context, S, tool


def _ask_vision(ctx: Context, data: bytes, mime: str, question: str) -> str:
    if not hasattr(ctx.llm, "vision"):
        return "Vision needs a Gemini key (GEMINI_API_KEY) in this version."
    return ctx.llm.vision(data, mime, question or "Describe what you see, and read any text.")


@tool(
    "look_at_image",
    "Look at an image file: describe it, recognise objects, or read the text in it.",
    {"path": S("Image file path in an allowed folder"), "question": S("What to find out (optional)")},
    ["path"],
)
def look_at_image(ctx: Context, path: str, question: str = "") -> str:
    file = safe_path(ctx, path)
    mime = mimetypes.guess_type(file.name)[0] or "image/jpeg"
    return _ask_vision(ctx, file.read_bytes(), mime, question)


@tool(
    "look_through_camera",
    "Take one photo with the computer's camera and answer a question about it. Only works when the camera is enabled.",
    {"question": S("What to look for")},
)
def look_through_camera(ctx: Context, question: str = "") -> str:
    if not ctx.settings.camera_enabled:
        return "The camera is switched off (set JARVIS_CAMERA=1 to allow it). I can't see anything right now."
    import cv2  # optional: pip install opencv-python

    cam = cv2.VideoCapture(0)
    try:
        ok, frame = cam.read()
    finally:
        cam.release()
    if not ok:
        return "I couldn't get a picture from the camera."
    ok, jpg = cv2.imencode(".jpg", frame)
    return _ask_vision(ctx, jpg.tobytes(), "image/jpeg", question)


@tool(
    "look_at_screen",
    "Take a screenshot and explain what is on the screen. Only works when screen access is enabled.",
    {"question": S("What to explain (optional)")},
)
def look_at_screen(ctx: Context, question: str = "") -> str:
    if not ctx.settings.screen_enabled:
        return "Screen access is switched off (set JARVIS_SCREEN=1 to allow it). I can't see your screen right now."
    import mss  # optional: pip install mss pillow
    from PIL import Image

    with mss.mss() as grab:
        shot = grab.grab(grab.monitors[1])
        image = Image.frombytes("RGB", shot.size, shot.rgb)
    image.thumbnail((1600, 1600))
    buf = io.BytesIO()
    image.save(buf, format="JPEG", quality=80)
    return _ask_vision(ctx, buf.getvalue(), "image/jpeg", question or "Explain what is happening on this screen.")
