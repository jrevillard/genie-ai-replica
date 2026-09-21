import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:http/http.dart' as http;
import 'package:printing/printing.dart';

import 'package:genie_ai_mobile/design_system/components/ds_button.dart';
import 'package:genie_ai_mobile/design_system/tokens/spacing.dart';
import 'package:genie_ai_mobile/services/i18n_service.dart';
import 'package:genie_ai_mobile/utils/theme_manager.dart';
import 'package:genie_ai_mobile/utils/zoom_matrix.dart';

/// In-app viewer for the drought PDF behind the alert banner's "View drought
/// report" link and the same link inside assistant replies (web: the anchor
/// opens the PDF in a new browser tab).
///
/// The file is fetched through the app's own HTTP client rather than handed
/// to an external browser: the pilot server's self-signed certificate and a
/// missing PDF handler both made the external route fail silently. Pages are
/// rasterised once and shown on a zoomable canvas: pinch, or the zoom in /
/// zoom out / fit-width buttons.
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

/// One rasterised page: PNG bytes plus its pixel size (for layout).
class _Page {
  final Uint8List png;
  final int width;
  final int height;
  const _Page(this.png, this.width, this.height);
}

class _Report {
  final Uint8List pdf;
  final List<_Page> pages;
  const _Report(this.pdf, this.pages);
}

class _DroughtReportScreenState extends State<DroughtReportScreen> {
  static const double _minScale = 1;
  static const double _maxScale = 4;
  static const double _step = 1.5;
  // Crisp at 2x on a typical phone without decoding tens of MB per page.
  static const double _rasterDpi = 160;

  late Future<_Report> _report = _load();
  final TransformationController _transform = TransformationController();

  Future<_Report> _load() async {
    final resp = await widget.client
        .get(
          Uri.parse(widget.url),
          headers: const {'Accept': 'application/pdf'},
        )
        .timeout(const Duration(seconds: 20));
    if (resp.statusCode != 200 || resp.bodyBytes.isEmpty) {
      throw Exception('report ${resp.statusCode}');
    }
    final pages = <_Page>[];
    await for (final raster in Printing.raster(
      resp.bodyBytes,
      dpi: _rasterDpi,
    )) {
      pages.add(_Page(await raster.toPng(), raster.width, raster.height));
    }
    if (pages.isEmpty) throw Exception('report has no pages');
    return _Report(resp.bodyBytes, pages);
  }

  @override
  void dispose() {
    _transform.dispose();
    super.dispose();
  }

  /// Total laid-out height of the pages at [width] (fit-to-width) plus gaps.
  double _contentHeight(List<_Page> pages, double width) {
    var h = 0.0;
    for (final p in pages) {
      h += p.height * (width / p.width) + DsSpacing.sm;
    }
    return h;
  }

  void _zoom(double factor, Size viewport, Size content) {
    setState(() {
      _transform.value = zoomAbout(
        _transform.value,
        factor,
        viewport: viewport,
        content: content,
        minScale: _minScale,
        maxScale: _maxScale,
      );
    });
  }

  @override
  Widget build(BuildContext context) {
    final tokens = ThemeManager().tokens;
    return Scaffold(
      backgroundColor: tokens.bg,
      appBar: AppBar(
        backgroundColor: tokens.navbarBg,
        foregroundColor: tokens.navbarFg,
        title: Text(tr('cropAlert.viewDroughtReport')),
        actions: [
          FutureBuilder<_Report>(
            future: _report,
            builder: (context, snap) => IconButton(
              key: const Key('drought_report_share'),
              icon: const Icon(Icons.share_outlined),
              tooltip: tr('common.share'),
              onPressed: snap.hasData
                  ? () => Printing.sharePdf(
                      bytes: snap.data!.pdf,
                      filename: widget.filename,
                    )
                  : null,
            ),
          ),
        ],
      ),
      body: FutureBuilder<_Report>(
        future: _report,
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
                      onPressed: () => setState(() => _report = _load()),
                    ),
                  ],
                ),
              ),
            );
          }
          final pages = snap.data!.pages;
          return LayoutBuilder(
            builder: (context, constraints) {
              final viewport = Size(
                constraints.maxWidth,
                constraints.maxHeight,
              );
              final content = Size(
                viewport.width,
                _contentHeight(pages, viewport.width),
              );
              final scale = scaleOf(_transform.value);
              return Stack(
                children: [
                  // constrained: false lets the page column be taller than the
                  // view, so one-finger drags pan (scroll) and pinch zooms
                  // through a single gesture owner - no nested scroll fights.
                  InteractiveViewer(
                    key: const Key('drought_report_pages'),
                    transformationController: _transform,
                    constrained: false,
                    boundaryMargin: EdgeInsets.zero,
                    minScale: _minScale,
                    maxScale: _maxScale,
                    onInteractionEnd: (_) => setState(() {}),
                    child: SizedBox(
                      width: viewport.width,
                      child: Column(
                        children: [
                          for (final p in pages)
                            Padding(
                              padding: const EdgeInsets.only(
                                bottom: DsSpacing.sm,
                              ),
                              child: Image.memory(
                                p.png,
                                width: viewport.width,
                                fit: BoxFit.fitWidth,
                                gaplessPlayback: true,
                              ),
                            ),
                        ],
                      ),
                    ),
                  ),
                  Positioned(
                    right: DsSpacing.md,
                    bottom: DsSpacing.md,
                    child: Column(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        FloatingActionButton.small(
                          key: const Key('drought_report_zoom_in'),
                          heroTag: null,
                          tooltip: tr('common.zoomIn'),
                          onPressed: scale < _maxScale
                              ? () => _zoom(_step, viewport, content)
                              : null,
                          child: const Icon(Icons.add),
                        ),
                        const SizedBox(height: DsSpacing.sm),
                        FloatingActionButton.small(
                          key: const Key('drought_report_zoom_out'),
                          heroTag: null,
                          tooltip: tr('common.zoomOut'),
                          onPressed: scale > _minScale
                              ? () => _zoom(1 / _step, viewport, content)
                              : null,
                          child: const Icon(Icons.remove),
                        ),
                        const SizedBox(height: DsSpacing.sm),
                        FloatingActionButton.small(
                          key: const Key('drought_report_zoom_reset'),
                          heroTag: null,
                          tooltip: tr('common.fitWidth'),
                          onPressed: scale > _minScale
                              ? () => setState(
                                  () => _transform.value = Matrix4.identity(),
                                )
                              : null,
                          child: const Icon(Icons.fit_screen_outlined),
                        ),
                      ],
                    ),
                  ),
                ],
              );
            },
          );
        },
      ),
    );
  }
}
