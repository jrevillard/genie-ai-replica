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

﻿import 'dart:io';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:image_picker/image_picker.dart';
import '../../../chats/data/repositories/chat_repository_impl.dart';
import '../../../chats/presentation/providers/chat_messages_provider.dart';
import '../providers/prescription_provider.dart';

import '../../../../core/theme/app_theme.dart';

// Scanner identity colours — fixed, not theme-adaptive.
const _kBlue   = Color(0xFF3B82F6);
const _kBlueBg = Color(0xFFEFF6FF);

// ─── Sheet pages ──────────────────────────────────────────────────────────────

enum _Page { choice, imageUpload, scanning, scanResult, manual }

// ─── Quick prompts ────────────────────────────────────────────────────────────

// (emoji, chip label, full prompt sent to Amina)
const _kQuickPrompts = [
  ('💉', 'Diabetes care',       'I have diabetes. What should I watch out for and how can I manage my blood sugar?'),
  ('🩸', 'Blood pressure',      'I have high blood pressure. What lifestyle changes and foods can help?'),
  ('💊', 'My medications',      'Can you help me understand my medications and when to take them?'),
  ('🥘', 'Local food advice',   'What local foods are good for managing my condition? I eat a lot of benachin and domoda.'),
  ('📋', 'My care plan',        'Can you create a care plan for me based on my health conditions?'),
  ('🏥', 'Health facility',     'Where is the nearest health facility I can visit for a check-up?'),
];

// ─── Frequency options ────────────────────────────────────────────────────────

const _frequencies = [
  'Once daily',
  'Twice daily',
  '3× daily',
  'Every 8 hours',
  'As needed',
  'Other',
];

// ─── Main sheet ───────────────────────────────────────────────────────────────

/// Bottom sheet that lets the user log a prescription via AI scan or manual
/// entry. Call via [showRxEntrySheet] so the caller doesn't need to configure
/// [showModalBottomSheet] itself.
///
/// Set [medicationOnly] to true when opening from a pure registration context
/// (e.g. the Me tab) — hides the chat quick-prompts and shows only the
/// scan / manual entry options.
class RxEntrySheet extends ConsumerStatefulWidget {
  final bool medicationOnly;
  const RxEntrySheet({super.key, this.medicationOnly = false});

  @override
  ConsumerState<RxEntrySheet> createState() => _RxEntrySheetState();
}

class _RxEntrySheetState extends ConsumerState<RxEntrySheet> {
  late _Page _page;
  XFile? _pickedImage;
  final  _picker      = ImagePicker();

  bool get _hasImage => _pickedImage != null;

  @override
  void initState() {
    super.initState();
    _page = widget.medicationOnly ? _Page.manual : _Page.choice;
  }

  // ── Form keys ──────────────────────────────────────────────────────────────
  final _formKey     = GlobalKey<FormState>(); // manual entry form
  final _scanFormKey = GlobalKey<FormState>(); // scan-result editable form

  // ── Shared text controllers ────────────────────────────────────────────────
  // Used by both the manual form and the editable scan-result form.
  final _nameCtrl     = TextEditingController();
  final _dosageCtrl   = TextEditingController();
  final _durationCtrl = TextEditingController();
  final _notesCtrl    = TextEditingController();

  String? _frequency;
  bool _showFrequencyError = false;

  @override
  void dispose() {
    _nameCtrl.dispose();
    _dosageCtrl.dispose();
    _durationCtrl.dispose();
    _notesCtrl.dispose();
    super.dispose();
  }

  // ── Quick prompt ───────────────────────────────────────────────────────────

  void _sendQuickPrompt(String prompt) {
    Navigator.of(context).pop();
    final notifier = ref.read(chatSessionsProvider.notifier);
    notifier.newSession();
    notifier.sendMessage(prompt);
  }

  // ── Navigation ─────────────────────────────────────────────────────────────

  void _goToImageUpload() => setState(() => _page = _Page.imageUpload);
  void _goManual()        => setState(() => _page = _Page.manual);

  Future<void> _pickFromCamera() async {
    final img = await _picker.pickImage(source: ImageSource.camera, imageQuality: 85);
    if (img != null && mounted) setState(() => _pickedImage = img);
  }

  Future<void> _pickFromGallery() async {
    final img = await _picker.pickImage(source: ImageSource.gallery, imageQuality: 85);
    if (img != null && mounted) setState(() => _pickedImage = img);
  }

