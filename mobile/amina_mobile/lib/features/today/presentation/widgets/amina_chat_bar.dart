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

import 'dart:ui';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:path_provider/path_provider.dart';
import 'package:record/record.dart';
import '../../../chats/data/repositories/chat_repository_impl.dart';
import '../../../chats/presentation/providers/chat_messages_provider.dart';
import 'rx_entry_sheet.dart';

import '../../../../core/theme/app_theme.dart';

class AminaChatBar extends ConsumerStatefulWidget {
  const AminaChatBar({super.key});

  @override
  ConsumerState<AminaChatBar> createState() => _AminaChatBarState();
}

class _AminaChatBarState extends ConsumerState<AminaChatBar>
    with SingleTickerProviderStateMixin {
  final TextEditingController _controller = TextEditingController();
  final AudioRecorder _recorder = AudioRecorder();
  bool _isListening = false;
  bool _isTranscribing = false;

  late final AnimationController _micController;
  late final Animation<double> _micScale;

  @override
  void initState() {
    super.initState();
    _micController = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 800),
    )..repeat(reverse: true);
    _micScale = Tween<double>(begin: 1.0, end: 1.18).animate(
      CurvedAnimation(parent: _micController, curve: Curves.easeInOut),
    );
  }

  @override
  void dispose() {
    _controller.dispose();
    _micController.dispose();
    _recorder.dispose();
    super.dispose();
  }

  void _send(String text, {bool autoPlayTts = false}) {
    final trimmed = text.trim();
    if (trimmed.isEmpty) return;
    ref.read(chatSessionsProvider.notifier).sendMessage(trimmed, autoPlayTts: autoPlayTts);
    _controller.clear();
  }

  Future<void> _toggleMic() async {
    if (_isTranscribing) return;

    if (_isListening) {
      // Stop recording and transcribe
      final path = await _recorder.stop();
      setState(() => _isListening = false);
      if (path == null) return;

      setState(() => _isTranscribing = true);
      try {
        final transcript =
            await ref.read(chatRepositoryProvider).transcribeAudio(path);
        if (!mounted) return;
        if (transcript.isNotEmpty) {
          _send(transcript, autoPlayTts: true);
        }
      } catch (_) {
        // Transcription failed silently — user can type instead
      } finally {
        if (mounted) setState(() => _isTranscribing = false);
      }
    } else {
      // Start recording
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
      setState(() => _isListening = true);
    }
  }

  @override
  Widget build(BuildContext context) {
    final cs    = Theme.of(context).colorScheme;
    final amina = Theme.of(context).extension<AminaColors>()!;
    return ClipRect(
      child: BackdropFilter(
        filter: ImageFilter.blur(sigmaX: 24, sigmaY: 24),
        child: Container(
          decoration: BoxDecoration(
            color:  cs.surface.withValues(alpha: 0.92),
            border: Border(top: BorderSide(color: amina.cardBorder, width: 0.8)),
          ),
          child: SafeArea(
            top: false,
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                _buildInputRow(context, cs, amina),
                if (_isListening) ...[
                  const SizedBox(height: 4),
                  const Text(
                    'Listening… tap to send',
                    style: TextStyle(
                      fontSize:   12,
                      color:      Colors.redAccent,
                      fontWeight: FontWeight.w500,
                    ),
                  ),
                  const SizedBox(height: 6),
                ] else if (_isTranscribing) ...[
                  const SizedBox(height: 4),
                  Text(
                    'Processing…',
                    style: TextStyle(
                      fontSize:   12,
                      color:      cs.primary,
                      fontWeight: FontWeight.w500,
                    ),
                  ),
                  const SizedBox(height: 6),
                ],
              ],
            ),
          ),
        ),
      ),
    );
  }

  Widget _buildInputRow(BuildContext context, ColorScheme cs, AminaColors amina) {
    final showSend = _controller.text.trim().isNotEmpty;

    return Padding(
      padding: const EdgeInsets.fromLTRB(12, 8, 12, 10),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.end,
        children: [
          _RxButton(),
          const SizedBox(width: 10),

          Expanded(
            child: Container(
              padding: const EdgeInsets.symmetric(horizontal: 16),
              decoration: BoxDecoration(
                color:        amina.inputFill,
                borderRadius: BorderRadius.circular(28),
                border:       Border.all(color: amina.cardBorder),
              ),
              child: TextField(
                controller: _controller,
                style: TextStyle(fontSize: 16, color: cs.onSurface),
                decoration: InputDecoration(
                  hintText: "Ask Amina anything…",
                  hintStyle: TextStyle(
                    fontSize: 15,
                    color:    cs.onSurfaceVariant.withValues(alpha: 0.7),
                  ),
                  border:         InputBorder.none,
                  contentPadding: const EdgeInsets.symmetric(vertical: 12),
                ),
                onSubmitted: _send,
                onChanged: (_) => setState(() {}),
                textInputAction:    TextInputAction.send,
                textCapitalization: TextCapitalization.sentences,
                maxLines: 4,
                minLines: 1,
              ),
            ),
          ),
          const SizedBox(width: 10),

          // Send button (when text is typed) or Mic button
          GestureDetector(
            onTap:     showSend ? () => _send(_controller.text) : _toggleMic,
            behavior:  HitTestBehavior.opaque,
            child: ScaleTransition(
              scale: _isListening
                  ? _micScale
                  : const AlwaysStoppedAnimation(1.0),
              child: AnimatedContainer(
                duration: const Duration(milliseconds: 260),
                width:  50,
                height: 50,
                decoration: BoxDecoration(
                  shape: BoxShape.circle,
                  color: showSend
                      ? cs.primary
                      : _isListening
                          ? Colors.redAccent
                          : cs.primary,
                  boxShadow: [
                    BoxShadow(
                      color: (showSend || !_isListening
                              ? cs.primary
                              : Colors.redAccent)
                          .withValues(alpha: 0.32),
                      blurRadius:   _isListening ? 20 : 10,
                      spreadRadius: _isListening ? 4  : 1,
                    ),
                  ],
                ),
                child: _isTranscribing
                    ? const SizedBox(
                        width:  22,
                        height: 22,
                        child: CircularProgressIndicator(
                          strokeWidth: 2,
                          color:       Colors.white,
                        ),
                      )
                    : Icon(
                        showSend
                            ? Icons.send_rounded
                            : _isListening
                                ? Icons.stop_rounded
                                : Icons.mic_rounded,
                        color: Colors.white,
                        size:  26,
                      ),
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _RxButton extends StatelessWidget {
  @override
  Widget build(BuildContext context) {
    final cs    = Theme.of(context).colorScheme;
    final amina = Theme.of(context).extension<AminaColors>()!;
    return Material(
      color:        amina.inputFill,
      borderRadius: BorderRadius.circular(14),
      child: InkWell(
        borderRadius: BorderRadius.circular(14),
        onTap: () => showRxEntrySheet(context),
        child: Container(
          width:  48,
          height: 48,
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(14),
            border:       Border.all(color: amina.cardBorder),
          ),
          child: Icon(
            Icons.document_scanner_outlined,
            color: cs.onSurfaceVariant,
            size:  22,
          ),
        ),
      ),
    );
  }
}
