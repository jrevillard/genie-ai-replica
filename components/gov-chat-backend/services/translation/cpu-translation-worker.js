const { parentPort, workerData } = require('worker_threads');
const { logger } = require('../../shared-lib');

/**
 * CPU Translation Worker
 *
 * Runs in a separate worker thread to avoid blocking the main thread.
 * Handles all CPU-intensive translation operations.
 */

let translator = null;
let workerInitialized = false;

/**
 * Initialize the worker (load model)
 */
async function initWorker() {
  if (workerInitialized) {
    return { success: true };
  }

  try {
    const { modelId, threads } = workerData;

    logger.info('[CPU-WORKER] Initializing worker thread...');
    logger.info(`[CPU-WORKER] Model: ${modelId}, Threads: ${threads}`);

    // Import ONNX runtime first
    const ort = await import('onnxruntime-web');
    ort.env.logLevel = 'fatal';
    ort.env.debug = false;
    logger.debug('[CPU-WORKER] Set ONNX global log level to fatal');

    // Dynamically import the ESM-only transformers.js library
    const { pipeline } = await import('@xenova/transformers');
    logger.debug('[CPU-WORKER] Loaded transformers.js pipeline');

    // Load the quantized translation pipeline
    translator = await pipeline('translation', modelId, {
      quantized: true,
      session_options: {
        executionMode: 'parallel',
        intraOpNumThreads: threads,
        interOpNumThreads: 1,
        graphOptimizationLevel: 'all',
        logSeverityLevel: 4,
      }
    });

    workerInitialized = true;
    logger.info('[CPU-WORKER] Worker initialized successfully. Model loaded.');

    return { success: true };

  } catch (error) {
    logger.error(`[CPU-WORKER] Initialization failed: ${error.message}`, { stack: error.stack });
    return { success: false, error: error.message };
  }
}

/**
 * Handle translation request
 */
async function handleTranslate(messageId, texts, sourceCode, targetCode) {
  if (!workerInitialized || !translator) {
    return {
      messageId: messageId,
      success: false,
      error: 'Worker not initialized'
    };
  }

  try {
    const startTime = Date.now();

    const translations = await translator(texts, {
      src_lang: sourceCode,
      tgt_lang: targetCode,
    });

    const duration = Date.now() - startTime;
    logger.info(`[CPU-WORKER] Translated ${texts.length} texts in ${duration}ms`);

    const translatedTexts = translations.map(item => item.translation_text);

    return {
      messageId: messageId,
      success: true,
      translations: translatedTexts,
      duration: duration
    };

  } catch (error) {
    logger.error(`[CPU-WORKER] Translation failed: ${error.message}`, {
      stack: error.stack
    });

    return {
      messageId: messageId,
      success: false,
      error: error.message
    };
  }
}

/**
 * Handle messages from main thread
 */
parentPort.on('message', async (message) => {
  const { type, data } = message;

  try {
    let result;

    switch (type) {
      case 'init':
        result = await initWorker();
        break;

      case 'translate':
        result = await handleTranslate(data.messageId, data.texts, data.sourceCode, data.targetCode);
        break;

      case 'terminate':
        logger.info('[CPU-WORKER] Termination requested, exiting...');
        process.exit(0);
        break;

      default:
        result = {
          success: false,
          error: `Unknown message type: ${type}`
        };
    }

    parentPort.postMessage({
      type: type,
      success: result.success,
      data: result
    });

  } catch (error) {
    logger.error(`[CPU-WORKER] Message handler error: ${error.message}`, { stack: error.stack });

    parentPort.postMessage({
      type: type,
      success: false,
      error: error.message,
      data: { messageId: data?.messageId } // Include messageId for error responses
    });
  }
});

// Handle uncaught errors
process.on('uncaughtException', (error) => {
  logger.error(`[CPU-WORKER] Uncaught exception: ${error.message}`, { stack: error.stack });
  parentPort.postMessage({
    type: 'error',
    success: false,
    error: error.message
  });
});

process.on('unhandledRejection', (reason) => {
  logger.error(`[CPU-WORKER] Unhandled rejection: ${reason}`);
});
