import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:http/http.dart' as http;
import 'package:printing/printing.dart';

import 'package:genie_ai_mobile/design_system/components/ds_button.dart';
import 'package:genie_ai_mobile/design_system/tokens/spacing.dart';
import 'package:genie_ai_mobile/services/i18n_service.dart';
import 'package:genie_ai_mobile/utils/theme_manager.dart';

/// In-app viewer for the drought PDF behind the alert banner's "View drought
/// report" link (web: the link opens the PDF in a new browser tab).
///
/// The file is fetched through the app's own HTTP client rather than handed
/// to an external browser: the pilot server's self-signed certificate and a
/// missing PDF handler both made the external route fail silently.
class DroughtReportScreen extends StatefulWidget {
  final http.Client client;
  final String url;
  final String filename;

  const DroughtReportScreen({
    super.key,
    required this.client,
    required this.url,
    required this.filename,
  });

  static Future<void> open(
    BuildContext context, {
    required http.Client client,
    required String url,
    required String filename,
  }) {
    return Navigator.of(context).push(
      MaterialPageRoute<void>(
        builder: (_) =>
            DroughtReportScreen(client: client, url: url, filename: filename),
      ),
    );
  }

  @override
  State<DroughtReportScreen> createState() => _DroughtReportScreenState();
}

class _DroughtReportScreenState extends State<DroughtReportScreen> {
  late Future<Uint8List> _bytes = _fetch();

  Future<Uint8List> _fetch() async {
    final resp = await widget.client
        .get(
          Uri.parse(widget.url),
          headers: const {'Accept': 'application/pdf'},
        )
        .timeout(const Duration(seconds: 20));
    if (resp.statusCode != 200 || resp.bodyBytes.isEmpty) {
      throw Exception('report ${resp.statusCode}');
    }
    return resp.bodyBytes;
  }

  @override
  Widget build(BuildContext context) {
    final tokens = ThemeManager().tokens;
    return Scaffold(
      appBar: AppBar(
        backgroundColor: tokens.navbarBg,
        foregroundColor: tokens.navbarFg,
        title: Text(tr('cropAlert.viewDroughtReport')),
      ),
      body: FutureBuilder<Uint8List>(
        future: _bytes,
        builder: (context, snap) {
          if (snap.connectionState != ConnectionState.done) {
            return const Center(
              key: Key('drought_report_loading'),
              child: CircularProgressIndicator(),
            );
          }
          if (snap.hasError || snap.data == null) {
            return Center(
              key: const Key('drought_report_error'),
              child: Padding(
                padding: const EdgeInsets.all(DsSpacing.lg),
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Text(
                      tr('cropAlert.reportUnavailable'),
                      textAlign: TextAlign.center,
                      style: TextStyle(color: tokens.fg),
                    ),
                    const SizedBox(height: DsSpacing.md),
                    DsButton(
                      label: tr('common.retry'),
                      variant: DsButtonVariant.secondary,
                      onPressed: () => setState(() => _bytes = _fetch()),
                    ),
                  ],
                ),
              ),
            );
          }
          final bytes = snap.data!;
          return PdfPreview(
            key: const Key('drought_report_pdf'),
            build: (_) async => bytes,
            pdfFileName: widget.filename,
            canChangeOrientation: false,
            canChangePageFormat: false,
            canDebug: false,
            allowPrinting: false,
            allowSharing: true,
            useActions: true,
          );
        },
      ),
    );
  }
}
