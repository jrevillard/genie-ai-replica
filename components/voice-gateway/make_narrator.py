from TTS.tts.layers.bark.voice_loader import generate_voice

generate_voice(
    audio_paths=["bark/voices/narrator/reference.wav"],
    output_path="bark/voices/narrator/narrator.npz"
)

print("✅ narrator.npz created successfully")