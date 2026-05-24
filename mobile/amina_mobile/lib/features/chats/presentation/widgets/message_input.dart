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
import 'package:path_provider/path_provider.dart';
import 'package:record/record.dart';

class MessageInput extends StatefulWidget {
  final ValueChanged<String> onSend;
  final Future<void> Function(String filePath)? onAudioRecorded;

  const MessageInput({super.key, required this.onSend, this.onAudioRecorded});

  @override
  State<MessageInput> createState() => _MessageInputState();
}

class _MessageInputState extends State<MessageInput> {
  final TextEditingController _controller = TextEditingController();
  final AudioRecorder _recorder = AudioRecorder();
  bool _isRecording = false;

  void _submit() {
    final text = _controller.text.trim();
    if (text.isEmpty) return;
    widget.onSend(text);
    _controller.clear();
  }

  Future<void> _toggleRecording() async {
    if (_isRecording) {
      final path = await _recorder.stop();
      setState(() => _isRecording = false);
      if (path != null) widget.onAudioRecorded?.call(path);
    } else {
      final hasPermission = await _recorder.hasPermission();
      if (!hasPermission) {
        if (mounted) {
          ScaffoldMessenger.of(context).showSnackBar(
            const SnackBar(content: Text('Microphone permission is required')),
          );
        }
        return;
      }
      final dir = await getTemporaryDirectory();
      final path =
          '${dir.path}/amina_voice_${DateTime.now().millisecondsSinceEpoch}.m4a';
      await _recorder.start(
        const RecordConfig(encoder: AudioEncoder.aacLc),
        path: path,
      );
      setState(() => _isRecording = true);
    }
  }

  @override
  void dispose() {
    _controller.dispose();
    _recorder.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(15),
      decoration: BoxDecoration(
        color: Colors.white,
        border: Border(top: BorderSide(color: Colors.grey[200]!)),
      ),
      child: SafeArea(
        child: Column(
          children: [
            // Quick-reply chips
            SingleChildScrollView(
              scrollDirection: Axis.horizontal,
              child: Row(
                children: ['How do I feel?', 'Medication reminder', 'Health tips']
                    .map(
                      (tip) => Padding(
                        padding: const EdgeInsets.only(right: 8),
                        child: ActionChip(
                          label: Text(
                            tip,
                            style: const TextStyle(
                                color: Color(0xFFF78B8B), fontSize: 12),
                          ),
                          backgroundColor: const Color(0xFFFFF1F2),
                          onPressed: () => widget.onSend(tip),
                        ),
                      ),
                    )
                    .toList(),
              ),
            ),

            const SizedBox(height: 10),

            Row(
              children: [
                // Text field
                Expanded(
                  child: Container(
                    padding: const EdgeInsets.symmetric(horizontal: 15),
                    decoration: BoxDecoration(
                      color: Colors.grey[100],
                      borderRadius: BorderRadius.circular(30),
                    ),
                    child: TextField(
                      controller: _controller,
                      decoration: const InputDecoration(
                        hintText: 'Type your message...',
                        border: InputBorder.none,
                      ),
                      onSubmitted: (_) => _submit(),
                    ),
                  ),
                ),

                const SizedBox(width: 10),

                // Send button (shown while typing) / Mic button (when empty)
                ValueListenableBuilder<TextEditingValue>(
                  valueListenable: _controller,
                  builder: (_, value, __) {
                    if (value.text.isNotEmpty) {
                      return _CircleButton(
                        onTap: _submit,
                        color: const Color(0xFFF78B8B),
                        size: 50,
                        child: const Icon(Icons.send_rounded,
                            color: Colors.white, size: 22),
                      );
                    }
                    return _CircleButton(
                      onTap: _toggleRecording,
                      color: _isRecording ? Colors.red : Colors.redAccent,
                      size: _isRecording ? 60 : 50,
                      shadowColor: _isRecording ? Colors.red : Colors.redAccent,
                      shadowRadius: _isRecording ? 16 : 5,
                      child: Icon(
                        _isRecording ? Icons.stop : Icons.mic,
                        color: Colors.white,
                        size: 28,
                      ),
                    );
                  },
                ),
              ],
            ),

            if (_isRecording) ...[
              const SizedBox(height: 8),
              const Text(
                'Recording… tap to send',
                style: TextStyle(
                    fontSize: 12,
                    color: Colors.redAccent,
                    fontWeight: FontWeight.w500),
              ),
            ],
          ],
        ),
      ),
    );
  }
}

// Reusable tappable circle button with InkWell ripple.
class _CircleButton extends StatelessWidget {
  final VoidCallback onTap;
  final Color color;
  final double size;
  final Color? shadowColor;
  final double shadowRadius;
  final Widget child;

  const _CircleButton({
    required this.onTap,
    required this.color,
    required this.size,
    required this.child,
    this.shadowColor,
    this.shadowRadius = 5,
  });

  @override
  Widget build(BuildContext context) {
    return Material(
      color: color,
      shape: const CircleBorder(),
      elevation: 0,
      child: InkWell(
        onTap: onTap,
        customBorder: const CircleBorder(),
        splashColor: Colors.white24,
        child: AnimatedContainer(
          duration: const Duration(milliseconds: 200),
          width: size,
          height: size,
          decoration: BoxDecoration(
            shape: BoxShape.circle,
            boxShadow: [
              BoxShadow(
                color: (shadowColor ?? color).withValues(alpha: 0.35),
                blurRadius: shadowRadius,
              ),
            ],
          ),
          child: Center(child: child),
        ),
      ),
    );
  }
}
