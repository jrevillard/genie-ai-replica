from TTS.api import TTS

tts = TTS(
    model_name="tts_models/multilingual/multi-dataset/bark",
    progress_bar=False
)

tts.tts_to_file(
    text="This is the narrator voice speaking clearly.",
    speaker_wav="bark/voices/narrator/reference.wav",
    file_path="narrator_test.wav"
)

print("✅ narrator_test.wav generated")