  Future<void> _triggerAIScan() async {
    setState(() => _page = _Page.scanning);
    try {
      final sessionId = ref.read(chatSessionsProvider).activeId;
      final result = await ref.read(chatRepositoryProvider).scanPrescription(
            _pickedImage!.path, sessionId, 'en');

      if (!mounted) return;

      if (!result.isPrescription) {
        setState(() => _page = _Page.imageUpload);
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(
          content: Text(result.reason ??
              "That doesn't look like a prescription. Please upload a clear photo."),
          backgroundColor: Colors.redAccent,
          behavior: SnackBarBehavior.floating,
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
          margin: const EdgeInsets.all(16),
        ));
        return;
      }

      // Pre-fill form with AI-extracted data; user reviews before saving.
      _nameCtrl.text     = result.medicationSummary.join('\n');
      _dosageCtrl.text   = '';
      _durationCtrl.text = '';
      _notesCtrl.text    = result.guidance;

      setState(() {
        _frequency          = null;
        _showFrequencyError = false;
        _page               = _Page.scanResult;
      });
    } catch (_) {
      if (!mounted) return;
      setState(() => _page = _Page.imageUpload);
      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(
        content: Text(
            'Could not read the prescription. Please try again or enter manually.'),
        backgroundColor: Colors.redAccent,
        behavior: SnackBarBehavior.floating,
        margin: EdgeInsets.all(16),
      ));
    }
  }

  void _rescan() {
    setState(() {
      _pickedImage = null;
      _page        = _Page.imageUpload;
    });
  }

  // ── Save helpers ───────────────────────────────────────────────────────────

  void _saveManual() {
    FocusScope.of(context).unfocus();
    final formValid = _formKey.currentState?.validate() ?? false;
    if (_frequency == null) setState(() => _showFrequencyError = true);
    if (!formValid || _frequency == null) return;

    _confirm(
      PrescriptionEntry(
        id:             DateTime.now().millisecondsSinceEpoch.toString(),
        medicationName: _nameCtrl.text.trim(),
        dosage:         _dosageCtrl.text.trim(),
        frequency:      _frequency!,
        duration:       _durationCtrl.text.trim(),
        notes:          _notesCtrl.text.trim(),
        dateAdded:      DateTime.now(),
        fromScan:       false,
      ),
    );
  }

  void _saveScanResult() {
    FocusScope.of(context).unfocus();
    final formValid = _scanFormKey.currentState?.validate() ?? false;
    if (_frequency == null) setState(() => _showFrequencyError = true);
    if (!formValid || _frequency == null) return;

    _confirm(
      PrescriptionEntry(
        id:             DateTime.now().millisecondsSinceEpoch.toString(),
        medicationName: _nameCtrl.text.trim(),
        dosage:         _dosageCtrl.text.trim(),
        frequency:      _frequency!,
        duration:       _durationCtrl.text.trim(),
        notes:          _notesCtrl.text.trim(),
        dateAdded:      DateTime.now(),
        fromScan:       true,
      ),
    );
  }

  void _confirm(PrescriptionEntry entry) {
    // Persist to provider.
    ref.read(prescriptionProvider.notifier).add(entry);

    // Post a confirmation message in the active chat session.
    ref
        .read(chatSessionsProvider.notifier)
        .sendMessage('💊 Prescription logged: ${entry.chatSummary}.');

    Navigator.of(context).pop();

    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Row(children: [
          const Icon(Icons.check_circle_outline_rounded,
              color: Colors.white, size: 18),
          const SizedBox(width: 8),
          const Text('Prescription saved!'),
        ]),
        backgroundColor: Theme.of(context).colorScheme.primary,
        behavior: SnackBarBehavior.floating,
        shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(12)),
        margin: const EdgeInsets.all(16),
        duration: const Duration(seconds: 3),
      ),
    );
  }

  // ── Build ──────────────────────────────────────────────────────────────────

  @override
  Widget build(BuildContext context) {
    // The keyboard height — used to pad the bottom of the scroll content so
    // the Save button is always reachable by scrolling up.
    // Crucially, we do NOT add this as an outer Padding because that would
    // push the total column height beyond the ConstrainedBox max, causing
    // the "Bottom overflowed by N pixels" error.
    final keyboardHeight = MediaQuery.of(context).viewInsets.bottom;

    return SafeArea(
      top: false,
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          _buildHandle(),
          ConstrainedBox(
            constraints: BoxConstraints(
              maxHeight: MediaQuery.of(context).size.height * 0.85,
            ),
            child: SingleChildScrollView(
              // Dragging down on the form dismisses the keyboard naturally.
              keyboardDismissBehavior:
                  ScrollViewKeyboardDismissBehavior.onDrag,
              // Bottom padding = keyboard height so the Save button scrolls
              // clear of the keyboard and is always tappable.
              padding: EdgeInsets.only(bottom: keyboardHeight),
              child: AnimatedSwitcher(
                duration: const Duration(milliseconds: 260),
                switchInCurve:  Curves.easeOut,
                switchOutCurve: Curves.easeIn,
                child: _buildPage(),
              ),
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildHandle() {
    return Center(
      child: Container(
        margin: const EdgeInsets.only(top: 12, bottom: 4),
        width: 36,
        height: 4,
        decoration: BoxDecoration(
          color: Theme.of(context).extension<AminaColors>()!.cardBorder,
          borderRadius: BorderRadius.circular(2),
        ),
      ),
    );
  }

  Widget _buildPage() {
    switch (_page) {
      case _Page.choice:
        return _ChoicePage(
          key:              const ValueKey('choice'),
          onScan:           _goToImageUpload,
          onManual:         _goManual,
          onQuickPrompt:    _sendQuickPrompt,
          medicationOnly:   widget.medicationOnly,
        );
      case _Page.imageUpload:
        return _ImageUploadPage(
          key:             const ValueKey('imageUpload'),
          hasImage:        _hasImage,
          pickedImagePath: _pickedImage?.path,
          onPickCamera:    () => _pickFromCamera(),
          onPickGallery:   () => _pickFromGallery(),
          onScan:          _triggerAIScan,
          onBack:          () => setState(() => _page = _Page.choice),
        );
      case _Page.scanning:
        return const _ScanningPage(key: ValueKey('scanning'));
      case _Page.scanResult:
        return _ScanResultFormPage(
          key:                const ValueKey('result'),
          formKey:            _scanFormKey,
          nameCtrl:           _nameCtrl,
          dosageCtrl:         _dosageCtrl,
          durationCtrl:       _durationCtrl,
          notesCtrl:          _notesCtrl,
          frequency:          _frequency,
          showFrequencyError: _showFrequencyError,
          onFrequencyChanged: (val) => setState(() {
            _frequency          = val;
            _showFrequencyError = false;
          }),
          onSave:   _saveScanResult,
          onRescan: _rescan,
        );
      case _Page.manual:
        return _ManualFormPage(
          key:                const ValueKey('manual'),
          formKey:            _formKey,
          nameCtrl:           _nameCtrl,
          dosageCtrl:         _dosageCtrl,
          durationCtrl:       _durationCtrl,
          notesCtrl:          _notesCtrl,
          frequency:          _frequency,
          showFrequencyError: _showFrequencyError,
          onFrequencyChanged: (val) => setState(() {
            _frequency          = val;
            _showFrequencyError = false;
          }),
          onSubmit: _saveManual,
        );
    }
  }
}

// ─── Page: Choice ─────────────────────────────────────────────────────────────

class _ChoicePage extends StatelessWidget {
  final VoidCallback          onScan;
  final VoidCallback          onManual;
  final ValueChanged<String>  onQuickPrompt;
  final bool                  medicationOnly;

  const _ChoicePage({
    super.key,
    required this.onScan,
    required this.onManual,
    required this.onQuickPrompt,
    this.medicationOnly = false,
  });

  @override
  Widget build(BuildContext context) {
    final cs    = Theme.of(context).colorScheme;
    final amina = Theme.of(context).extension<AminaColors>()!;
    return Padding(
      padding: const EdgeInsets.fromLTRB(20, 12, 20, 32),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // ── Header ─────────────────────────────────────────────────────────
          Text(
            medicationOnly ? 'Add Medication' : 'Quick start',
            style: TextStyle(
              fontSize:      20,
              fontWeight:    FontWeight.w700,
              color:         cs.onSurface,
              letterSpacing: -0.3,
            ),
          ),
          const SizedBox(height: 2),
          Text(
            medicationOnly
                ? 'Scan your prescription or enter it manually'
                : 'Ask Amina or log a prescription',
            style: TextStyle(fontSize: 13, color: cs.onSurfaceVariant),
          ),

          const SizedBox(height: 16),

          if (!medicationOnly) ...[
            // ── Quick prompts ─────────────────────────────────────────────────
            _PromptRow(
              prompts: _kQuickPrompts.sublist(0, 3),
              onTap:   onQuickPrompt,
            ),
            const SizedBox(height: 8),
            _PromptRow(
              prompts: _kQuickPrompts.sublist(3),
              onTap:   onQuickPrompt,
            ),

            const SizedBox(height: 24),

            // ── Section divider ───────────────────────────────────────────────
            Row(children: [
              Expanded(child: Divider(color: amina.cardBorder)),
              Padding(
                padding: const EdgeInsets.symmetric(horizontal: 12),
                child: Text(
                  'Log a prescription',
                  style: TextStyle(
                    fontSize:      12,
                    fontWeight:    FontWeight.w600,
                    color:         cs.onSurfaceVariant.withValues(alpha: 0.8),
                    letterSpacing: 0.3,
                  ),
                ),
              ),
              Expanded(child: Divider(color: amina.cardBorder)),
            ]),

            const SizedBox(height: 16),
          ],

          const _DisclaimerBanner(),
          const SizedBox(height: 16),

          _OptionCard(
            icon:      Icons.edit_note_rounded,
            iconColor: cs.primary,
            iconBg:    cs.primaryContainer,
            title:     'Enter Manually',
            subtitle:  'Type in the medication name, dosage, and schedule step by step.',
            onTap:     onManual,
          ),

          const SizedBox(height: 16),

          // Close
          Center(
            child: TextButton(
              onPressed: () => Navigator.of(context).pop(),
              child: Text('Cancel',
                  style: TextStyle(color: cs.onSurfaceVariant, fontSize: 15)),
            ),
          ),
        ],
      ),
    );
  }
}

class _OptionCard extends StatelessWidget {
  final IconData icon;
  final Color iconColor;
  final Color iconBg;
  final String title;
  final String subtitle;
  final VoidCallback onTap;

  const _OptionCard({
    required this.icon,
    required this.iconColor,
    required this.iconBg,
    required this.title,
    required this.subtitle,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    final cs    = Theme.of(context).colorScheme;
    final amina = Theme.of(context).extension<AminaColors>()!;
    return Material(
      color: cs.surface,
      borderRadius: BorderRadius.circular(20),
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(20),
        splashColor: iconColor.withValues(alpha: 0.08),
        child: Container(
          padding: const EdgeInsets.all(18),
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(20),
            border: Border.all(color: amina.cardBorder),
          ),
          child: Row(
            children: [
              Container(
                width: 52,
                height: 52,
                decoration: BoxDecoration(
                    color: iconBg, shape: BoxShape.circle),
                child: Icon(icon, color: iconColor, size: 26),
              ),
              const SizedBox(width: 16),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(title,
                        style: TextStyle(
                            fontSize: 16,
                            fontWeight: FontWeight.w700,
                            color: cs.onSurface)),
                    const SizedBox(height: 4),
                    Text(subtitle,
                        style: TextStyle(
                            fontSize: 13,
                            color: cs.onSurfaceVariant,
                            height: 1.4)),
                  ],
                ),
              ),
              const SizedBox(width: 8),
              Icon(Icons.chevron_right_rounded,
                  color: cs.onSurfaceVariant, size: 20),
            ],
          ),
        ),
      ),
    );
  }
}

