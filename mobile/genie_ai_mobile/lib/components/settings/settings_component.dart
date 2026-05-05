import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'dart:async';

// Service Imports
import 'package:genie_ai_mobile/services/user_service.dart';
import 'package:genie_ai_mobile/config/keycloak_config.dart';
import 'package:genie_ai_mobile/utils/theme_manager.dart';
import 'package:genie_ai_mobile/services/i18n_service.dart';
import 'package:genie_ai_mobile/services/connectivity_service.dart';
import 'package:genie_ai_mobile/services/auth/auth_providers.dart';
import 'package:url_launcher/url_launcher.dart';

// Component Imports
import 'package:genie_ai_mobile/components/shared/language_selector.dart';

class SettingsComponent extends ConsumerStatefulWidget {
  final Map<String, dynamic> user;
  const SettingsComponent({super.key, required this.user});

  @override
  ConsumerState<SettingsComponent> createState() => _SettingsComponentState();
}

class _SettingsComponentState extends ConsumerState<SettingsComponent> {
  late UserService _userService;

  // ===========================================================================
  // COMPONENT STATE - Mirrored exactly from Vue data()
  // ===========================================================================
  bool _isLoading = true;
  String? _errorMessage;
  bool _isThemeReady = false;

  // Settings Object - Logic from settings initialization
  late String _selectedLanguage;
  late String _selectedTheme;
  double _fontSize = 50.0;
  bool _emailUpdates = false;
  bool _soundNotifications = true;

  // Account Management Local State
  Map<String, dynamic> _userData = {
    "name": "",
    "email": "",
    "accountType": "",
    "userId": "",
    "createdAt": "",
  };

  bool _isDeletingAccount = false;

  @override
  void initState() {
    super.initState();
    debugPrint("[SETTINGS] Component created, initializing state...");

    _userService = UserService(api: ref.read(apiServiceProvider));

    // Initialize from Global State (ThemeManager)
    _selectedTheme = ThemeManager().userPreference;
    _fontSize = ThemeManager().fontSize;
    _selectedLanguage = "English";

    // Logic branch mirroring Vue created() hooks
    _fetchUserData();

    // Handling layout readiness delay
    Future.delayed(Duration.zero, () {
      if (mounted) {
        debugPrint("[SETTINGS] Setting isThemeReady to true for layout...");
        setState(() => _isThemeReady = true);
      }
    });
  }

  @override
  void dispose() {
    debugPrint("[SETTINGS] Component destroying, cleaning up resources...");
    super.dispose();
  }

  // ===========================================================================
  // INTERNAL LOGIC METHODS - Mirrored from Vue methods
  // ===========================================================================

  /* * REMOVED: This timer forces the theme every 100ms.
   * We removed it because we want the user to "Preview" the theme change
   * locally in this dialog BEFORE hitting save.
  void _startThemeEnforcement() {
    _themeEnforcementTimer =
        Timer.periodic(const Duration(milliseconds: 100), (timer) {
      if (ThemeManager().userPreference != _selectedTheme) {
        ThemeManager().setTheme(_selectedTheme);
      }
    });
  }
  */

  /// Exhaustive implementation of fetchUserData()
  Future<void> _fetchUserData() async {
    debugPrint("[SETTINGS] fetchUserData() initiated...");
    setState(() {
      _isLoading = true;
      _errorMessage = null;
    });

    try {
      debugPrint("[SETTINGS] Calling API: userService.getCurrentUserInfo()...");
      final data = await _userService.getCurrentUserInfo();
      debugPrint("[SETTINGS] API SUCCESS. Raw Response: $data");

      final userMap = data['user'] ?? data;

      if (!mounted) return;

      setState(() {
        _userData = {
          "name":
              userMap['fullName'] ??
              userMap['name'] ??
              tr("settings.userName"),
          "email": userMap['email'] ?? "",
          "accountType":
              userMap['accountType'] ??
              userMap['role'] ??
              tr("settings.standardAccount"),
          "userId": (userMap['id'] ?? userMap['_key'] ?? "").toString(),
          "createdAt": userMap['createdAt'] ?? "",
        };

        _selectedLanguage = userMap['language'] ?? 'English';
        if (userMap['fontSize'] != null) {
          _fontSize = (userMap['fontSize'] ?? 50.0).toDouble();
        }
        _emailUpdates = userMap['emailUpdates'] ?? false;
        _soundNotifications = userMap['soundNotifications'] ?? true;
        _isLoading = false;
      });
    } catch (e) {
      debugPrint("[SETTINGS] API Error in fetchUserData: $e");
      if (mounted) {
        setState(() {
          _errorMessage = tr("settings.unableToLoadUser");
          _isLoading = false;
        });
      }
    }
  }

