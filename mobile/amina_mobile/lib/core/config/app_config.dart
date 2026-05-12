// API base URL — override at build time with:
//   flutter run --dart-define=API_BASE_URL=https://api.example.com
class AppConfig {
  static const String baseUrl = String.fromEnvironment(
    'API_BASE_URL',
    defaultValue: 'http://10.0.2.2:8000',
  );
}
