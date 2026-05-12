import '../../domain/entities/chat_source.dart';

class ChatSourceModel extends ChatSource {
  const ChatSourceModel({required super.title, super.url, super.org});

  factory ChatSourceModel.fromJson(Map<String, dynamic> json) =>
      ChatSourceModel(
        title: json['title'] as String? ?? '',
        url: json['url'] as String?,
        org: json['org'] as String?,
      );
}
