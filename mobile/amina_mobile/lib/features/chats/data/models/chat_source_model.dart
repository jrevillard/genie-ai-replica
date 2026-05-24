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
