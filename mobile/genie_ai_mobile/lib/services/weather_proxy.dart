import 'dart:convert';
import 'package:genie_ai_mobile/services/api_service.dart';

class WeatherProxy {
  final ApiService _api = ApiService();

  Future<Map<String, dynamic>> getWeather(double lat, double lon, String userId) async {
    final res = await _api.post('weather', {
      'latitude': lat,
      'longitude': lon,
      'userId': userId,
    });
    return jsonDecode(res.body);
  }
}