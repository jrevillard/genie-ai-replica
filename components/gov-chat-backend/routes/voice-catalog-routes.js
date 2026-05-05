const express = require('express');
const axios = require('axios');
const authMiddleware = require('../middleware/auth-middleware');
const { logger } = require('../shared-lib');

const TTS_PIPER_URL = process.env.TTS_PIPER_URL || 'http://tts-piper:9200';

/** Wrap a 16-bit PCM buffer in a RIFF/WAVE header so it plays in any browser. */
function wrapPcmInWav(pcm, sampleRate, channels, bitsPerSample) {
  const byteRate = (sampleRate * channels * bitsPerSample) / 8;
  const blockAlign = (channels * bitsPerSample) / 8;
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);                    // PCM format
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bitsPerSample, 34);
  header.write('data', 36);
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

/**
 * Voice catalog: list available TTS voices and preview them.
 *
 * Read-only endpoints — voices are seeded by VoiceCatalogService at startup.
 */
module.exports = (voiceCatalogService) => {
  if (!voiceCatalogService) {
    throw new Error('voiceCatalogService is required');
  }
  const router = express.Router();
  router.use(authMiddleware.authenticate);

  /**
   * @swagger
   * /voices:
   *   get:
   *     summary: List all available TTS voices
   *     tags: [Voices]
   *     security: [ { bearerAuth: [] } ]
   *     responses:
   *       200:
   *         description: Array of voice rows (sorted by language, gender, name)
   *         content:
   *           application/json:
   *             schema:
   *               type: array
   *               items:
   *                 type: object
   *                 properties:
   *                   _key: { type: string }
   *                   name: { type: string }
   *                   language: { type: string, enum: [en, fr, es, sw] }
   *                   gender: { type: string, enum: [female, male] }
   *                   modelVoiceId: { type: string, description: "Piper voice id (e.g. en_US-ryan-high)" }
   *                   enabled: { type: boolean }
   */
  router.get('/', async (req, res) => {
    try {
      const rows = await voiceCatalogService.listVoices();
      res.json(rows);
    } catch (error) {
      logger.error(`voices list: ${error.message}`, { stack: error.stack });
      res.status(500).json({ message: error.message });
    }
  });

  /**
   * @swagger
   * /voices/{voiceId}/preview:
   *   post:
   *     summary: Synthesize a short text sample with this voice and stream the audio
   *     tags: [Voices]
   *     security: [ { bearerAuth: [] } ]
   *     parameters:
   *       - in: path
   *         name: voiceId
   *         required: true
   *         schema: { type: string }
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required: [text]
   *             properties:
   *               text: { type: string, maxLength: 1000 }
   *     responses:
   *       200:
   *         description: WAV audio stream
   *         content:
   *           audio/wav: {}
   *       400: { description: text required / too long }
   *       404: { description: Voice not found }
   *       502: { description: TTS service error }
   */
  router.post('/:voiceId/preview', async (req, res) => {
    try {
      const { voiceId } = req.params;
      const text = typeof req.body?.text === 'string' ? req.body.text.trim() : '';
      if (!text) return res.status(400).json({ message: 'text is required' });
      if (text.length > 1000) return res.status(400).json({ message: 'text must be at most 1000 characters' });

      const voice = await voiceCatalogService.getVoice(voiceId);
      if (!voice) return res.status(404).json({ message: 'Voice not found' });

      // Forward to tts-piper. Piper streams headerless 16-bit PCM, so we
      // buffer it and prepend a WAV header so browsers can play it directly.
      const upstream = await axios.post(
        `${TTS_PIPER_URL}/v1/microservice/tts`,
        { text, language: voice.language, voice: voice.modelVoiceId },
        { responseType: 'arraybuffer', timeout: 60000 }
      );

      const sampleRate = parseInt(upstream.headers['x-sample-rate'], 10) || 22050;
      const pcm = Buffer.from(upstream.data);
      const wav = wrapPcmInWav(pcm, sampleRate, 1, 16);
      res.setHeader('Content-Type', 'audio/wav');
      res.setHeader('X-Sample-Rate', String(sampleRate));
      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('Content-Length', String(wav.length));
      res.send(wav);
    } catch (error) {
      const status = error.response?.status || 502;
      logger.error(`voice preview failed: ${error.message}`, { stack: error.stack });
      if (!res.headersSent) {
        res.status(status).json({ message: 'TTS preview failed', detail: error.message });
      }
    }
  });

  return router;
};