// ─── Page: Image Upload ───────────────────────────────────────────────────────

class _ImageUploadPage extends StatelessWidget {
  final bool hasImage;
  final String? pickedImagePath;
  final VoidCallback onPickCamera;
  final VoidCallback onPickGallery;
  final VoidCallback onScan;
  final VoidCallback onBack;

  const _ImageUploadPage({
    super.key,
    required this.hasImage,
    this.pickedImagePath,
    required this.onPickCamera,
    required this.onPickGallery,
    required this.onScan,
    required this.onBack,
  });

  @override
  Widget build(BuildContext context) {
    final cs    = Theme.of(context).colorScheme;
    final amina = Theme.of(context).extension<AminaColors>()!;
    return Padding(
      padding: const EdgeInsets.fromLTRB(20, 12, 20, 32),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // ── Header ─────────────────────────────────────────────────────────
          Row(children: [
            Container(
              width: 40,
              height: 40,
              decoration: const BoxDecoration(
                  color: _kBlueBg, shape: BoxShape.circle),
              child: const Icon(Icons.add_a_photo_outlined,
                  color: _kBlue, size: 21),
            ),
            const SizedBox(width: 12),
            Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text('Upload Prescription',
                    style: TextStyle(
                        fontSize: 20,
                        fontWeight: FontWeight.w700,
                        color: cs.onSurface,
                        letterSpacing: -0.3)),
                Text('Add a clear photo of your prescription',
                    style: TextStyle(fontSize: 13, color: cs.onSurfaceVariant)),
              ],
            ),
          ]),

