// This file is part of Amina Care.
//
// Amina Care is free software: you can redistribute it and/or modify
// it under the terms of the GNU Lesser General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// Amina Care is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
// GNU Lesser General Public License for more details.
//
// You should have received a copy of the GNU Lesser General Public License
// along with Amina Care. If not, see <https://www.gnu.org/licenses/>.

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
