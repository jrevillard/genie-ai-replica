## Piper TTS Setup Guide

### Step 1: Create model directory
```powershell
cd D:\GenAI\amina\genie-ai-replica\components\voice-gateway
mkdir -p infra\piper\models
```

### Step 2: Download Piper voice model (~65MB)
```powershell
# Download the ONNX model
Invoke-WebRequest -Uri "https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_US/lessac/medium/en_US-lessac-medium.onnx" -OutFile ".\infra\piper\models\en_US-lessac-medium.onnx"

# Download the config JSON
Invoke-WebRequest -Uri "https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_US/lessac/medium/en_US-lessac-medium.onnx.json" -OutFile ".\infra\piper\models\en_US-lessac-medium.onnx.json"
```

### Step 3: Add piper-tts to requirements.txt
Add this line to your `requirements.txt` (or wherever pip packages are listed):
```
piper-tts>=1.2.0
```

If you use a Dockerfile with pip install, add:
```dockerfile
RUN pip install piper-tts>=1.2.0
```

### Step 4: Copy files
- `tts_piper.py` → `components/voice-gateway/app/services/tts_piper.py`
- `tts.py` → `components/voice-gateway/app/api/tts.py` (replaces existing)
- `docker-compose.voice.yml` → `components/voice-gateway/docker-compose.voice.yml`

### Step 5: Fix startup script
Your gateway entrypoint waits for `voice-tts` (Coqui). Since Piper runs
inside the gateway, remove or comment out the Coqui wait check.

Look for something like this in your entrypoint.sh or startup script:
```bash
# Comment out or remove these lines:
# echo "Waiting for Docker DNS (voice-tts)..."
# echo "Waiting for voice-tts HTTP..."
```

### Step 6: Rebuild and start
```powershell
cd D:\GenAI\amina\genie-ai-replica\components\voice-gateway
docker compose -f docker-compose.voice.yml down
docker compose -f docker-compose.voice.yml up --build -d
docker logs voice-gateway --tail 20
```

### Step 7: Verify
```powershell
# Test TTS endpoint
Invoke-WebRequest -Method POST -Uri "http://127.0.0.1:8010/v1/tts" -ContentType "application/json" -Body '{"text":"Hello, I am Amina."}' -OutFile test.wav
# Play test.wav to verify audio
```

### Switching back to Coqui
1. In `tts.py`: uncomment the Coqui block, comment Piper block
2. In `docker-compose.voice.yml`: uncomment `voice-tts` service
3. Rebuild