          const SizedBox(height: 20),

          // ── Upload zone ────────────────────────────────────────────────────
          AnimatedSwitcher(
            duration: const Duration(milliseconds: 280),
            switchInCurve: Curves.easeOut,
            child: hasImage
                ? _ImagePreview(
                    key:       const ValueKey('preview'),
                    imagePath: pickedImagePath,
                    onCamera:  onPickCamera,
                    onGallery: onPickGallery,
                  )
                : _UploadZone(key: const ValueKey('empty'), onTap: onPickGallery),
          ),

          const SizedBox(height: 16),

          // ── Picker buttons ─────────────────────────────────────────────────
          Row(children: [
            Expanded(
              child: _PickerButton(
                icon:  Icons.camera_alt_outlined,
                label: 'Take Photo',
                onTap: onPickCamera,
              ),
            ),
            const SizedBox(width: 12),
            Expanded(
              child: _PickerButton(
                icon:  Icons.photo_library_outlined,
                label: 'Choose from Gallery',
                onTap: onPickGallery,
              ),
            ),
          ]),

          const SizedBox(height: 8),

          // Tips text
          Center(
            child: Text(
              'Make sure the text is clear and well-lit',
              style: TextStyle(
                  fontSize: 12,
                  color: cs.onSurfaceVariant.withValues(alpha: 0.7)),
            ),
          ),

          const SizedBox(height: 24),

          // ── Scan button ────────────────────────────────────────────────────
          SizedBox(
            width: double.infinity,
            height: 54,
            child: ElevatedButton.icon(
              onPressed: hasImage ? onScan : null,
              style: ElevatedButton.styleFrom(
                backgroundColor: _kBlue,
                disabledBackgroundColor: amina.cardBorder,
                foregroundColor: Colors.white,
                disabledForegroundColor: cs.onSurfaceVariant,
                elevation: 0,
                shape: RoundedRectangleBorder(
                    borderRadius: BorderRadius.circular(16)),
              ),
              icon: const Icon(Icons.document_scanner_rounded, size: 20),
              label: Text(
                hasImage ? 'Scan Prescription' : 'Add an image first',
                style: const TextStyle(
                    fontSize: 16, fontWeight: FontWeight.w600),
              ),
            ),
          ),

          const SizedBox(height: 10),

          Center(
            child: TextButton(
              onPressed: onBack,
              child: Text('Back',
                  style: TextStyle(color: cs.onSurfaceVariant, fontSize: 15)),
            ),
          ),
        ],
      ),
    );
  }
}

/// Dashed empty upload zone shown before an image is selected.
class _UploadZone extends StatelessWidget {
  final VoidCallback onTap;
  const _UploadZone({super.key, required this.onTap});

  @override
  Widget build(BuildContext context) {
    final cs    = Theme.of(context).colorScheme;
    final amina = Theme.of(context).extension<AminaColors>()!;
    return GestureDetector(
      onTap: onTap,
      child: Container(
        width: double.infinity,
        height: 180,
        decoration: BoxDecoration(
          color: amina.inputFill,
          borderRadius: BorderRadius.circular(18),
          border: Border.all(
            color: _kBlue.withValues(alpha: 0.35),
            width: 1.5,
          ),
        ),
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Container(
              width: 60,
              height: 60,
              decoration: const BoxDecoration(
                  color: _kBlueBg, shape: BoxShape.circle),
              child: const Icon(Icons.add_photo_alternate_outlined,
                  color: _kBlue, size: 28),
            ),
            const SizedBox(height: 14),
            const Text('Tap to add image',
                style: TextStyle(
                    fontSize: 15,
                    fontWeight: FontWeight.w600,
                    color: _kBlue)),
            const SizedBox(height: 4),
            Text('JPG, PNG or HEIC',
                style: TextStyle(
                    fontSize: 12,
                    color: cs.onSurfaceVariant.withValues(alpha: 0.7))),
          ],
        ),
      ),
    );
  }
}

class _ImagePreview extends StatelessWidget {
  final String? imagePath;
  final VoidCallback onCamera;
  final VoidCallback onGallery;
  const _ImagePreview({
    super.key,
    this.imagePath,
    required this.onCamera,
    required this.onGallery,
  });

  void _showReplaceOptions(BuildContext context) {
    showModalBottomSheet<void>(
      context: context,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(20)),
      ),
      builder: (_) => SafeArea(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const SizedBox(height: 8),
            ListTile(
              leading: const Icon(Icons.camera_alt_outlined, color: _kBlue),
              title: const Text('Take New Photo'),
              onTap: () { Navigator.pop(context); onCamera(); },
            ),
            ListTile(
              leading: const Icon(Icons.photo_library_outlined, color: _kBlue),
              title: const Text('Choose from Gallery'),
              onTap: () { Navigator.pop(context); onGallery(); },
            ),
            const SizedBox(height: 8),
          ],
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Stack(
      children: [
        Container(
          width: double.infinity,
          height: 180,
          clipBehavior: Clip.hardEdge,
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(18),
            border: Border.all(color: _kBlue.withValues(alpha: 0.4)),
          ),
          child: imagePath != null
              ? Image.file(
                  File(imagePath!),
                  fit: BoxFit.cover,
                  width: double.infinity,
                  height: 180,
                )
              : Container(
                  decoration: const BoxDecoration(
                    gradient: LinearGradient(
                      begin: Alignment.topLeft,
                      end: Alignment.bottomRight,
                      colors: [Color(0xFFDBEAFE), Color(0xFFEFF6FF)],
                    ),
                  ),
                  child: Column(
                    mainAxisAlignment: MainAxisAlignment.center,
                    children: [
                      const Icon(Icons.description_outlined,
                          color: _kBlue, size: 48),
                      const SizedBox(height: 10),
                      const Text('Ready to scan',
                          style: TextStyle(
                              fontSize: 13,
                              fontWeight: FontWeight.w500,
                              color: _kBlue)),
                    ],
                  ),
                ),
        ),

        // Success checkmark badge
        Positioned(
          top: 12,
          right: 12,
          child: Container(
            width: 32,
            height: 32,
            decoration: BoxDecoration(
                color: Theme.of(context).colorScheme.primary, shape: BoxShape.circle),
            child: const Icon(Icons.check_rounded,
                color: Colors.white, size: 18),
          ),
        ),

        // Replace button
        Positioned(
          bottom: 10,
          right: 10,
          child: GestureDetector(
            onTap: () => _showReplaceOptions(context),
            child: Container(
              padding: const EdgeInsets.symmetric(
                  horizontal: 12, vertical: 6),
              decoration: BoxDecoration(
                color: Theme.of(context).colorScheme.surface,
                borderRadius: BorderRadius.circular(20),
                border: Border.all(color: Theme.of(context).extension<AminaColors>()!.cardBorder),
                boxShadow: [
                  BoxShadow(
                    color: Colors.black.withValues(alpha: 0.08),
                    blurRadius: 6,
                  ),
                ],
              ),
              child: Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Icon(Icons.swap_horiz_rounded,
                      size: 14, color: Theme.of(context).colorScheme.onSurfaceVariant),
                  const SizedBox(width: 4),
                  Text('Replace',
                      style: TextStyle(
                          fontSize: 12,
                          color: Theme.of(context).colorScheme.onSurfaceVariant,
                          fontWeight: FontWeight.w500)),
                ],
              ),
            ),
          ),
        ),
      ],
    );
  }
}

