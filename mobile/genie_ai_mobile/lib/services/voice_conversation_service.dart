import 'package:flutter/foundation.dart';
import 'package:flutter_tts/flutter_tts.dart';
import 'package:speech_to_text/speech_to_text.dart' as stt;

class VoiceConversationService {
  final stt.SpeechToText _speech = stt.SpeechToText();
  final FlutterTts _tts = FlutterTts();

  bool _speechReady = false;
  bool _ttsReady = false;

  bool get isListening => _speech.isListening;

  Future<bool> initialize({
    ValueChanged<String>? onStatus,
    ValueChanged<String>? onError,
  }) async {
    if (!_speechReady) {
      try {
        _speechReady = await _speech.initialize(
          onStatus: onStatus,
          onError: (error) => onError?.call(error.errorMsg),
          options: [stt.SpeechToText.androidNoBluetooth],
        );
      } catch (e) {
        debugPrint('[VOICE] Speech initialization failed: $e');
        _speechReady = false;
      }
    }

    if (!_ttsReady) {
      try {
        await _tts.awaitSpeakCompletion(false);
        await _tts.setSpeechRate(0.48);
        await _tts.setVolume(1.0);
        await _tts.setPitch(1.0);
        _ttsReady = true;
      } catch (e) {
        debugPrint('[VOICE] TTS initialization failed: $e');
        _ttsReady = false;
      }
    }

    return _speechReady;
  }

  Future<bool> startListening({
    required String localeId,
    required ValueChanged<String> onText,
    VoidCallback? onDone,
    ValueChanged<String>? onError,
  }) async {
    final ready = await initialize(onError: onError);
    if (!ready) return false;

    try {
      await stopSpeaking();
      await _speech.listen(
        localeId: localeId,
        listenFor: const Duration(seconds: 60),
        pauseFor: const Duration(seconds: 3),
        listenOptions: stt.SpeechListenOptions(
          cancelOnError: true,
          partialResults: true,
          listenMode: stt.ListenMode.dictation,
          autoPunctuation: true,
        ),
        onResult: (result) {
          onText(result.recognizedWords);
          if (result.finalResult) onDone?.call();
        },
      );
      return true;
    } catch (e) {
      debugPrint('[VOICE] Listen failed: $e');
      onError?.call(e.toString());
      return false;
    }
  }

  Future<void> stopListening() async {
    if (_speechReady && _speech.isListening) {
      await _speech.stop();
    }
  }

  Future<void> cancelListening() async {
    if (_speechReady && _speech.isListening) {
      await _speech.cancel();
    }
  }

  Future<void> speak(
    String text, {
    required String localeId,
    bool awaitCompletion = false,
  }) async {
    if (text.trim().isEmpty) return;
    if (!_ttsReady) {
      await initialize();
    }
    if (!_ttsReady) return;

    try {
      await _tts.awaitSpeakCompletion(awaitCompletion);
      await _tts.setLanguage(localeId.replaceAll('_', '-'));
      await _tts.stop();
      await _tts.speak(_speechText(text));
      if (awaitCompletion) {
        await _tts.awaitSpeakCompletion(false);
      }
    } catch (e) {
      debugPrint('[VOICE] Speak failed: $e');
    }
  }

  Future<void> stopSpeaking() async {
    if (_ttsReady) {
      await _tts.stop();
    }
  }

  Future<void> dispose() async {
    await cancelListening();
    await stopSpeaking();
  }

  String localeForLanguageCode(String languageCode) {
    const locales = {
      'ar': 'ar_SA',
      'bn': 'bn_BD',
      'de': 'de_DE',
      'en': 'en_US',
      'es': 'es_ES',
      'fr': 'fr_FR',
      'id': 'id_ID',
      'pt': 'pt_PT',
      'ru': 'ru_RU',
      'sw': 'sw_KE',
      'th': 'th_TH',
      'zh': 'zh_CN',
    };
    return locales[languageCode] ?? 'en_US';
  }

  String _speechText(String text) {
    var cleaned = text
        .replaceAll(RegExp(r'```[\s\S]*?```'), ' ')
        .replaceAllMapped(RegExp(r'!\[([^\]]*)\]\([^\)]*\)'), (m) => m[1] ?? '')
        .replaceAllMapped(RegExp(r'\[([^\]]+)\]\([^\)]*\)'), (m) => m[1] ?? '')
        .replaceAllMapped(RegExp(r'`([^`]*)`'), (m) => m[1] ?? '')
        .replaceAll(RegExp(r'[#>*_~\-]+'), ' ')
        .replaceAll(RegExp(r'<[^>]+>'), ' ')
        .replaceAll(RegExp(r'\s+'), ' ')
        .trim();

    const maxLength = 1400;
    if (cleaned.length > maxLength) {
      cleaned = '${cleaned.substring(0, maxLength)}.';
    }
    return cleaned;
  }
}
