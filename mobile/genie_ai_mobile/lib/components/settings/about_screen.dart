import 'dart:io';
import 'package:flutter/foundation.dart'; // REQUIRED for kIsWeb check
import 'package:flutter/material.dart';
import 'package:genie_ai_mobile/services/i18n_service.dart';
import 'package:genie_ai_mobile/utils/theme_manager.dart';
import 'package:package_info_plus/package_info_plus.dart';

// Design System Imports
import 'package:genie_ai_mobile/design_system/components/ds_card.dart';
import 'package:genie_ai_mobile/design_system/tokens/spacing.dart';
import 'package:genie_ai_mobile/design_system/tokens/radii.dart';

class AboutScreen extends StatefulWidget {
  const AboutScreen({super.key});

  @override
  State<AboutScreen> createState() => _AboutScreenState();
}

class _AboutScreenState extends State<AboutScreen> {
  // State for dynamic runtime info
  String _appName = "";
  String _packageName = "";
  String _version = "";
  String _buildNumber = "";
  String _dartVersion = "";
  String _osVersion = "";

  @override
  void initState() {
    super.initState();
    _inspectRuntimeStack();
  }

  Future<void> _inspectRuntimeStack() async {
    String dartVer = "";
    String os = "";

    // 1. Get Platform/OS Info (Cross-platform safe)
    if (kIsWeb) {
      // Safe fallback for Web where Platform.* throws errors
      dartVer = "Dart (Web)";
      os = "Web Browser";
    } else {
      // Mobile/Desktop logic (Safe to use Platform.X here)
      try {
        dartVer = Platform.version.split(' ').first;
        os = "${Platform.operatingSystem} ${Platform.operatingSystemVersion}";
      } catch (e) {
        dartVer = "Dart (Mobile)";
        os = "Unknown OS";
      }
    }

    // 2. Get App Package Info (Asynchronous)
    try {
      final info = await PackageInfo.fromPlatform();
      if (mounted) {
        setState(() {
          _appName = info.appName.isEmpty ? "Genie AI" : info.appName;
          _packageName = info.packageName;
          _version = info.version;
          _buildNumber = info.buildNumber;
          _dartVersion = dartVer;
          _osVersion = os;
        });
      }
    } catch (e) {
      debugPrint("[ABOUT] Error inspecting package info: $e");
      // Fallback if package_info_plus fails or isn't installed
      if (mounted) {
        setState(() {
          _appName = "Genie AI";
          _dartVersion = dartVer;
          _osVersion = os;
          _version = "Unknown";
        });
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final tokens = ThemeManager().tokens;

    return Scaffold(
      appBar: AppBar(
        // Ensure 'about.title' exists in your locale files
        title: Text(tr('about.title')),
        centerTitle: true,
        elevation: 0,
        backgroundColor: tokens.surface,
        foregroundColor: tokens.fg,
      ),
      body: SingleChildScrollView(
        padding: const EdgeInsets.all(DsSpacing.lg),
        child: Column(
          children: [
            const SizedBox(height: DsSpacing.xl),
            // --- Logo Section ---
            Container(
              width: 100,
              height: 100,
              decoration: BoxDecoration(
                color: tokens.accentMuted,
                shape: BoxShape.circle,
              ),
              child: Icon(
                Icons.smart_toy_outlined,
                size: 48,
                color: tokens.accent,
              ),
            ),
            const SizedBox(height: DsSpacing.lg),

            // --- App Name & Version ---
            Text(
              _appName,
              style: TextStyle(
                fontSize: tokens.textXl,
                fontWeight: FontWeight.bold,
                color: tokens.fg,
              ),
            ),
            const SizedBox(height: DsSpacing.xs),
            Container(
              padding: const EdgeInsets.symmetric(
                horizontal: DsSpacing.sm,
                vertical: DsSpacing.xxs,
              ),
              decoration: BoxDecoration(
                color: tokens.mutedSoft,
                borderRadius: BorderRadius.circular(DsRadii.lg),
              ),
              child: Text(
                '${tr('about.version')} $_version ($_buildNumber)',
                style: TextStyle(
                  fontWeight: FontWeight.w600,
                  color: tokens.fg,
                  fontSize: tokens.textSm,
                ),
              ),
            ),
            const SizedBox(height: DsSpacing.xl),

            // --- Description ---
            Text(
              tr('about.description'),
              textAlign: TextAlign.center,
              style: TextStyle(
                height: 1.5,
                color: tokens.fg,
                fontSize: tokens.textMd,
              ),
            ),
            const SizedBox(height: DsSpacing.xl2),

            // --- Mobile Tech Stack Section ---
            Align(
              alignment: Alignment.centerLeft,
              child: Text(
                tr('about.techStack'),
                style: TextStyle(
                  fontWeight: FontWeight.bold,
                  color: tokens.fg,
                  fontSize: tokens.textLg,
                ),
              ),
            ),
            const SizedBox(height: DsSpacing.md),
            _buildTechCard(context, [
              _buildTechItem(
                context,
                'App ID',
                _packageName.isEmpty ? 'Loading...' : _packageName,
              ),
              _buildTechItem(context, 'Framework', 'Flutter'), // Implicit
              _buildTechItem(context, 'Runtime', 'Dart $_dartVersion'),
              _buildTechItem(context, 'OS Platform', _osVersion),
            ]),

            const SizedBox(height: DsSpacing.xl2),

            // --- Copyright ---
            Text(
              '© ${DateTime.now().year} $_appName. ${tr('about.copyright')}',
              style: TextStyle(color: tokens.muted, fontSize: tokens.textSm),
            ),
            const SizedBox(height: DsSpacing.lg),
          ],
        ),
      ),
    );
  }

  Widget _buildTechCard(BuildContext context, List<Widget> children) {
    final tokens = ThemeManager().tokens;
    return DsCard(
      variant: DsCardVariant.standard,
      padding: const EdgeInsets.all(DsSpacing.md),
      radius: DsRadii.xl,
      overrideBorderColor: tokens.borderLight,
      child: Column(children: children),
    );
  }

  Widget _buildTechItem(BuildContext context, String label, String value) {
    final tokens = ThemeManager().tokens;
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: DsSpacing.xs),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: [
          Text(
            label,
            style: TextStyle(fontWeight: FontWeight.w500, color: tokens.fg),
          ),
          Expanded(
            child: Text(
              value,
              textAlign: TextAlign.end,
              style: TextStyle(
                color: tokens.accent,
                fontWeight: FontWeight.bold,
              ),
              overflow: TextOverflow.ellipsis,
            ),
          ),
        ],
      ),
    );
  }
}
