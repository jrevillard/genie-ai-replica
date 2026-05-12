import 'dart:async';
import 'dart:io';

import 'package:flutter_appauth/flutter_appauth.dart';
import 'package:http/http.dart' as http;

class NetworkErrorClassifier {
  static const Set<String> _networkKeywords = {
    'network',
    'connection',
    'timeout',
    'no_browser',
    'unreachable',
  };

  bool isNetworkError(Object error) {
    if (error is SocketException) return true;
    if (error is http.ClientException) return true;
    if (error is TimeoutException) return true;
    if (error is TlsException) return true;

    if (error is FlutterAppAuthPlatformException) {
      final code = error.code.toLowerCase();
      return _networkKeywords.any(code.contains);
    }

    return false;
  }
}
