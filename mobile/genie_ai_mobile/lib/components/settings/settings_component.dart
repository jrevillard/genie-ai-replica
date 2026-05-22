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
import 'package:genie_ai_mobile/providers/api_providers.dart';
import 'package:url_launcher/url_launcher.dart';

// Component Imports
import 'package:genie_ai_mobile/components/shared/language_selector.dart';

// Design System Imports
import 'package:genie_ai_mobile/design_system/components/ds_button.dart';
import 'package:genie_ai_mobile/design_system/components/ds_card.dart';
import 'package:genie_ai_mobile/design_system/components/ds_modal.dart';
import 'package:genie_ai_mobile/design_system/tokens/spacing.dart';
import 'package:genie_ai_mobile/design_system/tokens/radii.dart';
import 'package:genie_ai_mobile/design_system/tokens/app_tokens.dart';

class SettingsComponent extends ConsumerStatefulWidget {
  final Map<String, dynamic> user;
  const SettingsComponent({super.key, required this.user});

  @override
  ConsumerState<SettingsComponent> createState() => _SettingsComponentState();
}

class _SettingsComponentState extends ConsumerState<SettingsComponent> {
  late UserService _userService;

  // ===========================================================================
  // COMPONENT STATE
  // ===========================================================================
  bool _isLoading = true;
  String? _errorMessage;

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

  // Debounce timer for font size API persistence
  Timer? _fontSizeDebounce;

  @override
  void initState() {
    super.initState();
    debugPrint("[SETTINGS] Component created, initializing state...");

    _userService = UserService(userApi: ref.read(currentUserApiProvider));

    // Logic branch mirroring Vue created() hooks
    _fetchUserData();
  }

  @override
  void dispose() {
    // Flush any pending font size persistence before closing
    if (_fontSizeDebounce?.isActive == true) {
      _fontSizeDebounce!.cancel();
      _persistSetting({'fontSize': ThemeManager().fontSize.toInt()});
    }
    super.dispose();
  }

  // ===========================================================================
  // IMMEDIATE SETTINGS — Native pattern: every change applies + persists instantly
  // ===========================================================================

  void _onThemeChanged(String theme) {
    ThemeManager().setTheme(theme);
    _persistSetting({'theme': theme});
  }

  void _onFontSizeChanged(double value) {
    ThemeManager().setFontSize(value);
    _fontSizeDebounce?.cancel();
    _fontSizeDebounce = Timer(const Duration(milliseconds: 500), () {
      _persistSetting({'fontSize': value.toInt()});
    });
  }

  void _onLanguageChanged(String languageCode) {
    // LanguageSelector already calls I18nService().changeLanguage()
    _persistSetting({'language': languageCode});
  }

  void _onEmailUpdatesChanged(bool value) {
    setState(() => _emailUpdates = value);
    _persistSetting({'emailUpdates': value});
  }

  void _onSoundNotificationsChanged(bool value) {
    setState(() => _soundNotifications = value);
    _persistSetting({'soundNotifications': value});
  }

  /// Fire-and-forget persistence — no loading state, no snackbar
  void _persistSetting(Map<String, dynamic> setting) {
    if (!ConnectivityService().isOnline) return;
    _userService.updateAccountSettings(setting).catchError((e) {
      debugPrint("[SETTINGS] Failed to persist ${setting.keys}: $e");
      return <String, dynamic>{};
    });
  }

  // ===========================================================================
  // INTERNAL LOGIC METHODS
  // ===========================================================================

  Future<void> _fetchUserData() async {
    final config = getConfig();
    debugPrint(
      "[SETTINGS] fetchUserData() initiated... backendUrl=${config.backendUrl}",
    );
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
              userMap['fullName'] ?? userMap['name'] ?? tr("settings.userName"),
          "email": userMap['email'] ?? "",
          "accountType":
              userMap['accountType'] ??
              userMap['role'] ??
              tr("settings.standardAccount"),
          "userId": (userMap['id'] ?? userMap['_key'] ?? "").toString(),
          "createdAt": userMap['createdAt'] ?? "",
        };