class _PickerButton extends StatelessWidget {
  final IconData icon;
  final String label;
  final VoidCallback onTap;
  const _PickerButton({
    required this.icon,
    required this.label,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    final cs    = Theme.of(context).colorScheme;
    final amina = Theme.of(context).extension<AminaColors>()!;
    return Material(
      color: cs.surface,
      borderRadius: BorderRadius.circular(14),
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(14),
        child: Container(
          padding: const EdgeInsets.symmetric(vertical: 14),
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(14),
            border: Border.all(color: amina.cardBorder),
          ),
          child: Column(
            children: [
              Icon(icon, color: _kBlue, size: 24),
              const SizedBox(height: 6),
              Text(label,
                  textAlign: TextAlign.center,
                  style: TextStyle(
                      fontSize: 12,
                      fontWeight: FontWeight.w500,
                      color: cs.onSurface)),
            ],
          ),
        ),
      ),
    );
  }
}

// ─── Page: Scanning ───────────────────────────────────────────────────────────

class _ScanningPage extends StatelessWidget {
  const _ScanningPage({super.key});

  @override
  Widget build(BuildContext context) {
    final cs = Theme.of(context).colorScheme;
    return Padding(
      padding: const EdgeInsets.fromLTRB(20, 24, 20, 48),
      child: Column(
        children: [
          Container(
            width: 80,
            height: 80,
            decoration: const BoxDecoration(
                color: _kBlueBg, shape: BoxShape.circle),
            child: const Icon(Icons.document_scanner_rounded,
                color: _kBlue, size: 40),
          ),
          const SizedBox(height: 24),
          Text('Scanning prescription…',
              style: TextStyle(
                  fontSize: 20,
                  fontWeight: FontWeight.w700,
                  color: cs.onSurface)),
          const SizedBox(height: 8),
          Text(
            'Our AI is reading your prescription.\nThis takes just a moment.',
            textAlign: TextAlign.center,
            style: TextStyle(
                fontSize: 15, color: cs.onSurfaceVariant, height: 1.5),
          ),
          const SizedBox(height: 32),
          const SizedBox(
            width: 40,
            height: 40,
            child: CircularProgressIndicator(
              color: _kBlue,
              strokeWidth: 3,
            ),
          ),
        ],
      ),
    );
  }
}

// ─── Page: Scan Result (editable) ────────────────────────────────────────────

/// Shows the AI-extracted fields pre-filled and fully editable.
/// The user can correct any mistakes before saving.
class _ScanResultFormPage extends StatelessWidget {
  final GlobalKey<FormState> formKey;
  final TextEditingController nameCtrl;
  final TextEditingController dosageCtrl;
  final TextEditingController durationCtrl;
  final TextEditingController notesCtrl;
  final String? frequency;
  final bool showFrequencyError;
  final ValueChanged<String> onFrequencyChanged;
  final VoidCallback onSave;
  final VoidCallback onRescan;

  const _ScanResultFormPage({
    super.key,
    required this.formKey,
    required this.nameCtrl,
    required this.dosageCtrl,
    required this.durationCtrl,
    required this.notesCtrl,
    required this.frequency,
    required this.showFrequencyError,
    required this.onFrequencyChanged,
    required this.onSave,
    required this.onRescan,
  });

