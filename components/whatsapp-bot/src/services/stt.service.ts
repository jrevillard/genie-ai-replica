import { request } from "undici";
import { getConfig } from "../config.js";
import { logger } from "../logger.js";
import type { SttResponse } from "../types/common.types.js";

export async function transcribeAudio(audioBuffer: Buffer, mimeType: string): Promise<SttResponse> {
  const cfg = getConfig();
  if (!cfg.STT_SERVICE_URL) {
    throw new Error("STT_SERVICE_URL is not configured");
  }

  const url = `${cfg.STT_SERVICE_URL}/stt`;
  const { statusCode, body } = await request(url, {
    method: "POST",
    headers: { "Content-Type": mimeType },
    body: audioBuffer,
    headersTimeout: cfg.STT_TIMEOUT_MS,
    bodyTimeout: cfg.STT_TIMEOUT_MS,
  });

  if (statusCode >= 400) {
    const errText = await body.text();
    logger.error({ statusCode, error: errText }, "STT service error");
    throw new Error(`STT service error: ${statusCode}`);
  }

  return (await body.json()) as SttResponse;
}

export async function synthesizeSpeech(text: string, language = "en"): Promise<Buffer> {
  const cfg = getConfig();
  if (!cfg.STT_SERVICE_URL) {
    throw new Error("STT_SERVICE_URL is not configured");
  }

  const url = `${cfg.STT_SERVICE_URL}/tts`;
  const { statusCode, body } = await request(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text, language, voice: "default" }),
    headersTimeout: cfg.STT_TIMEOUT_MS,
    bodyTimeout: cfg.STT_TIMEOUT_MS,
  });

  if (statusCode >= 400) {
    const errText = await body.text();
    logger.error({ statusCode, error: errText }, "TTS service error");
    throw new Error(`TTS service error: ${statusCode}`);
  }

  const chunks: Uint8Array[] = [];
  for await (const chunk of body) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}
