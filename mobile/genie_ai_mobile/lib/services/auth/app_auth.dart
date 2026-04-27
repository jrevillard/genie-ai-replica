import 'package:flutter_appauth/flutter_appauth.dart';

abstract class AppAuth {
  Future<AuthorizationTokenResponse> authorizeAndExchangeCode(
    AuthorizationTokenRequest request,
  );

  Future<TokenResponse> token(TokenRequest request);
}

class FlutterAppAuthAdapter implements AppAuth {
  final FlutterAppAuth _appAuth;

  const FlutterAppAuthAdapter([FlutterAppAuth? appAuth])
      : _appAuth = appAuth ?? const FlutterAppAuth();

  @override
  Future<AuthorizationTokenResponse> authorizeAndExchangeCode(
    AuthorizationTokenRequest request,
  ) => _appAuth.authorizeAndExchangeCode(request);

  @override
  Future<TokenResponse> token(TokenRequest request) => _appAuth.token(request);
}
