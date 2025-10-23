const { logger } = require('../shared-lib');

/**
 * @class TranslationService
 * @description A singleton service for on-the-fly text translation using a self-hosted AI model.
 */
class TranslationService {
  constructor() {
    this.translator = null;
    this.initialized = false;
    // Map application language codes to the NLLB model's specific codes.
    // Full list: https://huggingface.co/facebook/nllb-200-distilled-600M
    this.langCodeMap = {
        en: 'eng_Latn',
        ar: 'ara_Arab',
        th: 'tha_Thai',
        zh: 'zho_Hans',
        de: 'deu_Latn',
        fr: 'fra_Latn',
        id: 'ind_Latn',
        es: 'spa_Latn',
        ru: 'rus_Cyrl',
        pt: 'por_Latn',
        sw: 'swh_Latn', // Kiswahili
    };
    logger.info('TranslationService constructor called');
  }

  /**
   * @method init
   * @description Initializes the service by loading the translation model.
   * This is a long-running, one-time operation on first startup.
   */
  async init() {
    if (this.initialized) {
      logger.debug('TranslationService already initialized, skipping');
      return;
    }
    try {
      logger.info('Starting TranslationService initialization: Loading AI model...');
      
      // Dynamically import the ESM-only transformers.js library
      const { pipeline } = await import('@xenova/transformers');

      // Load the translation pipeline. The model is downloaded on the first run.
      // Caching is handled automatically by the library.
      this.translator = await pipeline('translation', 'Xenova/nllb-200-distilled-600M');
      
      this.initialized = true;
      logger.info('TranslationService initialized successfully. Model is ready.');
    } catch (error) {
      logger.error(`Error initializing TranslationService: ${error.message}`, { stack: error.stack });
      throw error;
    }
  }

  /**
   * @method translate
   * @description Translates a batch of texts from a source language to a target language.
   * @param {string[]} texts - An array of text strings to translate.
   * @param {string} sourceLang - The source language code (e.g., 'en', 'fr').
   * @param {string} targetLang - The target language code (e.g., 'fr', 'de').
   * @returns {Promise<string[]>} A promise that resolves to an array of translated text strings.
   */
  async translate(texts, sourceLang, targetLang) {
    if (!this.initialized || !this.translator) {
      logger.error('TranslationService not initialized. Cannot perform translation.');
      throw new Error('TranslationService is not ready.');
    }

    logger.info(`[TRANSLATION-SERVICE] Starting translation for ${texts.length} texts from ${sourceLang} to ${targetLang}`);

    const sourceLangCode = this.langCodeMap[sourceLang];
    if (!sourceLangCode) {
      logger.warn(`[TRANSLATION-SERVICE] Unsupported source language code provided: ${sourceLang}`);
      throw new Error(`Unsupported source language: ${sourceLang}`);
    }

    const targetLangCode = this.langCodeMap[targetLang];
    if (!targetLangCode) {
      logger.warn(`[TRANSLATION-SERVICE] Unsupported target language code provided: ${targetLang}`);
      throw new Error(`Unsupported target language: ${targetLang}`);
    }

    try {
      const startTime = Date.now();
      const translations = await this.translator(texts, {
        src_lang: sourceLangCode, // Use the provided source language
        tgt_lang: targetLangCode,
      });

      const duration = Date.now() - startTime;
      logger.info(`[TRANSLATION-SERVICE] Translation completed in ${duration}ms.`);

      // The pipeline returns an array of objects, we just need the text.
      const translatedTexts = translations.map(item => item.translation_text);
      return translatedTexts;
    } catch (error) {
      logger.error(`[TRANSLATION-SERVICE] AI model failed to translate: ${error.message}`, { 
        stack: error.stack,
        sourceLang: sourceLang,
        targetLang: targetLang 
      });
      throw new Error('Failed to perform translation.');
    }
  }

  /**
   * @method translateMarkdown
   * @description Translates the content of a markdown file while preserving the markdown structure.
   * @param {string} markdownContent - The markdown content as a string.
   * @param {string} sourceLang - The source language code (e.g., 'en').
   * @param {string} targetLang - The target language code (e.g., 'fr').
   * @returns {Promise<string>} The translated markdown content as a string.
   */
  async translateMarkdown(markdownContent, sourceLang, targetLang) {
    if (!this.initialized || !this.translator) {
      logger.error('TranslationService not initialized. Cannot perform translation.');
      throw new Error('TranslationService is not ready.');
    }

    logger.info(`[TRANSLATION-SERVICE] Starting markdown translation from ${sourceLang} to ${targetLang}`);

    // Parse the markdown into an AST
    const processor = unified()
      .use(remarkParse);

    const tree = processor.parse(markdownContent);

    // Collect all text nodes
    const textNodes = [];
    visit(tree, 'text', (node) => {
      textNodes.push(node);
    });

    // Extract texts
    const texts = textNodes.map(node => node.value);

    // Translate texts
    const translatedTexts = await this.translate(texts, sourceLang, targetLang);

    // Replace original texts with translated ones
    textNodes.forEach((node, index) => {
      node.value = translatedTexts[index];
    });

    // Stringify back to markdown
    const translatedMarkdown = unified()
      .use(remarkStringify)
      .stringify(tree);

    logger.info('[TRANSLATION-SERVICE] Markdown translation completed successfully');

    return translatedMarkdown;
  }
}

// Export singleton instance
module.exports = new TranslationService();