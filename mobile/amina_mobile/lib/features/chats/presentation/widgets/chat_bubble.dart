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

import 'package:flutter/material.dart';

class ChatBubble extends StatelessWidget {
  final Map<String, dynamic> message;
  final VoidCallback? onPlayTts;
  final bool isPlaying;
  final bool isTtsLoading;

  const ChatBubble({
    super.key,
    required this.message,
    this.onPlayTts,
    this.isPlaying = false,
    this.isTtsLoading = false,
  });

  @override
  Widget build(BuildContext context) {
    final bool isUser = message['sender'] == 'user';

    return Align(
      alignment: isUser ? Alignment.centerRight : Alignment.centerLeft,
      child: Container(
        margin: const EdgeInsets.symmetric(vertical: 5),
        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
        constraints: BoxConstraints(
          maxWidth: MediaQuery.of(context).size.width * 0.75,
        ),
        decoration: BoxDecoration(
          color: isUser ? const Color(0xFFF78B8B) : Colors.white,
          borderRadius: BorderRadius.only(
            topLeft: const Radius.circular(20),
            topRight: const Radius.circular(20),
            bottomLeft: Radius.circular(isUser ? 20 : 0),
            bottomRight: Radius.circular(isUser ? 0 : 20),
          ),
          boxShadow: [
            BoxShadow(
              color: Colors.black.withValues(alpha: 0.05),
              blurRadius: 5,
            ),
          ],
        ),
        child: Column(
          crossAxisAlignment:
              isUser ? CrossAxisAlignment.end : CrossAxisAlignment.start,
          children: [
            Text(
              message['text'] as String,
              style: TextStyle(
                color: isUser ? Colors.white : Colors.black87,
                fontSize: 16,
              ),
            ),
            const SizedBox(height: 4),
            Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                Text(
                  message['time'] as String,
                  style: TextStyle(
                    color: isUser ? Colors.white70 : Colors.grey,
                    fontSize: 10,
                  ),
                ),

                // TTS button — only for Amina's messages
                if (!isUser && onPlayTts != null) ...[
                  const SizedBox(width: 8),
                  GestureDetector(
                    onTap: onPlayTts,
                    child: isTtsLoading
                        ? const SizedBox(
                            width: 14,
                            height: 14,
                            child: CircularProgressIndicator(
                              strokeWidth: 1.5,
                              color: Colors.grey,
                            ),
                          )
                        : Icon(
                            isPlaying
                                ? Icons.stop_circle_outlined
                                : Icons.volume_up_outlined,
                            size: 16,
                            color: Colors.grey,
                          ),
                  ),
                ],
              ],
            ),
          ],
        ),
      ),
    );
  }
}