  /// Exhaustive implementation of save() persistence
  Future<void> _handleSave() async {
    debugPrint("[SETTINGS] save() logic initiated...");
    setState(() => _isLoading = true);

    try {
      final bool isOnline = ConnectivityService().isOnline;

      if (isOnline) {
        debugPrint("[SETTINGS] Syncing settings object to API...");
        await _userService.updateAccountSettings({
          'theme': _selectedTheme,
          'language': _selectedLanguage,
          'fontSize': _fontSize.toInt(),
          'emailUpdates': _emailUpdates,
          'soundNotifications': _soundNotifications,
        });
      } else {
        debugPrint("[SETTINGS] Offline mode. Skipping API update.");
      }

      // Apply Global Changes (Always run locally)
      ThemeManager().setTheme(_selectedTheme);
      ThemeManager().setFontSize(_fontSize);

      if (!mounted) return;
      Navigator.pop(context);

      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(
            isOnline
                ? tr("settings.settingsSaved")
                : tr("settings.settingsSavedOffline"),
          ),
        ),
      );
    } catch (e) {
      debugPrint("[SETTINGS] Save operation failed: $e");
      if (mounted) setState(() => _isLoading = false);
    }
  }

  // ===========================================================================
  // ACCOUNT MANAGEMENT — mirrors web SettingsComponent pattern
  // ===========================================================================

  Future<void> _openAccountConsole() async {
    final uri = Uri.parse('${getConfig().realmUrl}/account/');
    if (await canLaunchUrl(uri)) {
      await launchUrl(uri, mode: LaunchMode.externalApplication);
    } else {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text(
              tr("settings.cannotOpenAccountConsole"),
            ),
          ),
        );
      }
    }
  }

  // ===========================================================================
  // DANGER ZONE MODALS
  // ===========================================================================

  void _initiateAccountDeletionFlow() {
    showDialog(
      context: context,
      builder: (ctx) => AlertDialog(
        title: Text(tr("settings.deleteAccountTitle")),
        content: Text(
          tr("settings.confirmDeleteAccount"),
        ),
        actions: [
          TextButton(
            key: const Key('settings_delete_cancel_button'),
            onPressed: () => Navigator.pop(ctx),
            child: Text(tr("settings.cancel")),
          ),
          ElevatedButton(
            key: const Key('settings_delete_confirm_button'),
            style: ElevatedButton.styleFrom(backgroundColor: Colors.red),
            onPressed: () async {
              Navigator.pop(ctx);
              setState(() => _isDeletingAccount = true);
              try {
                await _userService.deleteAccount();
                await ref.read(authProvider.notifier).logout();
                if (mounted) {
                  Navigator.pushNamedAndRemoveUntil(
                    context,
                    '/login',
                    (r) => false,
                  );
                }
              } catch (e) {
                if (mounted) {
                  setState(() => _isDeletingAccount = false);
                  ScaffoldMessenger.of(context).showSnackBar(
                    SnackBar(
                      content: Text(
                        tr("accountDeletionFailed"),
                      ),
                    ),
                  );
                }
              }
            },
            child: Text(
              tr("settings.permanentlyDeleteAccount"),
            ),
          ),
        ],
      ),
    );
  }

  void _showResetDataWorkflow() {
    debugPrint("[SETTINGS] resetUserData workflow triggered...");
    showDialog(
      context: context,
      builder: (ctx) => AlertDialog(
        title: Text(
          tr("settings.resetUserDataTitle"),
        ),
        content: Text(
          tr("settings.confirmResetUserData"),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx),
            child: Text(tr("settings.cancel")),
          ),
          ElevatedButton(
            onPressed: () async {
              Navigator.pop(ctx);
              setState(() {
                _isLoading = true;
              });
              await _userService.resetUserData();
              _fetchUserData();
            },
            child: Text(tr("settings.reset")),
          ),
        ],
      ),
    );
  }

  // ===========================================================================
  // UI BUILDERS MATCHING VUE TEMPLATE STRUCTURE
  // ===========================================================================

  @override
  Widget build(BuildContext context) {
    // PREVIEW LOGIC: Use local _selectedTheme state instead of Global ThemeManager
    final bool previewIsDark = _selectedTheme == 'dark';

    // Retrieve theme data corresponding to the SELECTION (Preview), not the current app state
    final ThemeData previewTheme = previewIsDark
        ? ThemeManager().darkTheme
        : ThemeManager().lightTheme;

    // Config-driven colors
    final Color bgColor = previewTheme.scaffoldBackgroundColor;
    final Color titleColor =
        previewTheme.textTheme.bodyLarge?.color ?? Colors.black;
    final Color primaryColor = previewTheme.primaryColor;

    // Use opacity based on preview mode
    final Color boxBg = previewIsDark
        ? Colors.white.withOpacity(0.05)
        : Colors.black.withOpacity(0.02);

    if (_isLoading) {
      return Container(
        color: bgColor,
        child: Center(child: CircularProgressIndicator(color: primaryColor)),
      );
    }

    if (_errorMessage != null) {
      return Container(color: bgColor, child: _buildErrorState(primaryColor));
    }

    // RESTORED: Layout Readiness check
    if (!_isThemeReady) {
      return Container(color: bgColor);
    }

    // REFRESH: Using StreamBuilder to make Settings reactive to Connectivity
    return StreamBuilder<bool>(
      stream: ConnectivityService().isOnlineStream,
      initialData: ConnectivityService().isOnline,
      builder: (context, snapshot) {
        final bool isOnline = snapshot.data ?? true;

        // FIX: Wrapped in MediaQuery with TextScaler to enable real-time font scaling preview
        return MediaQuery(
          data: MediaQuery.of(
            context,
          ).copyWith(textScaler: TextScaler.linear(_fontSize / 50.0)),
          child: Material(
            color: Colors.transparent,
            child: Container(
              decoration: BoxDecoration(
                color: bgColor,
                borderRadius: const BorderRadius.vertical(
                  top: Radius.circular(16),
                ),
              ),
              child: Column(
                children: [
                  _buildStickyHeader(primaryColor, titleColor, previewIsDark),
                  Expanded(
                    child: SingleChildScrollView(
                      // UPDATED: Reduced padding for handset screens
                      padding: const EdgeInsets.all(16),
                      child: Column(
                        children: [
                          _buildIdentitySection(primaryColor, titleColor),
                          const SizedBox(height: 16),
                          // FIX: Using vertical stack prevents RenderFlex overflows and enables Language Selector visibility
                          _buildVerticalConfigurationStack(
                            primaryColor,
                            titleColor,
                            boxBg,
                            previewTheme.cardColor,
                            isOnline: isOnline,
                          ),
                          const SizedBox(height: 16),
                          _buildAccountManagement(
                            primaryColor,
                            titleColor,
                            previewIsDark,
                            boxBg,
                            isOnline: isOnline,
                          ),
                          const SizedBox(height: 60),
                        ],
                      ),
                    ),
                  ),
                ],
              ),
            ),
          ),
        );
      },
    );
  }

  Widget _buildStickyHeader(Color accent, Color titleColor, bool isDark) {
    return Container(
      // UPDATED: Reduced padding for handset screens
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
      decoration: BoxDecoration(
        border: Border(
          bottom: BorderSide(color: isDark ? Colors.white10 : Colors.black12),
        ),
      ),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: [
          // UPDATED: Wrapped title in Flexible to prevent overflow on long translations
          Flexible(
            child: Text(
              tr("settings.title"),
              overflow: TextOverflow.ellipsis,
              style: TextStyle(
                fontSize: 22,
                fontWeight: FontWeight.bold,
                color: titleColor,
              ),
            ),
          ),
          // FIXED: Wrapped buttons Row in Flexible to prevent overflow
          Flexible(
            child: Row(
              mainAxisAlignment: MainAxisAlignment.end,
              mainAxisSize: MainAxisSize.min,
              children: [
                // ADDED: Link to About Screen
                IconButton(
                  icon: Icon(Icons.info_outline, color: titleColor),
                  tooltip: tr("about.title"),
                  onPressed: () => Navigator.pushNamed(context, '/about'),
                  padding: const EdgeInsets.all(8),
                  constraints: const BoxConstraints(),
                ),
                const SizedBox(width: 4),
                // FIXED: Wrapped TextButton in Flexible to handle long translations
                Flexible(
                  child: TextButton(
                    onPressed: () => Navigator.pop(context),
                    child: Text(
                      tr("settings.close"),
                      overflow: TextOverflow.ellipsis,
                      maxLines: 1,
                    ),
                  ),
                ),
                const SizedBox(width: 4),
                // FIXED: Wrapped ElevatedButton in Flexible to handle long translations
                Flexible(
                  child: ElevatedButton(
                    style: ElevatedButton.styleFrom(
                      backgroundColor: accent,
                      elevation: 0,
                      padding: const EdgeInsets.symmetric(
                        horizontal: 12,
                        vertical: 8,
                      ),
                      minimumSize: const Size(60, 36),
                    ),
                    onPressed: _handleSave,
                    child: Text(
                      tr("settings.saveSettings"),
                      style: const TextStyle(color: Colors.white),
                      overflow: TextOverflow.ellipsis,
                      maxLines: 1,
                    ),
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildIdentitySection(Color accent, Color titleColor) {
    final String rawName =
        _userData['name'] ?? tr("settings.userName");
    final String name = rawName.isEmpty
        ? tr("settings.userName")
        : rawName;

    // FIX: Robust type-safe initials logic to resolve dynamic mapping TypeError on Web
    String initials = "?";
    if (name.isNotEmpty) {
      final List<String> parts = name.trim().split(RegExp(r'\s+'));
      if (parts.isNotEmpty && parts[0].isNotEmpty) {
        initials = parts.length > 1
            ? (parts[0].substring(0, 1) + parts.last.substring(0, 1))
                  .toUpperCase()
            : parts[0].substring(0, 1).toUpperCase();
      }
    }

    return Row(
      children: [
        CircleAvatar(
          radius: 34,
          backgroundColor: accent,
          child: Text(
            initials,
            style: const TextStyle(
              color: Colors.white,
              fontSize: 24,
              fontWeight: FontWeight.bold,
            ),
          ),
        ),
        const SizedBox(width: 16),
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                name,
                style: TextStyle(
                  fontSize: 20,
                  fontWeight: FontWeight.bold,
                  color: titleColor,
                ),
              ),
              // BUG FIX: Rendering hydrated email state
              Text(
                _userData['email'],
                style: const TextStyle(color: Colors.grey, fontSize: 14),
              ),
              const SizedBox(height: 4),
              Text(
                _userData['accountType'],
                style: TextStyle(
                  fontSize: 13,
                  fontWeight: FontWeight.w600,
                  color: accent,
                ),
              ),
            ],
          ),
        ),
      ],
    );
  }

  // FIX: Stacking configuration elements vertically gives the Language Selector full width
  Widget _buildVerticalConfigurationStack(
    Color accent,
    Color titleColor,
    Color boxBg,
    Color dropdownBg, {
    required bool isOnline,
  }) {
    return Column(
      children: [
        _buildThemedGroupBox(
          tr("settings.display"),
          boxBg,
          titleColor,
          [
            _buildItemLabel(
              tr("settings.displayLanguage"),
            ),
            // UPDATED: Passing titleColor ensures text is visible.
            // UPDATED: Passing dropdownBg ensures menu background matches dialog theme.
            LanguageSelector(textColor: titleColor, dropdownColor: dropdownBg),
            const SizedBox(height: 20),
            _buildItemLabel(tr("settings.theme")),
            _buildThemeButtonRow(accent),
            const SizedBox(height: 20),
            _buildItemLabel(tr("settings.fontSize")),
            _buildFontSizeSliderControl(accent, titleColor),
          ],
        ),
        const SizedBox(height: 16),
        _buildThemedGroupBox(
          tr("settings.notifications"),
          boxBg,
          titleColor,
          [
            // FIX: Passing accent color for switch
            // UPDATED: Disabled if OFFLINE
            _buildToggleRow(
              tr("settings.emailUpdates"),
              _emailUpdates,
              isOnline ? (v) => setState(() => _emailUpdates = v) : null,
              accent,
            ),
            const SizedBox(height: 16),
            // FIX: Passing accent color for switch
            _buildToggleRow(
              tr("settings.soundNotifications"),
              _soundNotifications,
              (v) => setState(() => _soundNotifications = v),
              accent,
            ),
          ],
        ),
      ],
    );
  }

  Widget _buildAccountManagement(
    Color accent,
    Color titleColor,
    bool isDark,
    Color boxBg, {
    required bool isOnline,
  }) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          tr("settings.accountManagement"),
          style: TextStyle(
            fontSize: 18,
            fontWeight: FontWeight.bold,
            color: titleColor,
          ),
        ),
        const SizedBox(height: 16),
        Container(
          padding: const EdgeInsets.all(16),
          decoration: BoxDecoration(
            color: boxBg,
            borderRadius: BorderRadius.circular(10),
          ),
          child: Column(
            children: [
              // 1. Manage My Account — opens Keycloak account console
              _buildActionBtnCard(
                "${tr("settings.manageMyAccount")} →",
                tr("settings.manageMyAccountDesc"),
                isOnline ? _openAccountConsole : null,
                isDark,
                key: const Key('settings_manage_account_button'),
              ),
              const SizedBox(height: 12),
              // 2. Reset User Data
              _buildActionBtnCard(
                tr("settings.resetUserData"),
                tr("settings.resetUserDataDesc"),
                isOnline ? _showResetDataWorkflow : null,
                isDark,
                key: const Key('settings_reset_data_button'),
                overrideColor: Colors.red[800],
              ),
              const SizedBox(height: 12),
              // 3. Delete My Account — real GDPR deletion
              _buildActionBtnCard(
                tr("settings.deleteAccount"),
                tr("settings.deleteAccountDesc"),
                isOnline ? _initiateAccountDeletionFlow : null,
                isDark,
                key: const Key('settings_delete_account_button'),
                isDanger: true,
              ),
            ],
          ),
        ),
      ],
    );
  }

  // ===========================================================================
  // ATOMIC UI SUB-BUILDERS
  // ===========================================================================

  Widget _buildThemedGroupBox(
    String title,
    Color bg,
    Color titleColor,
    List<Widget> children,
  ) {
    return Container(
      padding: const EdgeInsets.all(18),
      decoration: BoxDecoration(
        color: bg,
        borderRadius: BorderRadius.circular(8),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            title,
            style: TextStyle(
              fontSize: 16,
              fontWeight: FontWeight.bold,
              color: titleColor,
            ),
          ),
          const SizedBox(height: 18),
          ...children,
        ],
      ),
    );
  }

  Widget _buildThemeButtonRow(Color accent) {
    return Row(
      children: [
        Expanded(
          child: _buildThemeToggleBtn(
            tr("settings.themeLight"),
            _selectedTheme == 'light',
            accent,
            () => setState(() => _selectedTheme = 'light'),
          ),
        ),
        const SizedBox(width: 10),
        Expanded(
          child: _buildThemeToggleBtn(
            tr("settings.themeDark"),
            _selectedTheme == 'dark',
            accent,
            () => setState(() => _selectedTheme = 'dark'),
          ),
        ),
      ],
    );
  }

  Widget _buildThemeToggleBtn(
    String label,
    bool active,
    Color accent,
    VoidCallback onTap,
  ) {
    return InkWell(
      onTap: onTap,
      child: Container(
        padding: const EdgeInsets.symmetric(vertical: 10),
        alignment: Alignment.center,
        decoration: BoxDecoration(
          color: active ? accent : Colors.grey.withOpacity(0.15),
          borderRadius: BorderRadius.circular(6),
        ),
        child: Text(
          label,
          style: TextStyle(
            color: active ? Colors.white : Colors.grey,
            fontWeight: FontWeight.bold,
          ),
        ),
      ),
    );
  }

  Widget _buildFontSizeSliderControl(Color accent, Color titleColor) {
    return Row(
      children: [
        Expanded(
          child: Slider(
            value: _fontSize,
            min: 30,
            max: 100,
            activeColor: accent,
            onChanged: (v) => setState(() => _fontSize = v),
          ),
        ),
        // FIX: Real-time visual feedback mirrored from Vue rem scaling logic
        Text(
          "${_fontSize.toInt()}%",
          style: TextStyle(
            color: titleColor,
            fontWeight: FontWeight.bold,
            fontSize: 14,
          ),
        ),
      ],
    );
  }

  Widget _buildToggleRow(
    String label,
    bool value,
    Function(bool)? onChanged,
    Color activeColor,
  ) {
    return Row(
      mainAxisAlignment: MainAxisAlignment.spaceBetween,
      children: [
        // UPDATED: Wrapped text in Expanded to prevent overflow on long translations
        Expanded(child: Text(label, style: const TextStyle(fontSize: 14.5))),
        Switch(
          value: value,
          onChanged: onChanged,
          // FIX: Using dynamic active color instead of hardcoded hex
          activeColor: activeColor,
        ),
      ],
    );
  }

  Widget _buildActionBtnCard(
    String title,
    String desc,
    VoidCallback? onTap,
    bool isDark, {
    Key? key,
    bool isDanger = false,
    Color? overrideColor,
  }) {
    // Determine the effective background color
    // FIX: Added '!' to Colors.grey[200] to handle nullability strictness
    final Color bgColor =
        overrideColor ??
        (isDanger ? Colors.red : (isDark ? Colors.white10 : Colors.grey[200]!));

    // Determine the effective text color
    // If it's a "danger" button OR has an override (which implies a colored button like Dark Red), use White.
    // Otherwise use black87 (standard buttons)
    final Color txtColor = (isDanger || overrideColor != null)
        ? Colors.white
        : Colors.black87;

    return Column(
      children: [
        ElevatedButton(
          key: key,
          style: ElevatedButton.styleFrom(
            backgroundColor: bgColor,
            minimumSize: const Size(double.infinity, 50),
            // VISUAL CUE FOR DISABLED STATE
            disabledBackgroundColor: bgColor.withOpacity(0.5),
            disabledForegroundColor: txtColor.withOpacity(0.5),
          ),
          onPressed: onTap,
          child: Text(
            title,
            textAlign: TextAlign
                .center, // UPDATED: Ensure center alignment if wrapping occurs
            style: TextStyle(color: txtColor, fontWeight: FontWeight.bold),
          ),
        ),
        const SizedBox(height: 6),
        Text(
          desc,
          style: const TextStyle(fontSize: 11.5, color: Colors.grey),
          textAlign: TextAlign.center,
        ),
      ],
    );
  }

  Widget _buildItemLabel(String text) => Padding(
    padding: const EdgeInsets.only(bottom: 10),
    child: Text(text, style: const TextStyle(fontSize: 14, color: Colors.grey)),
  );

  Widget _buildErrorState(Color accent) => Center(
    child: Column(
      mainAxisAlignment: MainAxisAlignment.center,
      children: [
        Text(_errorMessage!),
        const SizedBox(height: 16),
        ElevatedButton(
          onPressed: _fetchUserData,
          child: Text(tr("settings.retry")),
        ),
      ],
    ),
  );
}
