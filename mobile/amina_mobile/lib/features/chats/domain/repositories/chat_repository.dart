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

import '../entities/chat_agent_response.dart';
import '../entities/chat_message.dart';
import '../entities/chat_session.dart';
import '../entities/prescription_scan_result.dart';

abstract class ChatRepository {
  Future<List<ChatSession>> getSessions();

  // Returns (confirmedSessionId, messages). The backend may assign a different
  // session ID than the one requested — callers must update accordingly.
  Future<(String?, List<ChatMessage>)> getSessionHistory(String sessionId);

  Future<ChatSession> createSession();

  Future<ChatAgentResponse> sendMessage({
    required String sessionId,
    required String message,
  });

  Future<String> transcribeAudio(String filePath);

  Future<String> fetchTtsAudio(String text, String lang);

  Future<void> deleteSession(String sessionId);

  Future<PrescriptionScanResult> scanPrescription(
      String filePath, String sessionId, String language);
}
