import 'chat_source_model.dart';

class ChatResponseModel {
  final String response;
  final bool isEmergency;
  final String sessionId;
  final List<ChatSourceModel> sources;
  final String? intention;
  final String? triageLevel;

  const ChatResponseModel({
    required this.response,
    required this.isEmergency,
    required this.sessionId,
    required this.sources,
    this.intention,
    this.triageLevel,
  });

  factory ChatResponseModel.fromJson(Map<String, dynamic> json) =>
      ChatResponseModel(
        response: json['response'] as String,
        isEmergency: json['is_emergency'] as bool? ?? false,
        sessionId: json['session_id'] as String,
        sources: (json['sources'] as List<dynamic>? ?? [])
            .map((s) => ChatSourceModel.fromJson(s as Map<String, dynamic>))
            .toList(),
        intention: json['intention'] as String?,
        triageLevel: json['triage_level'] as String?,
      );
}
