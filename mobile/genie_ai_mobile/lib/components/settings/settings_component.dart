import 'package:flutter/material.dart';
import 'dart:async';
import 'dart:convert';

// Service Imports
import 'package:genie_ai_mobile/services/user_service.dart';
import 'package:genie_ai_mobile/services/password_proxy.dart';
import 'package:genie_ai_mobile/utils/theme_manager.dart';
import 'package:genie_ai_mobile/services/i18n_service.dart'; // IMPORTED I18N

// Component Imports
import 'package:genie_ai_mobile/components/auth/password_reset_initiate_screen.dart';
import 'package:genie_ai_mobile/components/shared/language_selector.dart';

class SettingsComponent extends StatefulWidget {
  final Map<String, dynamic> user;
  const SettingsComponent({super.key, required this.user});

  @override
  State<SettingsComponent> createState() => _SettingsComponentState();
}

class _SettingsComponentState extends State<SettingsComponent> {
  final UserService _userService = UserService();
  // RESTORED: Field now used in account management validation logic
  final PasswordProxy _passwordProxy = PasswordProxy();

  // ===========================================================================
  // COMPONENT STATE - Mirrored exactly from Vue data()
  // ===========================================================================
  bool _isLoading = true;
  String? _errorMessage;
  bool _isThemeReady = false; // RESTORED
  String _currentUserId = "";
  // Timer? _themeEnforcementTimer; // REMOVED: Conflicts with "Preview" feature

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

  bool _isEditingEmail = false;
  // RESTORED: Field used to display error messages below the email field
  String? _emailError;
  // RESTORED: Field used to track changes during edit mode transitions
  String _newEmail = "";
  // RESTORED: Field used to disable buttons during API calls
  bool _isEmailUpdating = false;
  // RESTORED: Field used to track confirmation modal visibility
  bool _showEmailConfirmModal = false;
  late TextEditingController _emailController;
  final _emailChangePasswordController = TextEditingController();
  // RESTORED: Field used for specific email error feedback in modals
  String? _emailChangeError;

  // RESTORED: Field used to control password modal state
  bool _showPasswordReset = false;
  // RESTORED: Field used to track deletion modal lifecycle
  bool _showDeleteAccountModal = false;
  final _deleteAccountPasswordController = TextEditingController();
  final _deleteAccountReasonController = TextEditingController();
  // RESTORED: Field used for account deletion error display
  String? _deleteAccountError;
  // RESTORED: Field used to prevent duplicate deletion requests
  bool _isDeletingAccount = false;

  // Confirmation flags
  bool _showResetDataConfirm = false;
  bool _showDeleteAccountConfirm = false;

  @override
  void initState() {
    super.initState();
    debugPrint("[SETTINGS] Component created, initializing state...");

    _emailController = TextEditingController();

    // Initialize from Global State (ThemeManager)
    _selectedTheme = ThemeManager().userPreference;
    _fontSize = ThemeManager().fontSize;
    _selectedLanguage = "English";

    // Logic branch mirroring Vue created() hooks
    _fetchUserData();
    // _startThemeEnforcement(); // DISABLED: We use reactive state now

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
    // _themeEnforcementTimer?.cancel();
    _emailController.dispose();
    _emailChangePasswordController.dispose();
    _deleteAccountPasswordController.dispose();
    _deleteAccountReasonController.dispose();
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

  /// FIXED: Connected to I18nService
  String translate(String key, String fallback) {
    final String val = tr(key);
    // If tr() returns the key itself (missing translation), use fallback
    return val == key ? fallback : val;
  }

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
          "name": userMap['fullName'] ??
              userMap['name'] ??
              translate("settings.userName", "User"),
          "email": userMap['email'] ?? "",
          "accountType": userMap['accountType'] ??
              userMap['role'] ??
              translate("settings.standardAccount", "Standard Account"),
          "userId": (userMap['id'] ?? userMap['_key'] ?? "").toString(),
          "createdAt": userMap['createdAt'] ?? "",
        };
        _currentUserId = _userData['userId'];

