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
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:path_provider/path_provider.dart';
import 'package:record/record.dart';
import '../../../../features/auth/data/datasources/auth_local_datasource.dart';
import '../../../../features/chats/data/repositories/chat_repository_impl.dart';

class AnimatedMicrophone extends ConsumerStatefulWidget {
  final ValueChanged<String>? onMessageDetected;

  const AnimatedMicrophone({super.key, this.onMessageDetected});

  @override
  ConsumerState<AnimatedMicrophone> createState() =>
      _AnimatedMicrophoneState();
}

class _AnimatedMicrophoneState extends ConsumerState<AnimatedMicrophone>
    with SingleTickerProviderStateMixin {
  late AnimationController _controller;
  late Animation<double> _animation;
  final AudioRecorder _recorder = AudioRecorder();
  bool _isListening = false;
  bool _isTranscribing = false;

  @override
  void initState() {
    super.initState();
    _controller = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 1000),
    )..repeat(reverse: true);
    _animation = Tween<double>(begin: 1.0, end: 1.15).animate(_controller);
  }

  @override
  void dispose() {
    _controller.dispose();
    _recorder.dispose();
    super.dispose();
  }

  Future<void> _startListening() async {
    final hasPermission = await _recorder.hasPermission();
    if (!hasPermission) return;
    final dir = await getTemporaryDirectory();
    final path =
        '${dir.path}/amina_voice_${DateTime.now().millisecondsSinceEpoch}.m4a';
    await _recorder.start(
      const RecordConfig(encoder: AudioEncoder.aacLc),
      path: path,
    );
    setState(() => _isListening = true);
  }

  Future<void> _stopListening() async {
    final path = await _recorder.stop();
    setState(() {
      _isListening = false;
      _isTranscribing = true;
    });

    if (path == null) {
      setState(() => _isTranscribing = false);
      return;
    }

    try {
      final transcript = await ref
          .read(chatRepositoryProvider)
          .transcribeAudio(path);

      if (!mounted) return;
      if (transcript.isNotEmpty) {
        widget.onMessageDetected?.call(transcript);
      }
    } catch (_) {
      // Transcription failed — silently dismiss so the user can try again.
    } finally {
      if (mounted) setState(() => _isTranscribing = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onLongPressStart: (_) => _startListening(),
      onLongPressEnd: (_) => _stopListening(),
      child: Column(
        children: [
          ScaleTransition(
            scale: _isListening
                ? _animation
                : const AlwaysStoppedAnimation(1.0),
            child: AnimatedContainer(
              duration: const Duration(milliseconds: 300),
              width: 100,
              height: 100,
              decoration: BoxDecoration(
                shape: BoxShape.circle,
                gradient: LinearGradient(
                  colors: _isListening
                      ? [Colors.redAccent, Colors.red]
                      : [const Color(0xFFF78B8B), const Color(0xFFF5A3A3)],
                ),
                boxShadow: [
                  BoxShadow(
                    color: (_isListening
                            ? Colors.red
                            : const Color(0xFFF78B8B))
                        .withValues(alpha: 0.4),
                    blurRadius: _isListening ? 35 : 20,
                    spreadRadius: _isListening ? 8 : 2,
                  ),
                ],
              ),
              child: _isTranscribing
                  ? const Center(
                      child: SizedBox(
                        width: 32,
                        height: 32,
                        child: CircularProgressIndicator(
                          strokeWidth: 2.5,
                          color: Colors.white,
                        ),
                      ),
                    )
                  : Icon(
                      _isListening ? Icons.graphic_eq : Icons.mic,
                      color: Colors.white,
                      size: 48,
                    ),
            ),
          ),
          if (_isListening) ...[
            const SizedBox(height: 15),
            const Text(
              'Listening…',
              style: TextStyle(
                color: Color(0xFFF78B8B),
                fontWeight: FontWeight.bold,
                fontSize: 16,
              ),
            ),
          ] else if (_isTranscribing) ...[
            const SizedBox(height: 15),
            const Text(
              'Processing…',
              style: TextStyle(
                color: Color(0xFFF78B8B),
                fontWeight: FontWeight.w500,
                fontSize: 14,
              ),
            ),
          ],
        ],
      ),
    );
  }
}
