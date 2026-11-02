// lib/components/chat/stub_file_utils.dart

import 'package:flutter/material.dart';

/// DUMMY implementation for Mobile/Desktop.
/// This function exists only to satisfy the compiler.
/// It will never be called at runtime because we check kIsWeb.
Future<void> openWebFile({
  required BuildContext context,
  required String fileId,
  required String accessToken,
  required Map<String, dynamic> docMetadata,
}) async {
  // No-op for mobile
  debugPrint("Mobile platform detected: Using native url launcher instead.");
}