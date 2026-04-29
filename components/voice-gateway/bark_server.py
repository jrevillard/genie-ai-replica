import io
import tempfile
from fastapi import FastAPI
from pydantic import BaseModel
from fastapi.responses import Response

from TTS.api import TTS

# -------------------------------------------------
# CONFIG
# -------------------------------------------------
MODEL_NAME = "tts_models/multilingual/multi-dataset/bark"
VOICE_DIR = "bark/voices"
SPEAKER = "narrator"   # narrator.npz

# -------------------------------------------------
# LOAD MODEL (ONCE)
# -------------------------------------------------
print("Loading Bark model...")
tts = TTS(model_name=MODEL_NAME, progress_bar=False)
print("Bark model loaded")

# -------------------------------------------------
# FASTAPI APP
# -------------------------------------------------
app = FastAPI(title="Bark TTS Server", version="1.0")


class TTSRequest(BaseModel):
    text: str


@app.post("/v1/tts")
def synthesize(req: TTSRequest):
    if not req.text.strip():
        return {"error": "text is required"}

    with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as f:
        out_path = f.name

    tts.tts_to_file(
        text=req.text,
        file_path=out_path,
        voice_dir=VOICE_DIR,
        speaker_idx=SPEAKER,
    )

    with open(out_path, "rb") as f:
        audio_bytes = f.read()

    return Response(
        content=audio_bytes,
        media_type="audio/wav"
    )