        if (userMap['language'] != null) {
          I18nService().changeLanguage(userMap['language']);
        }
        // Theme and fontSize are client-authoritative — applied immediately
        // on user change, not overwritten from server on subsequent fetches.
        // Only apply on first load if ThemeManager still has defaults.
        if (userMap['theme'] != null &&
            ThemeManager().userPreference == 'light' &&
            userMap['theme'] != 'light') {
          ThemeManager().setTheme(userMap['theme']);
        }
        if (userMap['fontSize'] != null) {
          final serverFontSize = (userMap['fontSize'] ?? 50.0).toDouble();
          if (ThemeManager().fontSize == 50.0 && serverFontSize != 50.0) {
            ThemeManager().setFontSize(serverFontSize);
          }
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

  // ===========================================================================
  // ACCOUNT MANAGEMENT — mirrors web SettingsComponent pattern
  // ===========================================================================

  Future<void> _openAccountConsole() async {
    final uri = Uri.parse('${getConfig().realmUrl}/account/');
    if (await canLaunchUrl(uri)) {
      await launchUrl(uri, mode: LaunchMode.externalApplication);
    } else {
      if (mounted) {
        final tokens = ThemeManager().tokens;
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            backgroundColor: tokens.surface,
            content: Text(
              tr("settings.cannotOpenAccountConsole"),
              style: TextStyle(color: tokens.fg),
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
    DsModal.show(
      context: context,
      title: tr("settings.deleteAccountTitle"),
      content: Text(tr("settings.confirmDeleteAccount")),
      actions: [
        DsButton(
          key: const Key('settings_delete_cancel_button'),
          label: tr("settings.cancel"),
          variant: DsButtonVariant.ghost,
          onPressed: () => Navigator.pop(context),
        ),
        DsButton(
          key: const Key('settings_delete_confirm_button'),
          label: tr("settings.permanentlyDeleteAccount"),
          variant: DsButtonVariant.danger,
          onPressed: () async {
            Navigator.pop(context);
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
                final tokens = ThemeManager().tokens;
                ScaffoldMessenger.of(context).showSnackBar(
                  SnackBar(
                    backgroundColor: tokens.surface,
                    content: Text(
                      tr("accountDeletionFailed"),
                      style: TextStyle(color: tokens.fg),
                    ),
                  ),
                );
              }
            }
          },
        ),
      ],
    );
  }

  void _showResetDataWorkflow() {
    debugPrint("[SETTINGS] resetUserData workflow triggered...");
    DsModal.show(
      context: context,
      title: tr("settings.resetUserDataTitle"),
      content: Text(tr("settings.confirmResetUserData")),
      actions: [
        DsButton(
          label: tr("settings.cancel"),
          variant: DsButtonVariant.ghost,
          onPressed: () => Navigator.pop(context),
        ),
        DsButton(
          label: tr("settings.reset"),
          variant: DsButtonVariant.primary,
          onPressed: () async {
            Navigator.pop(context);
            setState(() {
              _isLoading = true;
            });
            await _userService.resetUserData();
            _fetchUserData();
          },
        ),
      ],
    );
  }

  // ===========================================================================
  // UI BUILDERS MATCHING VUE TEMPLATE STRUCTURE
  // ===========================================================================

  @override
  Widget build(BuildContext context) {
    final tokens = ThemeManager().tokens;

    if (_isLoading) {
      return Material(
        color: Colors.transparent,
        child: Container(
          decoration: BoxDecoration(
            color: tokens.bg,
            borderRadius: const BorderRadius.vertical(
              top: Radius.circular(DsRadii.xl),
            ),
          ),
          child: Column(
            children: [
              _buildStickyHeader(tokens),
              Expanded(
                child: SingleChildScrollView(
                  padding: const EdgeInsets.all(DsSpacing.md),
                  child: Column(
                    children: [
                      Center(
                        child: CircularProgressIndicator(color: tokens.accent),
                      ),
                      const SizedBox(height: DsSpacing.md),
                      _buildAccountManagement(
                        tokens,
                        tokens.isDark ? tokens.fg30 : tokens.muted20,
                        isOnline: true,
                      ),
                    ],
                  ),
                ),
              ),
            ],
          ),
        ),
      );
    }

    if (_errorMessage != null) {
      return Material(
        color: Colors.transparent,
        child: Container(
          decoration: BoxDecoration(
            color: tokens.bg,
            borderRadius: const BorderRadius.vertical(
              top: Radius.circular(DsRadii.xl),
            ),
          ),
          child: Column(
            children: [
              _buildStickyHeader(tokens),
              Expanded(
                child: SingleChildScrollView(
                  padding: const EdgeInsets.all(DsSpacing.md),
                  child: Column(
                    children: [
                      _buildErrorState(tokens.accent),
                      const SizedBox(height: DsSpacing.md),
                      _buildAccountManagement(
                        tokens,
                        tokens.isDark ? tokens.fg30 : tokens.muted20,
                        isOnline: true,
                      ),
                    ],
                  ),
                ),
              ),
            ],
          ),
        ),
      );
    }

    final Color boxBg = tokens.isDark ? tokens.fg30 : tokens.muted20;

    return StreamBuilder<bool>(
      stream: ConnectivityService().isOnlineStream,
      initialData: ConnectivityService().isOnline,
      builder: (context, snapshot) {
        final bool isOnline = snapshot.data ?? true;

        return Material(
          color: Colors.transparent,
          child: Container(
            decoration: BoxDecoration(
              color: tokens.bg,
              borderRadius: const BorderRadius.vertical(
                top: Radius.circular(DsRadii.xl),
              ),
            ),
            child: Column(
              children: [
                _buildStickyHeader(tokens),
                Expanded(
                  child: SingleChildScrollView(
                    padding: const EdgeInsets.all(DsSpacing.md),
                    child: Column(
                      children: [
                        _buildIdentitySection(tokens),
                        const SizedBox(height: DsSpacing.md),
                        _buildVerticalConfigurationStack(
                          tokens,
                          boxBg,
                          tokens.surface,
                          isOnline: isOnline,
                        ),
                        const SizedBox(height: DsSpacing.md),
                        _buildAccountManagement(
                          tokens,
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
        );
      },
    );
  }

  Widget _buildStickyHeader(AppTokens tokens) {
    return Container(
      padding: const EdgeInsets.symmetric(
        horizontal: DsSpacing.md,
        vertical: DsSpacing.sm,
      ),
      decoration: BoxDecoration(
        border: Border(bottom: BorderSide(color: tokens.borderLight)),
      ),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: [
          Flexible(
            child: Text(
              tr("settings.title"),
              overflow: TextOverflow.ellipsis,
              style: TextStyle(
                fontSize: tokens.textLg,
                fontWeight: FontWeight.bold,
                color: tokens.fg,
              ),
            ),
          ),
          Flexible(
            child: Row(
              mainAxisAlignment: MainAxisAlignment.end,
              mainAxisSize: MainAxisSize.min,
              children: [
                Tooltip(
                  message: tr("about.title"),
                  child: DsButton(
                    iconOnly: true,
                    icon: Icons.info_outline,
                    variant: DsButtonVariant.ghost,
                    overrideFg: tokens.fg,
                    onPressed: () => Navigator.pushNamed(context, '/about'),
                  ),
                ),
                const SizedBox(width: DsSpacing.xs),
                Flexible(
                  child: DsButton(
                    key: const Key('settings_close_button'),
                    label: tr("settings.close"),
                    variant: DsButtonVariant.ghost,
                    onPressed: () => Navigator.pop(context),
                    small: true,
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildIdentitySection(AppTokens tokens) {
    final String rawName = _userData['name'] ?? tr("settings.userName");
    final String name = rawName.isEmpty ? tr("settings.userName") : rawName;

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
          backgroundColor: tokens.accent,
          child: Text(
            initials,
            style: TextStyle(
              color: tokens.accentFg,
              fontSize: tokens.textXl,
              fontWeight: FontWeight.bold,
            ),
          ),
        ),
        const SizedBox(width: DsSpacing.md),
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                name,
                style: TextStyle(
                  fontSize: tokens.textLg,
                  fontWeight: FontWeight.bold,
                  color: tokens.fg,
                ),
              ),
              // BUG FIX: Rendering hydrated email state
              Text(
                _userData['email'],
                style: TextStyle(
                  color: tokens.muted,
                  fontSize: tokens.textBase,
                ),
              ),
              const SizedBox(height: DsSpacing.xs),
              Text(
                _userData['accountType'],
                style: TextStyle(
                  fontSize: tokens.textSm,
                  fontWeight: FontWeight.w600,
                  color: tokens.accent,
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
    AppTokens tokens,
    Color boxBg,
    Color dropdownBg, {
    required bool isOnline,
  }) {
    return Column(
      children: [
        _buildThemedGroupBox(
          tr("settings.display"),
          boxBg,
          tokens.fg,
          tokens.textMd,
          [
            _buildItemLabel(
              tr("settings.displayLanguage"),
              tokens.muted,
              tokens.textBase,
            ),
            // UPDATED: Passing tokens.fg ensures text is visible.
            // UPDATED: Passing dropdownBg ensures menu background matches dialog theme.
            LanguageSelector(
              textColor: tokens.fg,
              dropdownColor: dropdownBg,
              onChanged: isOnline ? _onLanguageChanged : null,
            ),
            const SizedBox(height: DsSpacing.lg),
            _buildItemLabel(
              tr("settings.theme"),
              tokens.muted,
              tokens.textBase,
            ),
            _buildThemeButtonRow(tokens),
            const SizedBox(height: DsSpacing.lg),
            _buildItemLabel(
              tr("settings.fontSize"),
              tokens.muted,
              tokens.textBase,
            ),
            _buildFontSizeSliderControl(tokens),
          ],
        ),
        const SizedBox(height: DsSpacing.md),
        _buildThemedGroupBox(
          tr("settings.notifications"),
          boxBg,
          tokens.fg,
          tokens.textMd,
          [
            // FIX: Passing accent color for switch
            // UPDATED: Disabled if OFFLINE
            _buildToggleRow(
              tr("settings.emailUpdates"),
              _emailUpdates,
              isOnline ? _onEmailUpdatesChanged : null,
              tokens.accent,
              tokens.fg,
              tokens.textBase,
            ),
            const SizedBox(height: DsSpacing.md),
            _buildToggleRow(
              tr("settings.soundNotifications"),
              _soundNotifications,
              isOnline ? _onSoundNotificationsChanged : null,
              tokens.accent,
              tokens.fg,
              tokens.textBase,
            ),
          ],
        ),
      ],
    );
  }

  Widget _buildAccountManagement(
    AppTokens tokens,
    Color boxBg, {
    required bool isOnline,
  }) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          tr("settings.accountManagement"),
          style: TextStyle(
            fontSize: tokens.textMd,
            fontWeight: FontWeight.bold,
            color: tokens.fg,
          ),
        ),
        const SizedBox(height: DsSpacing.md),
        DsCard(
          variant: DsCardVariant.standard,
          overrideBg: boxBg,
          padding: const EdgeInsets.all(DsSpacing.md),
          radius: DsRadii.lg,
          child: Column(
            children: [
              // 1. Manage My Account — opens Keycloak account console
              _buildActionBtnCard(
                "${tr("settings.manageMyAccount")} →",
                tr("settings.manageMyAccountDesc"),
                isOnline ? _openAccountConsole : null,
                key: const Key('settings_manage_account_button'),
              ),
              const SizedBox(height: DsSpacing.md),
              // 2. Reset User Data
              _buildActionBtnCard(
                tr("settings.resetUserData"),
                tr("settings.resetUserDataDesc"),
                isOnline ? _showResetDataWorkflow : null,
                key: const Key('settings_reset_data_button'),
                overrideColor: tokens.danger,
              ),
              const SizedBox(height: DsSpacing.md),
              // 3. Delete My Account — real GDPR deletion
              _buildActionBtnCard(
                tr("settings.deleteAccount"),
                tr("settings.deleteAccountDesc"),
                isOnline ? _initiateAccountDeletionFlow : null,
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
    double titleFontSize,
    List<Widget> children,
  ) {
    return Container(
      padding: const EdgeInsets.all(DsSpacing.lg),
      decoration: BoxDecoration(
        color: bg,
        borderRadius: BorderRadius.circular(DsRadii.md),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            title,
            style: TextStyle(
              fontSize: titleFontSize,
              fontWeight: FontWeight.bold,
              color: titleColor,
            ),
          ),
          const SizedBox(height: DsSpacing.lg),
          ...children,
        ],
      ),
    );
  }

  Widget _buildThemeButtonRow(AppTokens tokens) {
    final isLight = ThemeManager().userPreference != 'dark';
    return Row(
      children: [
        Expanded(
          child: _buildThemeToggleBtn(
            tr("settings.themeLight"),
            isLight,
            tokens,
            () => _onThemeChanged('light'),
          ),
        ),
        const SizedBox(width: DsSpacing.xs),
        Expanded(
          child: _buildThemeToggleBtn(
            tr("settings.themeDark"),
            !isLight,
            tokens,
            () => _onThemeChanged('dark'),
          ),
        ),
      ],
    );
  }

  Widget _buildThemeToggleBtn(
    String label,
    bool active,
    AppTokens tokens,
    VoidCallback onTap,
  ) {
    return InkWell(
      onTap: onTap,
      child: Container(
        padding: const EdgeInsets.symmetric(vertical: DsSpacing.xs),
        alignment: Alignment.center,
        decoration: BoxDecoration(
          color: active ? tokens.accent : tokens.muted20,
          borderRadius: BorderRadius.circular(DsRadii.sm),
        ),
        child: Text(
          label,
          style: TextStyle(
            color: active ? tokens.accentFg : tokens.muted,
            fontWeight: FontWeight.bold,
          ),
        ),
      ),
    );
  }

  Widget _buildFontSizeSliderControl(AppTokens tokens) {
    return Row(
      children: [
        Expanded(
          child: Slider(
            value: ThemeManager().fontSize,
            min: 30,
            max: 100,
            activeColor: tokens.accent,
            onChanged: _onFontSizeChanged,
          ),
        ),
        Text(
          "${ThemeManager().fontSize.toInt()}%",
          style: TextStyle(
            color: tokens.fg,
            fontWeight: FontWeight.bold,
            fontSize: tokens.textBase,
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
    Color textColor,
    double fontSize,
  ) {
    return Row(
      mainAxisAlignment: MainAxisAlignment.spaceBetween,
      children: [
        Expanded(
          child: Text(
            label,
            style: TextStyle(fontSize: fontSize, color: textColor),
          ),
        ),
        Switch(
          value: value,
          onChanged: onChanged,
          activeThumbColor: activeColor,
        ),
      ],
    );
  }

  Widget _buildActionBtnCard(
    String title,
    String desc,
    VoidCallback? onTap, {
    Key? key,
    bool isDanger = false,
    Color? overrideColor,
  }) {
    final tokens = ThemeManager().tokens;
    final DsButtonVariant variant = isDanger
        ? DsButtonVariant.danger
        : DsButtonVariant.secondary;

    return Column(
      children: [
        DsButton(
          key: key,
          label: title,
          variant: variant,
          onPressed: onTap,
          overrideBg: overrideColor,
          overrideFg: overrideColor != null ? tokens.accentFg : null,
        ),
        const SizedBox(height: DsSpacing.xs),
        Text(
          desc,
          style: TextStyle(fontSize: tokens.textXs, color: tokens.muted),
          textAlign: TextAlign.center,
        ),
      ],
    );
  }

  Widget _buildItemLabel(String text, Color color, double fontSize) {
    return Padding(
      padding: const EdgeInsets.only(bottom: DsSpacing.xs),
      child: Text(
        text,
        style: TextStyle(fontSize: fontSize, color: color),
      ),
    );
  }

  Widget _buildErrorState(Color accent) => Center(
    child: Column(
      mainAxisAlignment: MainAxisAlignment.center,
      children: [
        Text(_errorMessage!),
        const SizedBox(height: DsSpacing.md),
        DsButton(
          label: tr("settings.retry"),
          variant: DsButtonVariant.primary,
          onPressed: _fetchUserData,
        ),
      ],
    ),
  );
}
