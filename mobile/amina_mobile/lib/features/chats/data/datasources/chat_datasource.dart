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

import '../../domain/entities/prescription_scan_result.dart';
import '../models/chat_response_model.dart';
import '../models/chat_session_model.dart';
import '../models/message_model.dart';

abstract class ChatDatasource {
  Future<List<ChatSessionModel>> getSessions();

  Future<(String?, List<MessageModel>)> getSessionHistory(String sessionId);

  Future<ChatSessionModel> createSession();

  Future<ChatResponseModel> sendMessage({
    required String sessionId,
    required String message,
  });

  Future<String> transcribeAudio(String filePath);

  Future<String> fetchTtsAudio(String text, String lang);

  Future<void> deleteSession(String sessionId);

  Future<PrescriptionScanResult> scanPrescription(
      String filePath, String sessionId, String language);
}
