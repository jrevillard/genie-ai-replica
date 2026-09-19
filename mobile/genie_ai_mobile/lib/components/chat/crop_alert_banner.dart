import 'dart:async';
import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:http/http.dart' as http;
import 'package:shared_preferences/shared_preferences.dart';
import 'package:url_launcher/url_launcher.dart';

import 'package:genie_ai_mobile/design_system/tokens/radii.dart';
import 'package:genie_ai_mobile/design_system/tokens/spacing.dart';
import 'package:genie_ai_mobile/services/i18n_service.dart';
import 'package:genie_ai_mobile/services/location_service.dart';
import 'package:genie_ai_mobile/utils/theme_manager.dart';

/// Early-warning banner above the chat (parity with the web CropAlertBanner):
/// the highest active crop / drought / flood risk for the user's district plus
/// notice cards for general / admin / official BMD broadcasts (the same
/// messages Android receives via FCM). Polls once a minute; every failure is
/// swallowed - the EWS must never break the chat.
class CropAlertBanner extends StatefulWidget {
  final http.Client client;
  final String backendUrl;
  final Duration pollInterval;

  const CropAlertBanner({
    super.key,
    required this.client,
    required this.backendUrl,
    this.pollInterval = const Duration(minutes: 1),
  });

  @override
  State<CropAlertBanner> createState() => _CropAlertBannerState();
}