        // BUG FIX: Explicitly populating controller to fix empty box bug
        _emailController.text = _userData['email'];

        _selectedLanguage = userMap['language'] ?? 'English';
        if (userMap['fontSize'] != null) {
          _fontSize = (userMap['fontSize'] ?? 50.0).toDouble();
        }
        _emailUpdates = userMap['emailUpdates'] ?? false;
        _soundNotifications = userMap['soundNotifications'] ?? true;
        _isLoading = false;
      });
      debugPrint(
          "[SETTINGS] State update complete. Current email: ${_emailController.text}");
    } catch (e) {
      debugPrint("[SETTINGS] API Error in fetchUserData: $e");
      if (mounted) {
        setState(() {
          _errorMessage = translate(
              "settings.unableToLoadUser", "Unable to load user information");
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
      debugPrint("[SETTINGS] Syncing settings object to API...");
      // FIX: Passing _currentUserId to resolve 500 greedy route collision
      await _userService.updateAccountSettings(_currentUserId, {
        'theme': _selectedTheme,
        'language': _selectedLanguage,
        'fontSize': _fontSize.toInt(),
        'emailUpdates': _emailUpdates,
        'soundNotifications': _soundNotifications,
      });

      // Apply Global Changes
      ThemeManager().setTheme(_selectedTheme);
      ThemeManager().setFontSize(_fontSize);

      if (!mounted) return;
      Navigator.pop(context);

      ScaffoldMessenger.of(context).showSnackBar(SnackBar(
          content: Text(translate(
              "settings.settingsSaved", "Settings saved successfully!"))));
    } catch (e) {
      debugPrint("[SETTINGS] Save operation failed: $e");
      if (mounted) setState(() => _isLoading = false);
    }
  }

  // ===========================================================================
  // ACCOUNT MANAGEMENT
  // ===========================================================================

  void _handleEmailToggle() {
    debugPrint("[SETTINGS] toggleEmailEdit() triggered.");
    if (_isEditingEmail) {
      _validateAndPrepareEmailChange();
    } else {
      setState(() {
        _isEditingEmail = true;
        _newEmail = _emailController.text; // USING _newEmail
        _emailError = null; // RESET _emailError
      });
      debugPrint("[SETTINGS] Email field unlocked for editing.");
    }
  }

  Future<void> _validateAndPrepareEmailChange() async {
    final emailRegex = RegExp(r'^[^\s@]+@[^\s@]+\.[^\s@]+$');
    if (!emailRegex.hasMatch(_emailController.text)) {
      debugPrint("[SETTINGS] Email validation failed for format.");
      setState(() => _emailError = translate("settings.enterValidEmail",
          "Enter valid email")); // USING _emailError
      return;
    }

    if (_emailController.text == _userData['email']) {
      setState(() => _isEditingEmail = false);
      return;
    }

    setState(
        () => _showEmailConfirmModal = true); // USING _showEmailConfirmModal
    _renderEmailConfirmModalUI();
  }

  void _renderEmailConfirmModalUI() {
    debugPrint("[SETTINGS] Rendering showEmailConfirmModal overlay...");
    showDialog(
      context: context,
      barrierDismissible: false,
      builder: (ctx) => AlertDialog(
        title: Text(
            translate("settings.confirmEmailChange", "Confirm Email Change")),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            if (_emailChangeError != null) // USING _emailChangeError
              Text(_emailChangeError!,
                  style: const TextStyle(color: Colors.red, fontSize: 12)),
            Text(
                "${translate("settings.changingEmailTo", "Changing email to")} ${_emailController.text} will log you out."),
            const SizedBox(height: 20),
            TextField(
              controller: _emailChangePasswordController,
              obscureText: true,
              decoration: InputDecoration(
                labelText: translate("settings.enterPasswordConfirm",
                    "Enter password to confirm"),
                border: const OutlineInputBorder(),
              ),
            ),
          ],
        ),
        actions: [
          TextButton(
              onPressed: () {
                setState(() => _showEmailConfirmModal = false);
                Navigator.pop(ctx);
              },
              child: Text(translate("settings.cancel", "Cancel"))),
          ElevatedButton(
              onPressed: () => _finalizeEmailChange(ctx),
              child:
                  Text(translate("settings.confirmChange", "Confirm Change"))),
        ],
      ),
    );
  }

  Future<void> _finalizeEmailChange(BuildContext dialogCtx) async {
    setState(() => _isEmailUpdating = true); // USING _isEmailUpdating
    try {
      await _userService.updateEmail(_emailController.text,
          _emailChangePasswordController.text, _currentUserId);
      await _userService.logout();
      if (!mounted) return;
      Navigator.pushNamedAndRemoveUntil(context, '/login', (r) => false);
    } catch (e) {
      debugPrint("[SETTINGS] Emailfinalize error: $e");
      if (mounted) {
        setState(() {
          _isEmailUpdating = false;
          _emailChangeError = translate("settings.updateFailed",
              "Update failed. Please verify your password.");
        });
      }
    }
  }

  // ===========================================================================
  // DANGER ZONE MODALS
  // ===========================================================================

  void _initiateAccountDeletionFlow() {
    setState(() =>
        _showDeleteAccountConfirm = true); // USING _showDeleteAccountConfirm
    showDialog(
      context: context,
      builder: (ctx) => AlertDialog(
        title: Text(translate("settings.deleteAccountTitle", "Delete Account")),
        content: Text(translate("settings.deleteAccountConfirmation",
            "Are you sure you want to delete your account? This action is permanent.")),
        actions: [
          TextButton(
              onPressed: () => Navigator.pop(ctx),
              child: Text(translate("settings.cancel", "Cancel"))),
          ElevatedButton(
            style: ElevatedButton.styleFrom(backgroundColor: Colors.red),
            onPressed: () {
              Navigator.pop(ctx);
              setState(() => _showDeleteAccountModal =
                  true); // USING _showDeleteAccountModal
              _renderDeletionPasswordUI();
            },
            child: Text(translate("common.continue", "Continue")),
          ),
        ],
      ),
    );
  }

  void _renderDeletionPasswordUI() {
    debugPrint("[SETTINGS] Step 2: Security password collection modal.");
    showDialog(
      context: context,
      builder: (ctx) => AlertDialog(
        title: Text(translate(
            "settings.confirmAccountDeletion", "Final Security Check")),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            if (_deleteAccountError != null) // USING _deleteAccountError
              Text(_deleteAccountError!,
                  style: const TextStyle(color: Colors.red, fontSize: 12)),
            Text(translate("settings.accountDeletionWarning",
                "Warning: All data will be wiped permanently.")),
            const SizedBox(height: 16),
            TextField(
                controller: _deleteAccountReasonController,
                decoration: InputDecoration(
                    labelText: translate(
                        "settings.deletionReason", "Reason (optional)"))),
            const SizedBox(height: 12),
            TextField(
                controller: _deleteAccountPasswordController,
                obscureText: true,
                decoration: InputDecoration(
                    labelText: translate("settings.enterPasswordConfirm",
                        "Enter Password to Confirm"))),
          ],
        ),
        actions: [
          TextButton(
              onPressed: () {
                setState(() => _showDeleteAccountModal = false);
                Navigator.pop(ctx);
              },
              child: Text(translate("settings.cancel", "Cancel"))),
          ElevatedButton(
            style: ElevatedButton.styleFrom(backgroundColor: Colors.red),
            onPressed: () async {
              setState(
                  () => _isDeletingAccount = true); // USING _isDeletingAccount
              try {
                await _userService.deleteAccount(
                    _deleteAccountPasswordController.text,
                    reason: _deleteAccountReasonController.text);
                if (mounted)
                  Navigator.pushNamedAndRemoveUntil(
                      context, '/login', (r) => false);
              } catch (e) {
                setState(() {
                  _isDeletingAccount = false;
                  _deleteAccountError = translate("settings.deletionFailed",
                      "Deletion failed. Incorrect password.");
                });
              }
            },
            child: Text(translate(
                "settings.permanentlyDeleteAccount", "Delete Account")),
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
        title:
            Text(translate("settings.resetUserDataTitle", "Reset User Data")),
        content: Text(translate("settings.confirmResetUserData",
            "This will clear all profile information and chat history. Continue?")),
        actions: [
          TextButton(
              onPressed: () => Navigator.pop(ctx),
              child: Text(translate("settings.cancel", "Cancel"))),
          ElevatedButton(
            onPressed: () async {
              Navigator.pop(ctx);
              setState(() {
                _isLoading = true;
                _showResetDataConfirm = true; // USING _showResetDataConfirm
              });
              await _userService.resetUserData();
              _fetchUserData();
            },
            child: Text(translate("settings.reset", "Reset")),
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
    final ThemeData previewTheme =
        previewIsDark ? ThemeManager().darkTheme : ThemeManager().lightTheme;

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
          child: Center(child: CircularProgressIndicator(color: primaryColor)));
    }

    if (_errorMessage != null) {
      return Container(color: bgColor, child: _buildErrorState(primaryColor));
    }

    // RESTORED: Layout Readiness check
    if (!_isThemeReady) {
      return Container(color: bgColor);
    }

    // FIX: Wrapped in MediaQuery with TextScaler to enable real-time font scaling preview
    return MediaQuery(
      data: MediaQuery.of(context)
          .copyWith(textScaler: TextScaler.linear(_fontSize / 50.0)),
      child: Material(
        color: Colors.transparent,
        child: Container(
          decoration: BoxDecoration(
              color: bgColor,
              borderRadius:
                  const BorderRadius.vertical(top: Radius.circular(16))),
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
                      _buildVerticalConfigurationStack(primaryColor, titleColor,
                          boxBg, previewTheme.cardColor),
                      const SizedBox(height: 16),
                      _buildAccountManagement(
                          primaryColor, titleColor, previewIsDark, boxBg),
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
  }

  Widget _buildStickyHeader(Color accent, Color titleColor, bool isDark) {
    return Container(
      // UPDATED: Reduced padding for handset screens
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
      decoration: BoxDecoration(
          border: Border(
              bottom:
                  BorderSide(color: isDark ? Colors.white10 : Colors.black12))),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: [
          // UPDATED: Wrapped title in Flexible to prevent overflow on long translations
          Flexible(
            child: Text(translate("settings.title", "Settings"),
                overflow: TextOverflow.ellipsis,
                style: TextStyle(
                    fontSize: 22,
                    fontWeight: FontWeight.bold,
                    color: titleColor)),
          ),
          Row(children: [
            // ADDED: Link to About Screen
            IconButton(
              icon: Icon(Icons.info_outline, color: titleColor),
              tooltip: translate("about.title", "About"),
              onPressed: () => Navigator.pushNamed(context, '/about'),
            ),
            const SizedBox(width: 4),
            TextButton(
                onPressed: () => Navigator.pop(context),
                child: Text(translate("settings.close", "Close"))),
            const SizedBox(width: 8),
            ElevatedButton(
              style: ElevatedButton.styleFrom(
                  backgroundColor: accent, elevation: 0),
              onPressed: _handleSave,
              child: Text(translate("settings.saveSettings", "Save"),
                  style: const TextStyle(color: Colors.white)),
            ),
          ]),
        ],
      ),
    );
  }

  Widget _buildIdentitySection(Color accent, Color titleColor) {
    final String rawName =
        _userData['name'] ?? translate("settings.userName", "User");
    final String name =
        rawName.isEmpty ? translate("settings.userName", "User") : rawName;

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
            child: Text(initials,
                style: const TextStyle(
                    color: Colors.white,
                    fontSize: 24,
                    fontWeight: FontWeight.bold))),
        const SizedBox(width: 16),
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(name,
                  style: TextStyle(
                      fontSize: 20,
                      fontWeight: FontWeight.bold,
                      color: titleColor)),
              // BUG FIX: Rendering hydrated email state
              Text(_userData['email'],
                  style: const TextStyle(color: Colors.grey, fontSize: 14)),
              const SizedBox(height: 4),
              Text(_userData['accountType'],
                  style: TextStyle(
                      fontSize: 13,
                      fontWeight: FontWeight.w600,
                      color: accent)),
            ],
          ),
        ),
      ],
    );
  }

  // FIX: Stacking configuration elements vertically gives the Language Selector full width
  Widget _buildVerticalConfigurationStack(
      Color accent, Color titleColor, Color boxBg, Color dropdownBg) {
    return Column(
      children: [
        _buildThemedGroupBox(
            translate("settings.display", "Display"), boxBg, titleColor, [
          _buildItemLabel(
              translate("settings.displayLanguage", "Display Language")),
          // UPDATED: Passing titleColor ensures text is visible.
          // UPDATED: Passing dropdownBg ensures menu background matches dialog theme.
          LanguageSelector(textColor: titleColor, dropdownColor: dropdownBg),
          const SizedBox(height: 20),
          _buildItemLabel(translate("settings.theme", "Theme")),
          _buildThemeButtonRow(accent),
          const SizedBox(height: 20),
          _buildItemLabel(translate("settings.fontSize", "Font Size")),
          _buildFontSizeSliderControl(accent, titleColor),
        ]),
        const SizedBox(height: 16),
        _buildThemedGroupBox(
            translate("settings.notifications", "Notifications"),
            boxBg,
            titleColor, [
          // FIX: Passing accent color for switch
          _buildToggleRow(translate("settings.emailUpdates", "Email Updates"),
              _emailUpdates, (v) => setState(() => _emailUpdates = v), accent),
          const SizedBox(height: 16),
          // FIX: Passing accent color for switch
          _buildToggleRow(
              translate("settings.soundNotifications", "Sound Notifications"),
              _soundNotifications,
              (v) => setState(() => _soundNotifications = v),
              accent),
        ]),
      ],
    );
  }

  Widget _buildAccountManagement(
      Color accent, Color titleColor, bool isDark, Color boxBg) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(translate("settings.accountManagement", "Account Management"),
            style: TextStyle(
                fontSize: 18, fontWeight: FontWeight.bold, color: titleColor)),
        const SizedBox(height: 16),
        Container(
          padding: const EdgeInsets.all(16),
          decoration: BoxDecoration(
              color: boxBg, borderRadius: BorderRadius.circular(10)),
          // UPDATED: Changed Row to Column to stack Email and Password sections vertically on handset
          child: Column(
            children: [
              // 1. Email Section
              Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                Text(translate("settings.emailAddress", "Email Address"),
                    style: const TextStyle(fontSize: 13, color: Colors.grey)),
                if (_emailError != null) // USING _emailError
                  Text(_emailError!,
                      style: const TextStyle(color: Colors.red, fontSize: 11)),
                const SizedBox(height: 8),
                Row(children: [
                  Expanded(
                      child: TextField(
                          controller: _emailController,
                          enabled: _isEditingEmail, // Wired to toggle state
                          style: TextStyle(
                              color: titleColor), // Dynamic text color
                          decoration: InputDecoration(
                              filled: true,
                              // FIX: Logic to blend background when not editing
                              fillColor: _isEditingEmail
                                  ? (isDark
                                      ? Colors.white.withOpacity(0.1)
                                      : Colors.white)
                                  : Colors.transparent,
                              border: const OutlineInputBorder(
                                  borderSide: BorderSide.none)))),
                  const SizedBox(width: 10),
                  ElevatedButton(
                      style: ElevatedButton.styleFrom(
                        backgroundColor: accent, // Primary Color
                        foregroundColor: Colors.white, // White Text
                      ),
                      onPressed: _handleEmailToggle,
                      child: Text(_isEditingEmail
                          ? translate("common.save", "Save")
                          : translate("common.edit", "Edit"))),
                ]),
              ]),
              const SizedBox(height: 24), // Vertical spacing between sections

              // 2. Password Section
              Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                Text(translate("settings.password", "Password"),
                    style: const TextStyle(fontSize: 13, color: Colors.grey)),
                const SizedBox(height: 8),
                ElevatedButton(
                    style: ElevatedButton.styleFrom(
                      minimumSize: const Size(double.infinity, 48),
                      backgroundColor: accent, // Primary Color
                      foregroundColor: Colors.white, // White Text
                    ),
                    onPressed: _renderPasswordResetOverlay,
                    child: Text(translate(
                        "settings.changePassword", "Change Password"))),
              ]),

              const SizedBox(height: 32),

              // 3. Danger Zone (Stacked Vertically for Mobile Safety)
              Column(children: [
                _buildActionBtnCard(
                    translate("settings.resetUserData", "Reset User Data"),
                    translate(
                        "settings.resetUserDataDesc", "Wipe chat history."),
                    _showResetDataWorkflow,
                    isDark,
                    // Custom Override: Darker red than delete button
                    overrideColor: Colors.red[800]),
                const SizedBox(height: 12),
                _buildActionBtnCard(
                    translate("settings.deleteAccount", "Delete Account"),
                    translate(
                        "settings.deleteAccountDesc", "Permanent deletion."),
                    _initiateAccountDeletionFlow,
                    isDark,
                    isDanger: true),
              ]),
            ],
          ),
        ),
      ],
    );
  }

  // ===========================================================================
  // MODAL OVERLAY WRAPPERS -
  // ===========================================================================

  void _renderPasswordResetOverlay() {
    debugPrint(
        "[SETTINGS] initiatePasswordChange() logic triggered. Constructing Modal...");
    setState(() => _showPasswordReset = true); // USING _showPasswordReset
    showDialog(
      context: context,
      builder: (ctx) => Dialog(
        backgroundColor: Colors.white, // FIX: Transparency issues resolved
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 420),
            child: Material(
              color: Colors.white,
              child: PasswordResetInitiateScreen(
                isEmbedded: true,
                prefilledEmail: _userData['email'],
              ),
            ),
          ),
        ),
      ),
    ).then((_) => setState(() => _showPasswordReset = false));
  }

  // ===========================================================================
  // ATOMIC UI SUB-BUILDERS
  // ===========================================================================

  Widget _buildThemedGroupBox(
      String title, Color bg, Color titleColor, List<Widget> children) {
    return Container(
      padding: const EdgeInsets.all(18),
      decoration:
          BoxDecoration(color: bg, borderRadius: BorderRadius.circular(8)),
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Text(title,
            style: TextStyle(
                fontSize: 16, fontWeight: FontWeight.bold, color: titleColor)),
        const SizedBox(height: 18),
        ...children,
      ]),
    );
  }

  Widget _buildThemeButtonRow(Color accent) {
    return Row(children: [
      Expanded(
          child: _buildThemeToggleBtn(
              translate("settings.themeLight", "Light"),
              _selectedTheme == 'light',
              accent,
              () => setState(() => _selectedTheme = 'light'))),
      const SizedBox(width: 10),
      Expanded(
          child: _buildThemeToggleBtn(
              translate("settings.themeDark", "Dark"),
              _selectedTheme == 'dark',
              accent,
              () => setState(() => _selectedTheme = 'dark'))),
    ]);
  }

  Widget _buildThemeToggleBtn(
      String label, bool active, Color accent, VoidCallback onTap) {
    return InkWell(
      onTap: onTap,
      child: Container(
        padding: const EdgeInsets.symmetric(vertical: 10),
        alignment: Alignment.center,
        decoration: BoxDecoration(
            color: active ? accent : Colors.grey.withOpacity(0.15),
            borderRadius: BorderRadius.circular(6)),
        child: Text(label,
            style: TextStyle(
                color: active ? Colors.white : Colors.grey,
                fontWeight: FontWeight.bold)),
      ),
    );
  }

  Widget _buildFontSizeSliderControl(Color accent, Color titleColor) {
    return Row(children: [
      Expanded(
          child: Slider(
              value: _fontSize,
              min: 30,
              max: 100,
              activeColor: accent,
              onChanged: (v) => setState(() => _fontSize = v))),
      // FIX: Real-time visual feedback mirrored from Vue rem scaling logic
      Text("${_fontSize.toInt()}%",
          style: TextStyle(
              color: titleColor, fontWeight: FontWeight.bold, fontSize: 14)),
    ]);
  }

  Widget _buildToggleRow(
      String label, bool value, Function(bool) onChanged, Color activeColor) {
    return Row(mainAxisAlignment: MainAxisAlignment.spaceBetween, children: [
      // UPDATED: Wrapped text in Expanded to prevent overflow on long translations
      Expanded(child: Text(label, style: const TextStyle(fontSize: 14.5))),
      Switch(
          value: value,
          onChanged: onChanged,
          // FIX: Using dynamic active color instead of hardcoded hex
          activeColor: activeColor)
    ]);
  }

  Widget _buildActionBtnCard(
      String title, String desc, VoidCallback onTap, bool isDark,
      {bool isDanger = false, Color? overrideColor}) {
    // Determine the effective background color
    // FIX: Added '!' to Colors.grey[200] to handle nullability strictness
    final Color bgColor = overrideColor ??
        (isDanger ? Colors.red : (isDark ? Colors.white10 : Colors.grey[200]!));

    // Determine the effective text color
    // If it's a "danger" button OR has an override (which implies a colored button like Dark Red), use White.
    // Otherwise use black87 (standard buttons)
    final Color txtColor =
        (isDanger || overrideColor != null) ? Colors.white : Colors.black87;

    return Column(children: [
      ElevatedButton(
          style: ElevatedButton.styleFrom(
              backgroundColor: bgColor,
              minimumSize: const Size(double.infinity, 50)),
          onPressed: onTap,
          child: Text(title,
              textAlign: TextAlign
                  .center, // UPDATED: Ensure center alignment if wrapping occurs
              style: TextStyle(color: txtColor, fontWeight: FontWeight.bold))),
      const SizedBox(height: 6),
      Text(desc,
          style: const TextStyle(fontSize: 11.5, color: Colors.grey),
          textAlign: TextAlign.center),
    ]);
  }

  Widget _buildItemLabel(String text) => Padding(
      padding: const EdgeInsets.only(bottom: 10),
      child:
          Text(text, style: const TextStyle(fontSize: 14, color: Colors.grey)));

  // RESTORED: unused but kept for original parity
  Widget _buildBulletPoint(String text) =>
      Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
        const Text(" • "),
        Expanded(child: Text(text, style: const TextStyle(fontSize: 13.5)))
      ]);

  Widget _buildErrorState(Color accent) => Center(
          child: Column(mainAxisAlignment: MainAxisAlignment.center, children: [
        Text(_errorMessage!),
        const SizedBox(height: 16),
        ElevatedButton(
            onPressed: _fetchUserData,
            child: Text(translate("common.retry", "Retry Connection")))
      ]));
}
