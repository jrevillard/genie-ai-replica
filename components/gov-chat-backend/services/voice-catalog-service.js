const { logger, dbService, ensureCollection } = require('../shared-lib');

const COLLECTION = 'voices';

/**
 * Catalog of TTS voices available to AI twins. One row per Piper model voice id.
 * Seeded on init from the env-defined defaults so the deploy stays in sync with
 * what tts-piper actually has on disk.
 */
const SEED = [
  { name: 'Lessac (Female, English)',  language: 'en', gender: 'female', modelVoiceId: 'en_US-lessac-high' },
  { name: 'Ryan (Male, English)',      language: 'en', gender: 'male',   modelVoiceId: 'en_US-ryan-high' },
  { name: 'LibriTTS (Default English)', language: 'en', gender: 'female', modelVoiceId: 'en_US-libritts_r-medium' },
  { name: 'Siwis (Female, French)',    language: 'fr', gender: 'female', modelVoiceId: 'fr_FR-siwis-medium' },
  { name: 'Tom (Male, French)',        language: 'fr', gender: 'male',   modelVoiceId: 'fr_FR-tom-medium' },
  { name: 'Sharvard (Female, Spanish)', language: 'es', gender: 'female', modelVoiceId: 'es_ES-sharvard-medium' },
  { name: 'Claude (Male, Spanish)',    language: 'es', gender: 'male',   modelVoiceId: 'es_MX-claude-high' },
  { name: 'Lanfrica (Swahili)',        language: 'sw', gender: 'female', modelVoiceId: 'sw_CD-lanfrica-medium' },
];

/** Default voice for new AI twins. Must exist in SEED. */
const DEFAULT_MODEL_VOICE_ID = 'en_US-ryan-high';

class VoiceCatalogService {
  constructor() {
    this.db = null;
    this.collection = null;
    this.initialized = false;
    /** _key of the default voice (en male). Set during init. */
    this.defaultVoiceKey = null;
  }

  async init() {
    if (this.initialized) return;
    this.db = await dbService.getConnection('default');
    await ensureCollection(this.db, COLLECTION);
    this.collection = this.db.collection(COLLECTION);
    await this._seed();
    await this._resolveDefaultVoiceKey();
    this.initialized = true;
    logger.info(`VoiceCatalogService initialized (defaultVoiceKey=${this.defaultVoiceKey})`);
  }

  async _seed() {
    for (const v of SEED) {
      const existing = await this._findByModelVoiceId(v.modelVoiceId);
      if (existing) continue;
      const now = new Date().toISOString();
      await this.collection.save({
        ...v,
        enabled: true,
        createdAt: now,
        updatedAt: now,
      });
      logger.info(`VoiceCatalog seeded: ${v.modelVoiceId}`);
    }
  }

  async _findByModelVoiceId(modelVoiceId) {
    const cursor = await this.db.query(
      'FOR v IN @@coll FILTER v.modelVoiceId == @id LIMIT 1 RETURN v',
      { '@coll': COLLECTION, id: modelVoiceId }
    );
    return cursor.next();
  }

  async _resolveDefaultVoiceKey() {
    const row = await this._findByModelVoiceId(DEFAULT_MODEL_VOICE_ID);
    this.defaultVoiceKey = row ? row._key : null;
  }

  /** List all voices (sorted by language, then gender, then name). */
  async listVoices() {
    const cursor = await this.db.query(
      'FOR v IN @@coll SORT v.language ASC, v.gender ASC, v.name ASC RETURN v',
      { '@coll': COLLECTION }
    );
    return cursor.all();
  }

  /** Look up a voice by _key. Returns null when not found. */
  async getVoice(key) {
    if (!key) return null;
    try {
      return await this.collection.document(key);
    } catch (e) {
      if (e && e.errorNum === 1202) return null;
      throw e;
    }
  }

  /** Default voice _key (en male). May be null if seed never ran. */
  getDefaultVoiceKey() {
    return this.defaultVoiceKey;
  }
}

module.exports = new VoiceCatalogService();
