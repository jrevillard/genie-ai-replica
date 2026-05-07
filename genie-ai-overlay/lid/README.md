# LID — Language Identification Microservice

A standalone CPU-only microservice that detects the language of a text snippet
using a fastText language-identification model.

Intended for evaluation as a replacement / supplement for the `langdetect`-based
detection currently used inside `chatqna` (see
`genie-ai-overlay/chatqna/genieai_chatqna.py`).

## Endpoints

- `GET /health` — liveness probe
- `POST /detect` — body: `{"text": "...", "k": 3}` — returns top-k predicted
  languages with confidence scores

Example:

```bash
curl -X POST http://lid:8000/detect \
  -H "Content-Type: application/json" \
  -d '{"text":"Nanga def?"}'
```

Response:

```json
{
  "input": "Nanga def?",
  "predictions": [
    {"label": "wol_Latn", "score": 0.94},
    {"label": "fra_Latn", "score": 0.02}
  ]
}
```

Labels follow the ISO 639-3 + script convention (e.g., `wol_Latn` = Wolof in
Latin script).

## Model file

The service expects a fastText `.bin` model at `/models/lid.bin` (configurable
via `LID_MODEL_PATH`). The model is **not** baked into the image — it is
mounted from the `lid_models` Docker volume.

To populate the volume on the server:

```bash
docker volume create genie-ai_lid_models
LID_VOL=$(docker volume inspect genie-ai_lid_models -f '{{ .Mountpoint }}')

source <(grep '^HUGGING_FACE_HUB_TOKEN=' .env)
sudo curl -L \
  -H "Authorization: Bearer $HUGGING_FACE_HUB_TOKEN" \
  -o "$LID_VOL/lid.bin" \
  https://huggingface.co/facebook/fasttext-language-identification/resolve/main/model.bin
```

You must accept the model card terms on Hugging Face before the download
will succeed. The token used is the same `HUGGING_FACE_HUB_TOKEN` configured
in the project `.env` (also used by vLLM and TEI).

## License notes

- Service code (`app.py`, Dockerfile) — Apache-2.0
- `facebook/fasttext-language-identification` model — **CC-BY-NC 4.0**
  (non-commercial). For commercial / public-sector deployments, evaluate
  alternatives such as `lid.176.bin` (MIT) or GlotLID (Apache-2.0).

## Configuration

| Env var          | Default          | Description                  |
|------------------|------------------|------------------------------|
| `LID_MODEL_PATH` | `/models/lid.bin`| Path to fastText `.bin` file |
| `LID_DEFAULT_TOPK` | `3`            | Default `k` for predictions  |
| `LOG_LEVEL`      | `INFO`           | Python log level             |
