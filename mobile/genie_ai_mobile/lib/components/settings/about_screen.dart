import 'dart:io';
import 'package:flutter/foundation.dart'; // REQUIRED for kIsWeb check
import 'package:flutter/material.dart';
import 'package:genie_ai_mobile/services/i18n_service.dart';
import 'package:package_info_plus/package_info_plus.dart';

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
    final theme = Theme.of(context);
    final isDark = theme.brightness == Brightness.dark;

    return Scaffold(
      appBar: AppBar(
        // Ensure 'about.title' exists in your locale files
        title: Text(tr('about.title')),
        centerTitle: true,
        elevation: 0,
      ),
      body: SingleChildScrollView(
        padding: const EdgeInsets.all(24.0),
        child: Column(
          children: [
            const SizedBox(height: 32),
            // --- Logo Section ---
            Container(
              width: 100,
              height: 100,
              decoration: BoxDecoration(
                color: theme.primaryColor.withOpacity(0.1),
                shape: BoxShape.circle,
              ),
              child: Icon(
                Icons.smart_toy_outlined,
                size: 48,
                color: theme.primaryColor,
              ),
            ),
            const SizedBox(height: 24),

            // --- App Name & Version ---
            Text(
              _appName,
              style: theme.textTheme.headlineMedium?.copyWith(
                fontWeight: FontWeight.bold,
              ),
            ),
            const SizedBox(height: 8),
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 4),
              decoration: BoxDecoration(
                color: isDark ? Colors.grey[800] : Colors.grey[200],
                borderRadius: BorderRadius.circular(12),
              ),
              child: Text(
                '${tr('about.version')} $_version ($_buildNumber)',
                style: theme.textTheme.bodySmall?.copyWith(
                  fontWeight: FontWeight.w600,
                  color: isDark ? Colors.grey[300] : Colors.grey[700],
                ),
              ),
            ),
            const SizedBox(height: 32),

            // --- Description ---
            Text(
              tr('about.description'),
              textAlign: TextAlign.center,
              style: theme.textTheme.bodyLarge?.copyWith(
                height: 1.5,
                color: isDark ? Colors.grey[300] : Colors.grey[700],
              ),
            ),
            const SizedBox(height: 48),

            // --- Mobile Tech Stack Section ---
            Align(
              alignment: Alignment.centerLeft,
              child: Text(
                tr('about.techStack'),
                style: theme.textTheme.titleLarge?.copyWith(
                  fontWeight: FontWeight.bold,
                ),
              ),
            ),
            const SizedBox(height: 16),
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

            const SizedBox(height: 48),

            // --- Copyright ---
            Text(
              '© ${DateTime.now().year} $_appName. ${tr('about.copyright')}',
              style: theme.textTheme.bodySmall?.copyWith(color: Colors.grey),
            ),
            const SizedBox(height: 24),
          ],
        ),
      ),
    );
  }

  Widget _buildTechCard(BuildContext context, List<Widget> children) {
    final theme = Theme.of(context);
    return Card(
      elevation: 0,
      color: theme.cardColor,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(16),
        side: BorderSide(color: theme.dividerColor.withOpacity(0.1)),
      ),
      child: Padding(
        padding: const EdgeInsets.all(16.0),
        child: Column(children: children),
      ),
    );
  }

  Widget _buildTechItem(BuildContext context, String label, String value) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 8.0),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: [
          Text(label, style: const TextStyle(fontWeight: FontWeight.w500)),
          Expanded(
            child: Text(
              value,
              textAlign: TextAlign.end,
              style: TextStyle(
                color: Theme.of(context).primaryColor,
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