class _CropAlertBannerState extends State<CropAlertBanner>
    with WidgetsBindingObserver {
  static const _noticeWindowHours = 48;
  static const _noticeDismissedKey = 'mewa_notices_dismissed';
  static const _dismissFor = Duration(hours: 12);
  // Engine alert broadcasts already appear as the risk card; everything else
  // (general, admin, official BMD) becomes a notice card.
  static final _engineAlertTypes = RegExp(r'^(weather_warning|[a-z]+_ews)$');
  static const _tierKeys = [
    'normal',
    'advisory',
    'warning',
    'severe',
    'emergency',
  ];

  Timer? _timer;
  // Active alerts, worst first: one per crop ('crop'), plus drought and flood
  // (web parity: CropAlertBanner.alerts).
  List<Map<String, dynamic>> _alerts = const [];
  List<Map<String, dynamic>> _notices = const [];
  List<String> _dismissedNotices = const [];
  SharedPreferences? _prefs;
  String _lastLocale = '';

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    LocationService().addListener(_poll);
    I18nService().addListener(_onLocaleChanged);
    _lastLocale = _uiLocale;
    _start();
  }

  Future<void> _start() async {
    _prefs = await SharedPreferences.getInstance();
    _dismissedNotices = _prefs?.getStringList(_noticeDismissedKey) ?? const [];
    await _poll();
    _timer = Timer.periodic(widget.pollInterval, (_) => _poll());
  }

  @override
  void dispose() {
    _timer?.cancel();
    WidgetsBinding.instance.removeObserver(this);
    LocationService().removeListener(_poll);
    I18nService().removeListener(_onLocaleChanged);
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed) _poll();
  }

  String get _uiLocale =>
      I18nService().currentLocale.languageCode.toLowerCase();

  void _onLocaleChanged() {
    if (_uiLocale != _lastLocale) {
      _lastLocale = _uiLocale;
      _poll();
    }
  }

  Future<Map<String, dynamic>?> _getJson(
    String path,
    Map<String, String> params,
  ) async {
    try {
      final uri = Uri.parse(
        '${widget.backendUrl}/api/$path',
      ).replace(queryParameters: params);
      final resp = await widget.client
          .get(uri, headers: const {'Accept': 'application/json'})
          .timeout(const Duration(seconds: 10));
      if (resp.statusCode != 200) return null;
      // Bengali payloads: decode the bytes as UTF-8 regardless of the charset
      // header a proxy may have dropped.
      final body = jsonDecode(utf8.decode(resp.bodyBytes));
      return body is Map ? Map<String, dynamic>.from(body) : null;
    } catch (_) {
      return null;
    }
  }

  Future<void> _poll() async {
    // Until the location is known, the district is only the built-in
    // placeholder (Dhaka): polling now would flash another district's
    // warnings behind the permission prompts. LocationService notifies once
    // it has settled, which re-enters here (web parity: resolveDistrict()
    // completes before the first poll).
    if (!LocationService().hasResolvedDistrict) return;
    final location = LocationService().district;
    final lang = _uiLocale;
    final results = await Future.wait([
      _getJson('weather/potato-risk', {'location': location, 'lang': lang}),
      _getJson('weather/drought-risk', {'location': location, 'lang': lang}),
      _getJson('notifications/latest', {
        'district': location,
        'hours': '$_noticeWindowHours',
        'limit': '3',
      }),
      _getJson('weather/flood-risk', {'location': location, 'lang': lang}),
    ]);
    if (!mounted) return;

    final potato = results[0];
    final drought = results[1];
    final noticesBody = results[2];
    final flood = results[3];

    List<Map<String, dynamic>> notices = _notices;
    final list = noticesBody?['notices'];
    if (list is List) {
      notices = list
          .whereType<Map>()
          .map((n) => Map<String, dynamic>.from(n))
          .where((n) => !_engineAlertTypes.hasMatch('${n['type'] ?? ''}'))
          .toList();
    }

    int tierOf(Map<String, dynamic>? r) => (r?['tier'] as num?)?.toInt() ?? 0;

    // One card per active alert (tier >= 2, not dismissed): a crop each, plus
    // drought and flood. `crops` carries every crop the engine watches; older
    // responses without it are treated as a single crop alert.
    final rawCrops = potato?['crops'];
    final List<Map<String, dynamic>> cropList =
        rawCrops is List && rawCrops.isNotEmpty
        ? rawCrops
              .whereType<Map>()
              .map((c) => Map<String, dynamic>.from(c))
              .toList()
        : (potato != null && potato['crop'] != null ? [potato] : const []);

    final candidates = <Map<String, dynamic>>[
      for (final c in cropList)
        if (tierOf(c) >= 2 && !_isDismissed(_cropOf(c)))
          {...c, '_type': 'crop'},
      if (drought != null && tierOf(drought) >= 2 && !_isDismissed('drought'))
        {...drought, '_type': 'drought'},
      if (flood != null && tierOf(flood) >= 2 && !_isDismissed('flood'))
        {...flood, '_type': 'flood'},
    ];
    // Worst first; drought wins a tie (it's the newer sensor).
    candidates.sort((a, b) {
      final byTier = tierOf(b).compareTo(tierOf(a));
      if (byTier != 0) return byTier;
      return a['_type'] == 'drought' ? -1 : 1;
    });

    setState(() {
      _notices = notices;
      _alerts = candidates;
    });
  }

  static String _cropOf(Map<String, dynamic> a) {
    final crop = a['crop']?.toString() ?? '';
    return crop.isEmpty ? 'crop' : crop;
  }

  /// Stable key: the crop name for crop alerts, the channel otherwise.
  static String _alertKey(Map<String, dynamic> a) =>
      a['_type'] == 'crop' ? 'crop:${_cropOf(a)}' : a['_type'].toString();

  /// Dismissal is per crop, so silencing eggplant leaves rice aman showing.
  static String _dismissTarget(Map<String, dynamic> a) =>
      a['_type'] == 'crop' ? _cropOf(a) : a['_type'].toString();

  String _dismissKey(String type) => '${type}_alert_dismissed_until';

  bool _isDismissed(String type) {
    final until = _prefs?.getInt(_dismissKey(type)) ?? 0;
    return DateTime.now().millisecondsSinceEpoch < until;
  }

  void _dismissAlert(Map<String, dynamic> a) {
    final key = _alertKey(a);
    setState(() {
      _alerts = _alerts.where((x) => _alertKey(x) != key).toList();
    });
    _prefs?.setInt(
      _dismissKey(_dismissTarget(a)),
      DateTime.now().add(_dismissFor).millisecondsSinceEpoch,
    );
  }

  void _dismissNotice(Map<String, dynamic> notice) {
    final id = '${notice['id']}';
    setState(() {
      _dismissedNotices = [..._dismissedNotices, id];
      if (_dismissedNotices.length > 200) {
        _dismissedNotices = _dismissedNotices.sublist(
          _dismissedNotices.length - 200,
        );
      }
    });
    _prefs?.setStringList(_noticeDismissedKey, _dismissedNotices);
  }

  /// Bengali text of a notice when the UI is Bengali and the broadcast
  /// carries it (BMD CAP alerts do).
  String _noticeText(Map<String, dynamic> notice, String field) {
    if (_uiLocale == 'bn') {
      final bn = notice['${field}_bn']?.toString();
      if (bn != null && bn.isNotEmpty) return bn;
    }
    return notice[field]?.toString() ?? '';
  }

  String _tierLabel(Map<String, dynamic> a) {
    final tier = (a['tier'] as num?)?.toInt() ?? 0;
    if (tier >= 0 && tier < _tierKeys.length) {
      final key = 'cropAlert.tier.${_tierKeys[tier]}';
      final translated = tr(key);
      if (translated != key) return translated;
    }
    return a['tier_label']?.toString() ?? 'Alert';
  }

  /// Drought / flood use fixed labels; crop alerts name the crop the engine
  /// assessed (eggplant, rice_aman, …). Untranslated crops fall back to their
  /// prettified name rather than an i18n key.
  String _alertTypeLabel(Map<String, dynamic> a) {
    final fixed = {
      'drought': 'cropAlert.drought',
      'flood': 'cropAlert.flood',
    }[a['_type']];
    if (fixed != null) return tr(fixed);
    final crop = a['crop']?.toString() ?? '';
    if (crop.isEmpty) return tr('cropAlert.crop');
    final key = 'cropAlert.$crop';
    final translated = tr(key);
    if (translated != key) return translated;
    return crop
        .split('_')
        .where((w) => w.isNotEmpty)
        .map((w) => w[0].toUpperCase() + w.substring(1))
        .join(' ');
  }

  // Plain glyphs: the app does not ship an icon font (parity with web).
  String _tierGlyph(Map<String, dynamic> a) {
    final tier = (a['tier'] as num?)?.toInt() ?? 0;
    if (a['_type'] == 'flood') return '\u{1F30A}';
    if (tier >= 3) return '⚠';
    if (a['_type'] == 'drought') return '☀';
    return '❗';
  }

  Color _alertColor(Map<String, dynamic> a) {
    final tokens = ThemeManager().tokens;
    final tier = (a['tier'] as num?)?.toInt() ?? 0;
    if (a['_type'] == 'flood') return tokens.info;
    return tier >= 3 ? tokens.danger : tokens.warning;
  }

  @override
  Widget build(BuildContext context) {
    final visibleNotices = _notices
        .where((n) => !_dismissedNotices.contains('${n['id']}'))
        .toList();
    if (_alerts.isEmpty && visibleNotices.isEmpty) {
      return const SizedBox.shrink();
    }

    final tokens = ThemeManager().tokens;
    return Column(
      key: const Key('crop_alert_stack'),
      children: [
        for (final n in visibleNotices)
          _card(
            key: Key('notice_${n['id']}'),
            color: tokens.accentSecondary,
            glyph: '\u{1F4E2}',
            title: _noticeText(n, 'title'),
            scope:
                (n['districts'] is List && (n['districts'] as List).isNotEmpty)
                ? (n['districts'] as List).join(', ')
                : tr('cropAlert.allAreas'),
            message: _noticeText(n, 'body'),
            onDismiss: () => _dismissNotice(n),
          ),
        for (final a in _alerts)
          _card(
            key: Key('crop_alert_${_alertKey(a)}'),
            color: _alertColor(a),
            glyph: _tierGlyph(a),
            title: '${_alertTypeLabel(a)} — ${_tierLabel(a)}',
            scope: a['location']?.toString().isNotEmpty == true
                ? a['location'].toString()
                : LocationService().district,
            message: a['message']?.toString() ?? '',
            triggers: (a['triggers'] as List?)
                ?.map((t) => t.toString())
                .toList(),
            reportUrl:
                a['_type'] == 'drought' &&
                    (a['report_filename']?.toString().isNotEmpty ?? false)
                ? '${widget.backendUrl}/api/weather/drought-report/${a['report_filename']}'
                : null,
            onDismiss: () => _dismissAlert(a),
          ),
      ],
    );
  }

  Widget _card({
    required Key key,
    required Color color,
    required String glyph,
    required String title,
    required String scope,
    required String message,
    required VoidCallback onDismiss,
    List<String>? triggers,
    String? reportUrl,
  }) {
    final tokens = ThemeManager().tokens;
    return Container(
      key: key,
      margin: const EdgeInsets.fromLTRB(
        DsSpacing.md,
        DsSpacing.sm,
        DsSpacing.md,
        0,
      ),
      padding: const EdgeInsets.all(DsSpacing.md),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.12),
        border: Border(left: BorderSide(color: color, width: 4)),
        borderRadius: BorderRadius.circular(DsRadii.md),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(glyph, style: TextStyle(fontSize: tokens.textLg)),
          const SizedBox(width: DsSpacing.sm),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text.rich(
                  TextSpan(
                    style: TextStyle(
                      color: tokens.fg,
                      fontSize: tokens.textMd,
                      fontWeight: FontWeight.w600,
                    ),
                    children: [
                      TextSpan(text: title),
                      TextSpan(
                        text: ' · $scope',
                        style: TextStyle(
                          color: tokens.fg70,
                          fontWeight: FontWeight.normal,
                        ),
                      ),
                    ],
                  ),
                ),
                if (message.isNotEmpty)
                  Padding(
                    padding: const EdgeInsets.only(top: DsSpacing.xs),
                    child: Text(
                      message,
                      style: TextStyle(
                        color: tokens.fg,
                        fontSize: tokens.textSm,
                      ),
                    ),
                  ),
                if (triggers != null && triggers.isNotEmpty)
                  Padding(
                    padding: const EdgeInsets.only(top: DsSpacing.xs),
                    child: Wrap(
                      spacing: DsSpacing.xs,
                      runSpacing: DsSpacing.xs,
                      children: [
                        for (final t in triggers)
                          Container(
                            padding: const EdgeInsets.symmetric(
                              horizontal: DsSpacing.sm,
                              vertical: 2,
                            ),
                            decoration: BoxDecoration(
                              color: color.withValues(alpha: 0.18),
                              borderRadius: BorderRadius.circular(DsRadii.sm),
                            ),
                            child: Text(
                              t,
                              style: TextStyle(
                                color: tokens.fg,
                                fontSize: tokens.textXs,
                              ),
                            ),
                          ),
                      ],
                    ),
                  ),
                if (reportUrl != null)
                  TextButton(
                    onPressed: () => launchUrl(
                      Uri.parse(reportUrl),
                      mode: LaunchMode.externalApplication,
                    ),
                    child: Text(tr('cropAlert.viewDroughtReport')),
                  ),
              ],
            ),
          ),
          IconButton(
            key: Key('${key.toString()}_dismiss'),
            icon: const Icon(Icons.close, size: 18),
            color: tokens.fg70,
            tooltip: tr('cropAlert.dismiss'),
            onPressed: onDismiss,
          ),
        ],
      ),
    );
  }
}