  @override
  Widget build(BuildContext context) {
    final cs    = Theme.of(context).colorScheme;
    final amina = Theme.of(context).extension<AminaColors>()!;
    return Padding(
      padding: const EdgeInsets.fromLTRB(20, 12, 20, 32),
      child: Form(
        key: formKey,
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            // ── Header ───────────────────────────────────────────────────────
            Row(children: [
              Container(
                width: 40,
                height: 40,
                decoration: BoxDecoration(
                    color: cs.primaryContainer, shape: BoxShape.circle),
                child: Icon(Icons.fact_check_outlined,
                    color: cs.primary, size: 22),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text('Scan Complete — Verify Details',
                        style: TextStyle(
                            fontSize: 19,
                            fontWeight: FontWeight.w700,
                            color: cs.onSurface,
                            letterSpacing: -0.3)),
                    Text('Review and edit if anything looks wrong',
                        style: TextStyle(fontSize: 13, color: cs.onSurfaceVariant)),
                  ],
                ),
              ),
            ]),

            const SizedBox(height: 14),

            // AI accuracy note
            Container(
              padding: const EdgeInsets.symmetric(
                  horizontal: 14, vertical: 11),
              decoration: BoxDecoration(
                color: _kBlueBg,
                borderRadius: BorderRadius.circular(14),
                border: Border.all(
                    color: _kBlue.withValues(alpha: 0.3)),
              ),
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const Icon(Icons.auto_awesome_rounded,
                      color: _kBlue, size: 18),
                  const SizedBox(width: 10),
                  Expanded(
                    child: Text(
                      'AI extracted these details from your image. '
                      'Please review each field carefully — tap any '
                      'field to correct it before saving.',
                      style: TextStyle(
                          fontSize: 13,
                          color: _kBlue.withValues(alpha: 0.85),
                          height: 1.45),
                    ),
                  ),
                ],
              ),
            ),

            const SizedBox(height: 16),
            const _DisclaimerBanner(),
            const SizedBox(height: 20),

            // ── Medication Name ──────────────────────────────────────────────
            _FormLabel('Medication Name'),
            const SizedBox(height: 8),
            _RxField(
              controller: nameCtrl,
              hint: 'e.g. Metformin',
              icon: Icons.medication_outlined,
              validator: (v) => (v == null || v.trim().isEmpty)
                  ? 'Medication name is required.'
                  : null,
            ),

            const SizedBox(height: 16),

            // ── Dosage ───────────────────────────────────────────────────────
            _FormLabel('Dosage'),
            const SizedBox(height: 8),
            _RxField(
              controller: dosageCtrl,
              hint: 'e.g. 500 mg',
              icon: Icons.scale_outlined,
              validator: (v) => (v == null || v.trim().isEmpty)
                  ? 'Dosage is required.'
                  : null,
            ),

            const SizedBox(height: 16),

            // ── Frequency ────────────────────────────────────────────────────
            _FormLabel('Frequency'),
            const SizedBox(height: 4),
            Text('How often should this medication be taken?',
                style: TextStyle(
                    fontSize: 12,
                    color: cs.onSurfaceVariant.withValues(alpha: 0.8))),
            const SizedBox(height: 10),
            Wrap(
              spacing: 8,
              runSpacing: 8,
              children: _frequencies
                  .map((f) => _FrequencyChip(
                        label:    f,
                        selected: frequency == f,
                        onTap:    () => onFrequencyChanged(f),
                      ))
                  .toList(),
            ),
            if (showFrequencyError)
              Padding(
                padding: const EdgeInsets.only(top: 6),
                child: Text('Please select a frequency.',
                    style: TextStyle(
                        color: Colors.red.shade600, fontSize: 12)),
              ),

            const SizedBox(height: 16),

            // ── Duration ─────────────────────────────────────────────────────
            _FormLabel('Duration'),
            const SizedBox(height: 8),
            _RxField(
              controller: durationCtrl,
              hint: 'e.g. 7 days, 1 month, Ongoing',
              icon: Icons.calendar_month_outlined,
              validator: (v) => (v == null || v.trim().isEmpty)
                  ? 'Duration is required.'
                  : null,
            ),

            const SizedBox(height: 16),

            // ── Additional Notes ─────────────────────────────────────────────
            _FormLabel('Additional Notes'),
            const SizedBox(height: 4),
            Text('Optional — e.g. "Take with food"',
                style: TextStyle(
                    fontSize: 12,
                    color: cs.onSurfaceVariant.withValues(alpha: 0.8))),
            const SizedBox(height: 8),
            TextFormField(
              controller: notesCtrl,
              maxLines: 3,
              minLines: 2,
              style: TextStyle(fontSize: 16, color: cs.onSurface),
              decoration: InputDecoration(
                hintText: 'Any special instructions from your doctor…',
                hintStyle: TextStyle(
                    color: cs.onSurfaceVariant.withValues(alpha: 0.6),
                    fontSize: 14),
                filled: true,
                fillColor: amina.inputFill,
                contentPadding: const EdgeInsets.symmetric(
                    horizontal: 16, vertical: 14),
                border: OutlineInputBorder(
                  borderRadius: BorderRadius.circular(14),
                  borderSide: BorderSide(color: amina.cardBorder),
                ),
                enabledBorder: OutlineInputBorder(
                  borderRadius: BorderRadius.circular(14),
                  borderSide: BorderSide(color: amina.cardBorder),
                ),
                focusedBorder: OutlineInputBorder(
                  borderRadius: BorderRadius.circular(14),
                  borderSide: BorderSide(color: cs.primary, width: 1.5),
                ),
              ),
            ),

            const SizedBox(height: 28),

            // ── Save button ──────────────────────────────────────────────────
            SizedBox(
              width: double.infinity,
              height: 54,
              child: ElevatedButton.icon(
                onPressed: onSave,
                style: ElevatedButton.styleFrom(
                  backgroundColor: cs.primary,
                  foregroundColor: Colors.white,
                  elevation: 0,
                  shape: RoundedRectangleBorder(
                      borderRadius: BorderRadius.circular(16)),
                ),
                icon: const Icon(Icons.save_outlined, size: 20),
                label: const Text('Save Prescription',
                    style: TextStyle(
                        fontSize: 16, fontWeight: FontWeight.w600)),
              ),
            ),

            const SizedBox(height: 10),

            // ── Rescan button ────────────────────────────────────────────────
            SizedBox(
              width: double.infinity,
              height: 48,
              child: TextButton.icon(
                onPressed: onRescan,
                icon: Icon(Icons.refresh_rounded,
                    color: cs.onSurfaceVariant, size: 18),
                label: Text('Scan Again',
                    style:
                        TextStyle(color: cs.onSurfaceVariant, fontSize: 15)),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

// ─── Page: Manual form ────────────────────────────────────────────────────────

class _ManualFormPage extends StatelessWidget {
  final GlobalKey<FormState> formKey;
  final TextEditingController nameCtrl;
  final TextEditingController dosageCtrl;
  final TextEditingController durationCtrl;
  final TextEditingController notesCtrl;
  final String? frequency;
  final bool showFrequencyError;
  final ValueChanged<String> onFrequencyChanged;
  final VoidCallback onSubmit;

  const _ManualFormPage({
    super.key,
    required this.formKey,
    required this.nameCtrl,
    required this.dosageCtrl,
    required this.durationCtrl,
    required this.notesCtrl,
    required this.frequency,
    required this.showFrequencyError,
    required this.onFrequencyChanged,
    required this.onSubmit,
  });

  @override
  Widget build(BuildContext context) {
    final cs    = Theme.of(context).colorScheme;
    final amina = Theme.of(context).extension<AminaColors>()!;
    return Padding(
      padding: const EdgeInsets.fromLTRB(20, 12, 20, 32),
      child: Form(
        key: formKey,
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            // Header
            Row(children: [
              Container(
                width: 40,
                height: 40,
                decoration: BoxDecoration(
                    color: cs.primaryContainer, shape: BoxShape.circle),
                child: Icon(Icons.edit_note_rounded,
                    color: cs.primary, size: 22),
              ),
              const SizedBox(width: 12),
              Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text('Enter Prescription',
                      style: TextStyle(
                          fontSize: 20,
                          fontWeight: FontWeight.w700,
                          color: cs.onSurface)),
                  Text('Fill in all fields carefully',
                      style: TextStyle(fontSize: 13, color: cs.onSurfaceVariant)),
                ],
              ),
            ]),

            const SizedBox(height: 16),
            const _DisclaimerBanner(),
            const SizedBox(height: 20),

            // ── Medication Name ────────────────────────────────────────────
            _FormLabel('Medication Name'),
            const SizedBox(height: 8),
            _RxField(
              controller: nameCtrl,
              hint: 'e.g. Metformin',
              icon: Icons.medication_outlined,
              validator: (v) => (v == null || v.trim().isEmpty)
                  ? 'Medication name is required.'
                  : null,
            ),

            const SizedBox(height: 16),

            // ── Dosage ────────────────────────────────────────────────────
            _FormLabel('Dosage'),
            const SizedBox(height: 8),
            _RxField(
              controller: dosageCtrl,
              hint: 'e.g. 500 mg',
              icon: Icons.scale_outlined,
              validator: (v) => (v == null || v.trim().isEmpty)
                  ? 'Dosage is required.'
                  : null,
            ),

            const SizedBox(height: 16),

            // ── Frequency ─────────────────────────────────────────────────
            _FormLabel('Frequency'),
            const SizedBox(height: 4),
            Text('How often should this medication be taken?',
                style: TextStyle(
                    fontSize: 12,
                    color: cs.onSurfaceVariant.withValues(alpha: 0.8))),
            const SizedBox(height: 10),
            Wrap(
              spacing: 8,
              runSpacing: 8,
              children: _frequencies
                  .map((f) => _FrequencyChip(
                        label:    f,
                        selected: frequency == f,
                        onTap:    () => onFrequencyChanged(f),
                      ))
                  .toList(),
            ),
            if (showFrequencyError)
              Padding(
                padding: const EdgeInsets.only(top: 6),
                child: Text('Please select a frequency.',
                    style: TextStyle(
                        color: Colors.red.shade600, fontSize: 12)),
              ),

            const SizedBox(height: 16),

            // ── Duration ──────────────────────────────────────────────────
            _FormLabel('Duration'),
            const SizedBox(height: 8),
            _RxField(
              controller: durationCtrl,
              hint: 'e.g. 7 days, 1 month, Ongoing',
              icon: Icons.calendar_month_outlined,
              validator: (v) => (v == null || v.trim().isEmpty)
                  ? 'Duration is required.'
                  : null,
            ),

            const SizedBox(height: 16),

            // ── Additional Notes ──────────────────────────────────────────
            _FormLabel('Additional Notes'),
            const SizedBox(height: 4),
            Text('Optional — e.g. "Take with food"',
                style: TextStyle(
                    fontSize: 12,
                    color: cs.onSurfaceVariant.withValues(alpha: 0.8))),
            const SizedBox(height: 8),
            TextFormField(
              controller: notesCtrl,
              maxLines: 3,
              minLines: 2,
              style: TextStyle(fontSize: 16, color: cs.onSurface),
              decoration: InputDecoration(
                hintText: 'Any special instructions from your doctor…',
                hintStyle: TextStyle(
                    color: cs.onSurfaceVariant.withValues(alpha: 0.6),
                    fontSize: 14),
                filled: true,
                fillColor: amina.inputFill,
                contentPadding: const EdgeInsets.symmetric(
                    horizontal: 16, vertical: 14),
                border: OutlineInputBorder(
                  borderRadius: BorderRadius.circular(14),
                  borderSide: BorderSide(color: amina.cardBorder),
                ),
                enabledBorder: OutlineInputBorder(
                  borderRadius: BorderRadius.circular(14),
                  borderSide: BorderSide(color: amina.cardBorder),
                ),
                focusedBorder: OutlineInputBorder(
                  borderRadius: BorderRadius.circular(14),
                  borderSide: BorderSide(color: cs.primary, width: 1.5),
                ),
              ),
            ),

            const SizedBox(height: 28),

            // ── Save button ───────────────────────────────────────────────
            SizedBox(
              width: double.infinity,
              height: 54,
              child: ElevatedButton.icon(
                onPressed: onSubmit,
                style: ElevatedButton.styleFrom(
                  backgroundColor: cs.primary,
                  foregroundColor: Colors.white,
                  elevation: 0,
                  shape: RoundedRectangleBorder(
                      borderRadius: BorderRadius.circular(16)),
                ),
                icon: const Icon(Icons.save_outlined, size: 20),
                label: const Text('Save Prescription',
                    style: TextStyle(
                        fontSize: 16, fontWeight: FontWeight.w600)),
              ),
            ),

            const SizedBox(height: 10),

            Center(
              child: TextButton(
                onPressed: () => Navigator.of(context).pop(),
                child: Text('Cancel',
                    style: TextStyle(color: cs.onSurfaceVariant, fontSize: 15)),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

// ─── Shared sub-widgets ───────────────────────────────────────────────────────

/// Prominent amber disclaimer shown on every entry page.
class _DisclaimerBanner extends StatelessWidget {
  const _DisclaimerBanner();

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
      decoration: BoxDecoration(
        color: const Color(0xFFFFFBEB),
        borderRadius: BorderRadius.circular(14),
        border: Border.all(
            color: const Color(0xFFF59E0B).withValues(alpha: 0.5)),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Icon(Icons.health_and_safety_outlined,
              color: Color(0xFFB45309), size: 20),
          const SizedBox(width: 10),
          const Expanded(
            child: Text(
              'Medical Disclaimer: The details you enter must '
              'exactly match your official prescription from your '
              'doctor. Amina Care does not replace professional '
              'medical advice.',
              style: TextStyle(
                fontSize: 13,
                color: Color(0xFF92400E),
                height: 1.45,
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _FormLabel extends StatelessWidget {
  final String text;
  const _FormLabel(this.text);

  @override
  Widget build(BuildContext context) => Text(
        text,
        style: TextStyle(
          fontSize: 15,
          fontWeight: FontWeight.w600,
          color: Theme.of(context).colorScheme.onSurface,
        ),
      );
}

class _RxField extends StatelessWidget {
  final TextEditingController controller;
  final String hint;
  final IconData icon;
  final String? Function(String?)? validator;

  const _RxField({
    required this.controller,
    required this.hint,
    required this.icon,
    this.validator,
  });

  @override
  Widget build(BuildContext context) {
    final cs    = Theme.of(context).colorScheme;
    final amina = Theme.of(context).extension<AminaColors>()!;
    return TextFormField(
      controller: controller,
      validator: validator,
      autovalidateMode: AutovalidateMode.onUserInteraction,
      style: TextStyle(fontSize: 16, color: cs.onSurface),
      decoration: InputDecoration(
        hintText: hint,
        hintStyle: TextStyle(
            color: cs.onSurfaceVariant.withValues(alpha: 0.6), fontSize: 14),
        prefixIcon: Icon(icon, color: cs.primary, size: 20),
        filled: true,
        fillColor: amina.inputFill,
        contentPadding:
            const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
        border: OutlineInputBorder(
          borderRadius: BorderRadius.circular(14),
          borderSide: BorderSide(color: amina.cardBorder),
        ),
        enabledBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(14),
          borderSide: BorderSide(color: amina.cardBorder),
        ),
        focusedBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(14),
          borderSide: BorderSide(color: cs.primary, width: 1.5),
        ),
        errorBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(14),
          borderSide: const BorderSide(color: Colors.redAccent),
        ),
        focusedErrorBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(14),
          borderSide:
              const BorderSide(color: Colors.redAccent, width: 1.5),
        ),
      ),
    );
  }
}

class _FrequencyChip extends StatelessWidget {
  final String label;
  final bool selected;
  final VoidCallback onTap;
  const _FrequencyChip({
    required this.label,
    required this.selected,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    final cs    = Theme.of(context).colorScheme;
    final amina = Theme.of(context).extension<AminaColors>()!;
    return GestureDetector(
      onTap: onTap,
      child: AnimatedContainer(
        duration: const Duration(milliseconds: 180),
        padding:
            const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
        decoration: BoxDecoration(
          color: selected ? cs.primary : cs.surface,
          borderRadius: BorderRadius.circular(12),
          border: Border.all(color: selected ? cs.primary : amina.cardBorder),
        ),
        child: Text(
          label,
          style: TextStyle(
            fontSize: 14,
            fontWeight:
                selected ? FontWeight.w600 : FontWeight.normal,
            color: selected ? Colors.white : cs.onSurface,
          ),
        ),
      ),
    );
  }
}

// ─── Prompt row ───────────────────────────────────────────────────────────────

class _PromptRow extends StatelessWidget {
  final List<(String, String, String)> prompts;
  final ValueChanged<String>           onTap;

  const _PromptRow({required this.prompts, required this.onTap});

  @override
  Widget build(BuildContext context) {
    return Row(
      children: [
        for (int i = 0; i < prompts.length; i++) ...[
          if (i > 0) const SizedBox(width: 8),
          Expanded(child: _PromptChip(prompt: prompts[i], onTap: onTap)),
        ],
      ],
    );
  }
}

class _PromptChip extends StatelessWidget {
  final (String, String, String) prompt;
  final ValueChanged<String>     onTap;

  const _PromptChip({required this.prompt, required this.onTap});

  @override
  Widget build(BuildContext context) {
    final cs    = Theme.of(context).colorScheme;
    final amina = Theme.of(context).extension<AminaColors>()!;
    final (emoji, label, fullPrompt) = prompt;
    return GestureDetector(
      onTap: () => onTap(fullPrompt),
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 10),
        decoration: BoxDecoration(
          color:        cs.surface,
          borderRadius: BorderRadius.circular(14),
          border:       Border.all(color: amina.cardBorder),
        ),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Text(emoji, style: const TextStyle(fontSize: 20)),
            const SizedBox(height: 5),
            Text(
              label,
              textAlign: TextAlign.center,
              maxLines:  2,
              overflow:  TextOverflow.ellipsis,
              style: TextStyle(
                fontSize:   11,
                fontWeight: FontWeight.w500,
                color:      cs.onSurface,
                height:     1.3,
              ),
            ),
          ],
        ),
      ),
    );
  }
}

// ─── Convenience function ─────────────────────────────────────────────────────

/// Open the prescription sheet from any [BuildContext].
///
/// Pass [medicationOnly] = true from contexts where chat prompts are
/// irrelevant (e.g. the Me tab medications section).
void showRxEntrySheet(BuildContext context, {bool medicationOnly = false}) {
  showModalBottomSheet(
    context: context,
    isScrollControlled: true,
    backgroundColor: Theme.of(context).colorScheme.surface,
    shape: const RoundedRectangleBorder(
      borderRadius: BorderRadius.vertical(top: Radius.circular(28)),
    ),
    builder: (_) => RxEntrySheet(medicationOnly: medicationOnly),
  );
}
