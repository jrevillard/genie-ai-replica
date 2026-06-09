// lib/screens/user_profile_screen.dart
// FULL FILE - FIXED I18N KEYS TO MATCH DE.DART STRUCTURE + RESTORED LOGIC

import 'dart:io';
import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:image_picker/image_picker.dart';
import 'package:file_picker/file_picker.dart';
import 'package:country_picker/country_picker.dart';
import 'package:genie_ai_mobile/providers/api_providers.dart';
import 'package:genie_ai_mobile/services/i18n_service.dart'; // IMPORTED I18N SERVICE
import 'package:genie_ai_mobile/utils/theme_manager.dart';
import 'package:genie_ai_mobile/design_system/tokens/spacing.dart';
import 'package:genie_ai_mobile/design_system/tokens/radii.dart';
import 'package:genie_ai_mobile/design_system/components/ds_button.dart';

class UserProfileScreen extends ConsumerStatefulWidget {
  final Map<String, dynamic> user;

  const UserProfileScreen({super.key, required this.user});

  @override
  ConsumerState<UserProfileScreen> createState() => _UserProfileScreenState();
}

class _UserProfileScreenState extends ConsumerState<UserProfileScreen>
    with SingleTickerProviderStateMixin {
  final ImagePicker _imagePicker = ImagePicker();
  final FilePicker _filePicker = FilePicker.platform;

  late TabController _tabController;

  // These align with keys in de.dart -> userProfile.tabsShort
  final List<String> _tabs = [
    'personal',
    'civil',
    'address',
    'identity',
    'health',
    'employment',
    'education',
    'financial',
    'social',
    'criminal',
    'transport',
    'civic',
  ];

  bool _isLoading = true;
  String? _errorMessage;
  String _userId = '';

  Map<String, dynamic> _formData = {};

  bool _showIconSelector = false;
  String _iconTab = 'preset';
  Color _initialsColor = ThemeManager().tokens.brand;

  List<Color> get _colorOptions => [
    ThemeManager().tokens.brand,
    ThemeManager().tokens.success,
    ThemeManager().tokens.danger,
    Colors.purple,
    Colors.orange,
    Colors.teal,
    Colors.pink,
    Colors.indigo,
  ];

  final List<String> _presetIcons = [
    'assets/icons/profile1.png',
    'assets/icons/profile2.png',
    'assets/icons/profile3.png',
    'assets/icons/profile4.png',
    'assets/icons/profile5.png',
    'assets/icons/profile6.png',
    'assets/icons/profile7.png',
    'assets/icons/profile8.png',
  ];

  final List<String> _genders = [
    'Male',
    'Female',
    'Other',
    'Prefer not to say',
  ];

  final List<String> _maritalStatuses = [
    'Single',
    'Married',
    'Divorced',
    'Widowed',
    'Separated',
    'Domestic Partnership',
  ];

  final List<String> _bloodTypes = [
    'A+',
    'A-',
    'B+',
    'B-',
    'AB+',
    'AB-',
    'O+',
    'O-',
    'Unknown',
  ];

  @override
  void initState() {
    super.initState();
    _tabController = TabController(length: _tabs.length, vsync: this);
    _userId =
        widget.user['id'] ?? widget.user['_id'] ?? widget.user['userId'] ?? '';
    debugPrint(
      '[PROFILE SCREEN] Extracted userId: "$_userId" from widget.user: ${widget.user}',
    );
    if (_userId.isEmpty) {
      _errorMessage = 'User ID not found';
      _isLoading = false;
      debugPrint('[PROFILE SCREEN] ERROR: User ID is empty');
    } else {
      _loadProfile();
    }
  }

  @override
  void dispose() {
    debugPrint('[PROFILE SCREEN] dispose() called');
    _tabController.dispose();
    super.dispose();
  }

  Future<void> _loadProfile() async {
    debugPrint('[PROFILE SCREEN] _loadProfile() started for userId: $_userId');
    setState(() {
      _isLoading = true;
      _errorMessage = null;
    });

    try {
      debugPrint(
        '[PROFILE SCREEN] Calling currentUserApi.apiMeGetWithHttpInfo()',
      );
      final api = ref.read(currentUserApiProvider);
      final response = await api.apiMeGetWithHttpInfo();
      if (response.statusCode != 200) {
        throw Exception('Failed to load profile: ${response.statusCode}');
      }
      final data = jsonDecode(response.body) as Map<String, dynamic>;
      debugPrint(
        '[PROFILE SCREEN] API response received. Keys: ${data.keys.toList()}',
      );

      setState(() {
        debugPrint('[PROFILE SCREEN] Creating empty profile structure');
        _formData = _getEmptyProfile();
        debugPrint(
          '[PROFILE SCREEN] Empty profile created with keys: ${_formData.keys.toList()}',
        );

        debugPrint('[PROFILE SCREEN] Starting safe merge');
        try {
          _formData = _safeMerge(_formData, data);
          debugPrint('[PROFILE SCREEN] Safe merge SUCCESS');
          debugPrint(
            '[PROFILE SCREEN] Final _formData keys: ${_formData.keys.toList()}',
          );
        } catch (e, stack) {
          debugPrint('[PROFILE SCREEN] EXCEPTION IN SAFE MERGE: $e');
          debugPrint('[PROFILE SCREEN] Stack trace: $stack');
          rethrow;
        }
      });
    } catch (e, stack) {
      debugPrint('[PROFILE SCREEN] FAILED TO LOAD PROFILE: $e');
      debugPrint('[PROFILE SCREEN] Load stack trace: $stack');
      setState(() => _errorMessage = 'Failed to load profile: $e');
    } finally {
      setState(() => _isLoading = false);
      debugPrint('[PROFILE SCREEN] _loadProfile finished');
    }
  }

  Map<String, dynamic> _getEmptyProfile() {
    final empty = {
      "personalIdentification": <String, dynamic>{
        "fullName": "",
        "dob": "",
        "gender": "",
        "nationality": "",
        "maritalStatus": "",
        "profileIcon": null,
      },
      "civilRegistration": <String, dynamic>{
        "birthCert": null,
        "deathCert": null,
        "marriageDivorce": null,
        "adoption": null,
        "citizenship": null,
        "immigration": null,
      },
      "addressResidency": <String, dynamic>{
        "currentAddress": "",
        "previousAddresses": "",
        "homeOrRental": "",
        "utilityBills": null,
        "landRecords": null,
      },
      "identityTravel": <String, dynamic>{
        "idCard": "",
        "passport": "",
        "driversLicense": "",
        "voterId": "",
        "ssn": "",
        "militaryRecords": null,
      },
      "healthMedical": <String, dynamic>{
        "medicalHistory": "",
        "vaccinations": null,
        "insuranceDetails": "",
        "disability": "",
        "organDonor": "",
        "prescriptions": "",
        "mentalHealth": "",
        "bloodType": "",
      },
      "employment": <String, dynamic>{
        "eHistory": "",
        "currentEmployer": "",
        "workPermits": null,
        "certifications": null,
        "unemployment": "",
        "tin": "",
        "businessAffiliations": "",
      },
      "education": <String, dynamic>{
        "schools": "",
        "diplomas": "",
        "performance": "",
        "scholarships": "",
      },
      "financialTax": <String, dynamic>{
        "incomeTax": null,
        "bankAccounts": "",
        "propertyTax": null,
        "businessTax": null,
        "pensionContrib": null,
        "loanAid": null,
      },
      "socialSecurity": <String, dynamic>{
        "pensionStatus": "",
        "unemployment": "",
        "disability": "",
        "childcare": "",
        "foodAssistance": "",
        "housingAssistance": "",
      },
      "criminalLegal": <String, dynamic>{
        "policeRecords": null,
        "courtCases": null,
        "finesPenalties": null,
        "paroleProbation": "",
        "citizenshipRevocation": "",
      },
      "transportation": <String, dynamic>{
        "vehicleReg": "",
        "trafficViolations": null,
        "licenseHistory": "",
        "publicTransportCard": "",
      },
      "civicParticipation": <String, dynamic>{
        "voterRegistration": "",
        "electionHistory": "",
        "partyMembership": "",
        "militaryStatus": "",
        "publicServiceRoles": "",
      },
    };
    debugPrint(
      '[PROFILE SCREEN] _getEmptyProfile() created with ${empty.keys.length} top-level sections',
    );
    return empty;
  }

  Map<String, dynamic> _safeMerge(
    Map<String, dynamic> base,
    Map<String, dynamic> override,
  ) {
    final List<String> validSections = [
      'personalIdentification',
      'civilRegistration',
      'addressResidency',
      'identityTravel',
      'healthMedical',
      'employment',
      'education',
      'financialTax',
      'socialSecurity',
      'criminalLegal',
      'transportation',
      'civicParticipation',
    ];

    debugPrint(
      '[SAFE MERGE] Starting safe merge. Valid sections: $validSections',
    );
    debugPrint('[SAFE MERGE] Override keys: ${override.keys.toList()}');

    for (final section in validSections) {
      if (override.containsKey(section)) {
        debugPrint('[SAFE MERGE] Merging section: $section');
        if (override[section] is Map<String, dynamic> &&
            base[section] is Map<String, dynamic>) {
          base[section] = _deepMerge(
            base[section] as Map<String, dynamic>,
            override[section],
          );
        } else {
          base[section] = override[section];
          debugPrint('[SAFE MERGE] Section $section replaced entirely');
        }
      } else {
        debugPrint('[SAFE MERGE] Section $section not present in override');
      }
    }

    debugPrint('[SAFE MERGE] Safe merge completed');
    return base;
  }

  Map<String, dynamic> _deepMerge(
    Map<String, dynamic> base,
    Map<String, dynamic> override,
  ) {
    debugPrint(
      '[DEEP MERGE] Starting deep merge. Base keys: ${base.keys.toList()} | Override keys: ${override.keys.toList()}',
    );

    override.forEach((key, value) {
      debugPrint('[DEEP MERGE] Processing key: "$key"');
      debugPrint(
        '[DEEP MERGE]   Override value type: ${value.runtimeType} | value: $value',
      );
      debugPrint(
        '[DEEP MERGE]   Base current value type: ${base[key]?.runtimeType} | value: ${base[key]}',
      );

      if (value is Map<String, dynamic> && base[key] is Map<String, dynamic>) {
        debugPrint('[DEEP MERGE]   Recursing into nested map for key "$key"');
        base[key] = _deepMerge(base[key] as Map<String, dynamic>, value);
      } else {
        base[key] = value;
        debugPrint('[DEEP MERGE]   Forced assignment: base["$key"] = $value');
      }
    });

    debugPrint('[DEEP MERGE] Deep merge completed for this level');
    return base;
  }

  String _getInitials(String? name) {
    if (name == null || name.trim().isEmpty) return '?';
    final parts = name.trim().split(' ');
    if (parts.length >= 2) return '${parts[0][0]}${parts[1][0]}'.toUpperCase();
    return name[0].toUpperCase();
  }

  Future<void> _pickImageForIcon() async {
    debugPrint('[ICON PICKER] Opening gallery picker');
    final XFile? file = await _imagePicker.pickImage(
      source: ImageSource.gallery,
    );
    if (file != null && mounted) {
      debugPrint('[ICON PICKER] Image selected: ${file.name}');
      setState(() {
        _formData['personalIdentification']['profileIcon'] = file;
        _showIconSelector = false;
      });
    } else {
      debugPrint('[ICON PICKER] Picker cancelled or no image selected');
    }
  }

  Future<void> _pickFile(String section, String field) async {
    debugPrint('[FILE PICKER] Opening picker for $section.$field');
    final FilePickerResult? result = await _filePicker.pickFiles(
      type: FileType.any,
    );
    if (result != null && result.files.isNotEmpty) {
      final platformFile = result.files.single;
      debugPrint('[FILE PICKER] Selected file name: ${platformFile.name}');
      debugPrint(
        '[FILE PICKER] bytes available: ${platformFile.bytes != null}',
      );

      XFile xfile;
      if (platformFile.bytes != null) {
        xfile = XFile.fromData(platformFile.bytes!, name: platformFile.name);
        debugPrint('[FILE PICKER] Created XFile from bytes (web)');
      } else {
        if (platformFile.path == null) {
          debugPrint('[FILE PICKER] Unexpected: path is null on mobile');
          if (!mounted) return;
          final tokens = ThemeManager().tokens;
          ScaffoldMessenger.of(context).showSnackBar(
            SnackBar(
              backgroundColor: tokens.surface,
              content: Text(
                tr(
                  'upload.notifications.uploadFailed',
                  args: {'fileName': 'Data'},
                ),
                style: TextStyle(color: tokens.fg),
              ),
            ), // Fallback error
          );
          return;
        }
        xfile = XFile(platformFile.path!);
        debugPrint('[FILE PICKER] Created XFile from path (mobile)');
      }

      setState(() {
        _formData[section] ??= {};
        _formData[section][field] = xfile;
        debugPrint(
          '[FILE PICKER] Successfully stored XFile for $section.$field',
        );
      });
    } else {
      debugPrint('[FILE PICKER] Picker cancelled or no file selected');
    }
  }

  Future<Map<String, dynamic>> _prepareDataForSubmission(
    Map<String, dynamic> data,
  ) async {
    final Map<String, dynamic> output = {};

    for (final key in data.keys) {
      final value = data[key];

      if (value is Map<String, dynamic>) {
        output[key] = await _prepareDataForSubmission(value);
      } else if (value is XFile) {
        debugPrint('[DATA PREP] Processing file: ${value.name}');
        try {
          final bytes = await value.readAsBytes();
          final base64String = base64Encode(bytes);
          final fileData = {
            'fileName': value.name,
            'fileSize': bytes.length,
            'mimeType': value.mimeType ?? 'application/octet-stream',
            'data': base64String,
          };
          output[key] = jsonEncode(fileData);
        } catch (e) {
          debugPrint('[DATA PREP] Error reading file $key: $e');
          output[key] = null;
        }
      } else {
        output[key] = value;
      }
    }
    return output;
  }

  Future<void> _saveProfile() async {
    debugPrint('[PROFILE SCREEN] Save button pressed');
    setState(() => _isLoading = true);

    try {
      debugPrint('[PROFILE SCREEN] Encoding files for API transmission...');
      final dataToSubmit = await _prepareDataForSubmission(_formData);

      final api = ref.read(currentUserApiProvider);
      await api.apiMePutWithHttpInfo(data: jsonEncode(dataToSubmit));

      debugPrint('[PROFILE SCREEN] Profile saved successfully');
      if (mounted) {
        final tokens = ThemeManager().tokens;
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            backgroundColor: tokens.surface,
            content: Text(
              tr('userProfile.saveSuccess'),
              style: TextStyle(color: tokens.fg),
            ),
          ), // Correct Key
        );
        Navigator.pop(context);
      }
    } catch (e, stack) {
      debugPrint('[PROFILE SCREEN] SAVE FAILED: $e');
      debugPrint('[PROFILE SCREEN] Save stack trace: $stack');
      if (mounted) {
        final tokens = ThemeManager().tokens;
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            backgroundColor: tokens.surface,
            content: Text(
              '${tr('userProfile.errors.savingFailed')}: $e',
              style: TextStyle(color: tokens.fg),
            ),
          ),
        );
      }
    } finally {
      if (mounted) {
        setState(() => _isLoading = false);
      }
    }
  }

  // Helper to translate dropdown items like "Male", "Married"
  // based on keys in de.dart (userProfile.gender.male, etc)
  String _translateDropdownItem(String type, String value) {
    String key = '';
    // Normalize value to camelCase for key lookup (e.g. "Domestic Partnership" -> "other" or specific)
    // Based on de.dart, we have: single, married, divorced, widowed, other.
    // Genders: male, female, other, preferNot

    final lower = value.toLowerCase();
    if (type == 'gender') {
      if (lower == 'male') {
        key = 'male';
      } else if (lower == 'female') {
        key = 'female';
      } else if (lower == 'other') {
        key = 'other';
      } else if (lower.contains('prefer')) {
        key = 'preferNot';
      }
      return tr('userProfile.gender.$key');
    } else if (type == 'marital') {
      if (lower == 'single') {
        key = 'single';
      } else if (lower == 'married') {
        key = 'married';
      } else if (lower == 'divorced') {
        key = 'divorced';
      } else if (lower == 'widowed') {
        key = 'widowed';
      } else {
        key =
            'other'; // Fallback for Separated/Domestic Partnership as they aren't in de.dart
      }
      return tr('userProfile.maritalStatus.$key');
    } else if (type == 'blood') {
      // keys: aPositive, aNegative...
      // value: A+, A-
      // Basic mapping
      Map<String, String> map = {
        'A+': 'aPositive',
        'A-': 'aNegative',
        'B+': 'bPositive',
        'B-': 'bNegative',
        'AB+': 'abPositive',
        'AB-': 'abNegative',
        'O+': 'oPositive',
        'O-': 'oNegative',
        'Unknown': 'unknown',
      };
      if (map.containsKey(value)) {
        return tr('userProfile.bloodTypes.${map[value]}');
      }
    }

    return value; // Fallback to raw string
  }

  Widget _buildProfileIcon() {
    final tokens = ThemeManager().tokens;
    final icon = _formData['personalIdentification']?['profileIcon'];
    debugPrint(
      '[UI] Building profile icon, current value: $icon (${icon.runtimeType})',
    );

    String? url;
    String? assetPath;
    XFile? xfile;
    File? file;

    if (icon is String && icon.startsWith('http')) url = icon;
    if (icon is String && icon.startsWith('assets/')) assetPath = icon;
    if (icon is XFile) xfile = icon;
    if (icon is File) file = icon;

    return GestureDetector(
      onTap: () => setState(() => _showIconSelector = true),
      child: Stack(
        alignment: Alignment.center,
        children: [
          CircleAvatar(
            radius: 60,
            backgroundImage: file != null
                ? FileImage(file)
                : xfile != null
                ? FileImage(File(xfile.path))
                : url != null
                ? NetworkImage(url)
                : assetPath != null
                ? AssetImage(assetPath) as ImageProvider
                : null,
            backgroundColor:
                url == null &&
                    xfile == null &&
                    file == null &&
                    assetPath == null
                ? _initialsColor
                : null,
            child:
                url == null &&
                    xfile == null &&
                    file == null &&
                    assetPath == null
                ? Text(
                    _getInitials(
                      _formData['personalIdentification']?['fullName'],
                    ),
                    style: TextStyle(
                      fontSize: 50,
                      color: tokens.fg,
                      fontWeight: FontWeight.bold,
                    ),
                  )
                : null,
          ),
          Positioned(
            bottom: 0,
            right: 0,
            child: Container(
              padding: const EdgeInsets.all(DsSpacing.sm),
              decoration: BoxDecoration(
                color: tokens.scrim,
                shape: BoxShape.circle,
              ),
              child: Icon(Icons.edit, color: tokens.fg, size: 24),
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildTextField(
    String labelKey,
    String section,
    String field, {
    bool multiline = false,
  }) {
    final String currentValue = (_formData[section]?[field]?.toString() ?? '');

    // I18N: Translate using the Key provided
    final String translatedLabel = tr(labelKey);

    debugPrint(
      '[UI] Building TextField Key: "$labelKey" -> "$translatedLabel"',
    );

    return Padding(
      padding: const EdgeInsets.symmetric(vertical: DsSpacing.sm),
      child: TextFormField(
        initialValue: currentValue,
        decoration: InputDecoration(
          labelText: translatedLabel,
          border: const OutlineInputBorder(),
        ),
        maxLines: multiline ? 4 : 1,
        onChanged: (v) {
          setState(() {
            _formData[section] ??= {};
            _formData[section][field] = v.isEmpty ? null : v;
            debugPrint(
              '[UI] TextField updated $section.$field = "${v.isEmpty ? "null" : v}"',
            );
          });
        },
      ),
    );
  }

  Widget _buildDropdown(
    String labelKey,
    String section,
    String field,
    List<String> items, {
    String type = 'general',
  }) {
    final String? currentValue = _formData[section]?[field];

    final String translatedLabel = tr(labelKey);
    debugPrint('[UI] Building Dropdown Key: "$labelKey" -> "$translatedLabel"');

    String? normalizedValue;
    if (currentValue != null && currentValue.isNotEmpty) {
      normalizedValue = items.firstWhere(
        (item) => item.toLowerCase() == currentValue.toLowerCase(),
        orElse: () => currentValue,
      );
    }

    return Padding(
      padding: const EdgeInsets.symmetric(vertical: DsSpacing.sm),
      child: DropdownButtonFormField<String>(
        initialValue: normalizedValue,
        decoration: InputDecoration(
          labelText: translatedLabel,
          border: const OutlineInputBorder(),
        ),
        items: items
            .map(
              (item) => DropdownMenuItem(
                value: item,
                child: Text(_translateDropdownItem(type, item)),
              ),
            ) // Translate Item
            .toList(),
        onChanged: (v) {
          setState(() {
            _formData[section] ??= {};
            _formData[section][field] = v;
            debugPrint('[UI] Dropdown updated $section.$field = "$v"');
          });
        },
      ),
    );
  }

  Widget _buildSearchableCountryPicker(
    String labelKey,
    String section,
    String field,
  ) {
    final String currentValue = _formData[section]?[field] ?? '';
    final String translatedLabel = tr(labelKey);

    return Padding(
      padding: const EdgeInsets.symmetric(vertical: DsSpacing.sm),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(translatedLabel, style: Theme.of(context).textTheme.titleMedium),
          const SizedBox(height: DsSpacing.sm),
          DsButton(
            label: currentValue.isEmpty
                ? tr('userProfile.placeholders.selectCountry')
                : currentValue,
            icon: Icons.flag,
            variant: DsButtonVariant.secondary,
            onPressed: () {
              debugPrint('[UI] Country picker opened for $section.$field');
              showCountryPicker(
                context: context,
                showPhoneCode: false,
                onSelect: (Country country) {
                  setState(() {
                    _formData[section] ??= {};
                    _formData[section][field] = country.name;
                    debugPrint(
                      '[UI] Country selected: "${country.name}" for $section.$field',
                    );
                  });
                },
                countryListTheme: CountryListThemeData(
                  inputDecoration: InputDecoration(
                    labelText: tr(
                      'userProfile.placeholders.searchCountries',
                    ), // Correct Key
                    border: const OutlineInputBorder(),
                  ),
                ),
              );
            },
          ),
        ],
      ),
    );
  }

  Widget _buildFilePicker(String labelKey, String section, String field) {
    final tokens = ThemeManager().tokens;
    final file = _formData[section]?[field];

    // Use fallback string if translation missing for "Attached File"
    String fileName =
        tr('userProfile.noFileSelected') == 'userProfile.noFileSelected'
        ? 'No file selected'
        : tr('userProfile.noFileSelected');

    final String translatedLabel = tr(labelKey);

    if (file is XFile) {
      fileName = file.name;
    } else if (file is File) {
      fileName = file.path.split(Platform.pathSeparator).last;
    } else if (file is String && file.isNotEmpty) {
      try {
        if (file.trim().startsWith('{')) {
          final Map<String, dynamic> data = jsonDecode(file);
          fileName = data['fileName'] ?? 'Attached File';
        } else {
          fileName = file.length > 20
              ? '...${file.substring(file.length - 20)}'
              : file;
        }
      } catch (e) {
        fileName = 'Attached File (Unknown)';
      }
    }

    return Padding(
      padding: const EdgeInsets.symmetric(vertical: DsSpacing.sm),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(translatedLabel, style: Theme.of(context).textTheme.titleMedium),
          const SizedBox(height: DsSpacing.sm),
          Row(
            children: [
              Expanded(
                child: Text(
                  fileName,
                  style: TextStyle(color: tokens.muted),
                  overflow: TextOverflow.ellipsis,
                ),
              ),
              const SizedBox(width: 10),
              DsButton(
                label: tr('userProfile.uploadFile'),
                variant: DsButtonVariant.primary,
                onPressed: () => _pickFile(section, field),
              ),
            ],
          ),
        ],
      ),
    );
  }

  Widget _buildDateOfBirthPicker() {
    final tokens = ThemeManager().tokens;
    final String currentDob = _formData['personalIdentification']?['dob'] ?? '';
    debugPrint('[UI] Building DateOfBirthPicker, current value: "$currentDob"');

    DateTime? selectedDate;
    if (currentDob.isNotEmpty) {
      selectedDate = DateTime.tryParse(currentDob);
      debugPrint('[UI] Parsed existing DOB: $selectedDate');
    }

    return Padding(
      padding: const EdgeInsets.symmetric(vertical: DsSpacing.sm),
      child: InkWell(
        onTap: () async {
          debugPrint('[UI] Date picker tapped');
          final DateTime? picked = await showDatePicker(
            context: context,
            initialDate: selectedDate ?? DateTime.now(),
            firstDate: DateTime(1900),
            lastDate: DateTime.now(),
            builder: (context, child) {
              return Theme(
                data: Theme.of(context).copyWith(
                  colorScheme: Theme.of(
                    context,
                  ).colorScheme.copyWith(primary: tokens.brand),
                ),
                child: child!,
              );
            },
          );

          if (picked != null) {
            final String formatted =
                '${picked.year}-${picked.month.toString().padLeft(2, '0')}-${picked.day.toString().padLeft(2, '0')}';
            debugPrint('[UI] Date selected: $formatted');
            setState(() {
              _formData['personalIdentification'] ??= {};
              _formData['personalIdentification']['dob'] = formatted;
            });
          } else {
            debugPrint('[UI] Date picker cancelled');
          }
        },
        child: InputDecorator(
          decoration: InputDecoration(
            labelText: tr('userProfile.fields.dob'), // Key: Geburtsdatum
            border: const OutlineInputBorder(),
          ),
          child: Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Text(
                currentDob.isEmpty
                    ? '${tr('userProfile.instructions.dobHelp').substring(0, 10)}...'
                    : currentDob,
              ),
              Icon(Icons.calendar_today, color: tokens.muted),
            ],
          ),
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final tokens = ThemeManager().tokens;

    debugPrint(
      '[UI] build() called. _isLoading: $_isLoading, _errorMessage: $_errorMessage',
    );

    if (_isLoading) {
      debugPrint('[UI] Showing loading indicator');
      return const Scaffold(body: Center(child: CircularProgressIndicator()));
    }

    if (_errorMessage != null) {
      debugPrint('[UI] Showing error screen: $_errorMessage');
      return Scaffold(
        body: Center(
          child: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              Text(_errorMessage!, textAlign: TextAlign.center),
              const SizedBox(height: 20),
              DsButton(
                label: tr('sidebar.retry'),
                variant: DsButtonVariant.primary,
                onPressed: _loadProfile,
              ),
            ],
          ),
        ),
      );
    }

    debugPrint(
      '[UI] Building full profile screen with ${_formData.keys.length} sections',
    );

    return Scaffold(
      appBar: AppBar(
        title: Text(tr('userProfile.title')), // "Benutzerprofil"
        backgroundColor: tokens.surface,
        foregroundColor: tokens.fg,
        actions: [
          DsButton(
            label: tr('settings.save'),
            variant: DsButtonVariant.primary,
            onPressed: _saveProfile,
          ),
          DsButton(
            iconOnly: true,
            icon: Icons.close,
            variant: DsButtonVariant.ghost,
            overrideFg: tokens.fg,
            onPressed: () => Navigator.pop(context),
          ),
        ],
      ),
      body: Stack(
        children: [
          SafeArea(
            child: Column(
              children: [
                Container(
                  padding: const EdgeInsets.all(DsSpacing.xl),
                  color: tokens.surface,
                  child: Column(
                    children: [
                      _buildProfileIcon(),
                      const SizedBox(height: DsSpacing.xl),
                      Text(
                        tr(
                          'userProfile.privacyInfo',
                        ), // Translated privacy info
                        textAlign: TextAlign.center,
                        style: TextStyle(
                          fontSize: ThemeManager().tokens.textBase,
                          color: tokens.muted,
                        ),
                      ),
                      DsButton(
                        label: tr('userProfile.privacyPolicyLink'),
                        variant: DsButtonVariant.ghost,
                        onPressed: () {},
                      ),
                    ],
                  ),
                ),
                TabBar(
                  controller: _tabController,
                  isScrollable: true,
                  indicatorSize: TabBarIndicatorSize.label,
                  labelColor: tokens.accent,
                  unselectedLabelColor: tokens.muted,
                  // TRANSLATE TABS using keys: userProfile.tabsShort.personal
                  tabs: _tabs
                      .map((t) => Tab(text: tr('userProfile.tabsShort.$t')))
                      .toList(),
                ),
                Expanded(
                  child: TabBarView(
                    controller: _tabController,
                    children: [
                      // 1. Personal
                      ListView(
                        padding: const EdgeInsets.all(DsSpacing.md),
                        children: [
                          _buildTextField(
                            'userProfile.fields.fullName',
                            'personalIdentification',
                            'fullName',
                          ),
                          _buildDateOfBirthPicker(),
                          _buildDropdown(
                            'userProfile.fields.gender',
                            'personalIdentification',
                            'gender',
                            _genders,
                            type: 'gender',
                          ),
                          _buildSearchableCountryPicker(
                            'userProfile.fields.nationality',
                            'personalIdentification',
                            'nationality',
                          ),
                          _buildDropdown(
                            'userProfile.fields.maritalStatus',
                            'personalIdentification',
                            'maritalStatus',
                            _maritalStatuses,
                            type: 'marital',
                          ),
                        ],
                      ),
                      // 2. Civil
                      ListView(
                        padding: const EdgeInsets.all(DsSpacing.md),
                        children: [
                          _buildFilePicker(
                            'userProfile.fields.birthCert',
                            'civilRegistration',
                            'birthCert',
                          ),
                          _buildFilePicker(
                            'userProfile.fields.deathCert',
                            'civilRegistration',
                            'deathCert',
                          ),
                          _buildFilePicker(
                            'userProfile.fields.marriageDivorce',
                            'civilRegistration',
                            'marriageDivorce',
                          ),
                          _buildFilePicker(
                            'userProfile.fields.adoption',
                            'civilRegistration',
                            'adoption',
                          ),
                          _buildFilePicker(
                            'userProfile.fields.citizenship',
                            'civilRegistration',
                            'citizenship',
                          ),
                          _buildFilePicker(
                            'userProfile.fields.immigration',
                            'civilRegistration',
                            'immigration',
                          ),
                        ],
                      ),
                      // 3. Address
                      ListView(
                        padding: const EdgeInsets.all(DsSpacing.md),
                        children: [
                          _buildTextField(
                            'userProfile.fields.currentAddress',
                            'addressResidency',
                            'currentAddress',
                            multiline: true,
                          ),
                          _buildTextField(
                            'userProfile.fields.previousAddresses',
                            'addressResidency',
                            'previousAddresses',
                            multiline: true,
                          ),
                          _buildTextField(
                            'userProfile.fields.homeOrRental',
                            'addressResidency',
                            'homeOrRental',
                          ),
                          _buildFilePicker(
                            'userProfile.fields.utilityBills',
                            'addressResidency',
                            'utilityBills',
                          ),
                          _buildFilePicker(
                            'userProfile.fields.landRecords',
                            'addressResidency',
                            'landRecords',
                          ),
                        ],
                      ),
                      // 4. Identity
                      ListView(
                        padding: const EdgeInsets.all(DsSpacing.md),
                        children: [
                          _buildTextField(
                            'userProfile.fields.idCard',
                            'identityTravel',
                            'idCard',
                          ),
                          _buildTextField(
                            'userProfile.fields.passport',
                            'identityTravel',
                            'passport',
                          ),
                          _buildTextField(
                            'userProfile.fields.driversLicense',
                            'identityTravel',
                            'driversLicense',
                          ),
                          _buildTextField(
                            'userProfile.fields.voterId',
                            'identityTravel',
                            'voterId',
                          ),
                          _buildTextField(
                            'userProfile.fields.ssn',
                            'identityTravel',
                            'ssn',
                          ),
                          _buildFilePicker(
                            'userProfile.fields.militaryRecords',
                            'identityTravel',
                            'militaryRecords',
                          ),
                        ],
                      ),
                      // 5. Health
                      ListView(
                        padding: const EdgeInsets.all(DsSpacing.md),
                        children: [
                          _buildTextField(
                            'userProfile.fields.medicalHistory',
                            'healthMedical',
                            'medicalHistory',
                            multiline: true,
                          ),
                          _buildFilePicker(
                            'userProfile.fields.vaccinations',
                            'healthMedical',
                            'vaccinations',
                          ),
                          _buildTextField(
                            'userProfile.fields.insuranceDetails',
                            'healthMedical',
                            'insuranceDetails',
                          ),
                          _buildDropdown(
                            'userProfile.fields.bloodType',
                            'healthMedical',
                            'bloodType',
                            _bloodTypes,
                            type: 'blood',
                          ),
                          _buildTextField(
                            'userProfile.fields.disability',
                            'healthMedical',
                            'disability',
                          ),
                          _buildTextField(
                            'userProfile.fields.organDonor',
                            'healthMedical',
                            'organDonor',
                          ),
                          _buildTextField(
                            'userProfile.fields.prescriptions',
                            'healthMedical',
                            'prescriptions',
                            multiline: true,
                          ),
                          _buildTextField(
                            'userProfile.fields.mentalHealth',
                            'healthMedical',
                            'mentalHealth',
                            multiline: true,
                          ),
                        ],
                      ),
                      // 6. Employment
                      ListView(
                        padding: const EdgeInsets.all(DsSpacing.md),
                        children: [
                          _buildTextField(
                            'userProfile.fields.eHistory',
                            'employment',
                            'eHistory',
                            multiline: true,
                          ),
                          _buildTextField(
                            'userProfile.fields.currentEmployer',
                            'employment',
                            'currentEmployer',
                          ),
                          _buildFilePicker(
                            'userProfile.fields.workPermits',
                            'employment',
                            'workPermits',
                          ),
                          _buildFilePicker(
                            'userProfile.fields.certifications',
                            'employment',
                            'certifications',
                          ),
                          _buildTextField(
                            'userProfile.fields.unemployment',
                            'employment',
                            'unemployment',
                          ),
                          _buildTextField(
                            'userProfile.fields.tin',
                            'employment',
                            'tin',
                          ),
                          _buildTextField(
                            'userProfile.fields.businessAffiliations',
                            'employment',
                            'businessAffiliations',
                          ),
                        ],
                      ),
                      // 7. Education
                      ListView(
                        padding: const EdgeInsets.all(DsSpacing.md),
                        children: [
                          _buildTextField(
                            'userProfile.fields.schools',
                            'education',
                            'schools',
                            multiline: true,
                          ),
                          _buildTextField(
                            'userProfile.fields.degrees',
                            'education',
                            'diplomas',
                          ),
                          _buildTextField(
                            'userProfile.fields.performance',
                            'education',
                            'performance',
                          ),
                          _buildTextField(
                            'userProfile.fields.scholarships',
                            'education',
                            'scholarships',
                          ),
                        ],
                      ),
                      // 8. Financial
                      ListView(
                        padding: const EdgeInsets.all(DsSpacing.md),
                        children: [
                          _buildFilePicker(
                            'userProfile.fields.incomeTax',
                            'financialTax',
                            'incomeTax',
                          ),
                          _buildTextField(
                            'userProfile.fields.bankAccounts',
                            'financialTax',
                            'bankAccounts',
                          ),
                          _buildFilePicker(
                            'userProfile.fields.propertyTax',
                            'financialTax',
                            'propertyTax',
                          ),
                          _buildFilePicker(
                            'userProfile.fields.businessTax',
                            'financialTax',
                            'businessTax',
                          ),
                          _buildFilePicker(
                            'userProfile.fields.pensionContrib',
                            'financialTax',
                            'pensionContrib',
                          ),
                          _buildFilePicker(
                            'userProfile.fields.loanAid',
                            'financialTax',
                            'loanAid',
                          ),
                        ],
                      ),
                      // 9. Social
                      ListView(
                        padding: const EdgeInsets.all(DsSpacing.md),
                        children: [
                          _buildTextField(
                            'userProfile.fields.pensionStatus',
                            'socialSecurity',
                            'pensionStatus',
                          ),
                          _buildTextField(
                            'userProfile.fields.unemployment',
                            'socialSecurity',
                            'unemployment',
                          ),
                          _buildTextField(
                            'userProfile.fields.disability',
                            'socialSecurity',
                            'disability',
                          ),
                          _buildTextField(
                            'userProfile.fields.childcare',
                            'socialSecurity',
                            'childcare',
                          ),
                          _buildTextField(
                            'userProfile.fields.foodAssistance',
                            'socialSecurity',
                            'foodAssistance',
                          ),
                          _buildTextField(
                            'userProfile.fields.housingAssistance',
                            'socialSecurity',
                            'housingAssistance',
                          ),
                        ],
                      ),
                      // 10. Criminal
                      ListView(
                        padding: const EdgeInsets.all(DsSpacing.md),
                        children: [
                          _buildFilePicker(
                            'userProfile.fields.policeRecords',
                            'criminalLegal',
                            'policeRecords',
                          ),
                          _buildFilePicker(
                            'userProfile.fields.courtCases',
                            'criminalLegal',
                            'courtCases',
                          ),
                          _buildFilePicker(
                            'userProfile.fields.finesPenalties',
                            'criminalLegal',
                            'finesPenalties',
                          ),
                          _buildTextField(
                            'userProfile.fields.paroleProbation',
                            'criminalLegal',
                            'paroleProbation',
                          ),
                          _buildTextField(
                            'userProfile.fields.citizenshipRevocation',
                            'criminalLegal',
                            'citizenshipRevocation',
                          ),
                        ],
                      ),
                      // 11. Transport
                      ListView(
                        padding: const EdgeInsets.all(DsSpacing.md),
                        children: [
                          _buildTextField(
                            'userProfile.fields.vehicleReg',
                            'transportation',
                            'vehicleReg',
                          ),
                          _buildFilePicker(
                            'userProfile.fields.trafficViolations',
                            'transportation',
                            'trafficViolations',
                          ),
                          _buildTextField(
                            'userProfile.fields.licenseHistory',
                            'transportation',
                            'licenseHistory',
                          ),
                          _buildTextField(
                            'userProfile.fields.publicTransportCard',
                            'transportation',
                            'publicTransportCard',
                          ),
                        ],
                      ),
                      // 12. Civic
                      ListView(
                        padding: const EdgeInsets.all(DsSpacing.md),
                        children: [
                          _buildTextField(
                            'userProfile.fields.voterRegistration',
                            'civicParticipation',
                            'voterRegistration',
                          ),
                          _buildTextField(
                            'userProfile.fields.electionHistory',
                            'civicParticipation',
                            'electionHistory',
                          ),
                          _buildTextField(
                            'userProfile.fields.partyMembership',
                            'civicParticipation',
                            'partyMembership',
                          ),
                          _buildTextField(
                            'userProfile.fields.militaryStatus',
                            'civicParticipation',
                            'militaryStatus',
                          ),
                          _buildTextField(
                            'userProfile.fields.publicServiceRoles',
                            'civicParticipation',
                            'publicServiceRoles',
                          ),
                        ],
                      ),
                    ],
                  ),
                ),
              ],
            ),
          ),
          if (_showIconSelector)
            Material(
              color: tokens.scrim,
              child: SafeArea(
                child: Center(
                  child: Container(
                    width: MediaQuery.of(context).size.width * 0.9,
                    constraints: const BoxConstraints(maxWidth: 500),
                    padding: const EdgeInsets.all(DsSpacing.xl),
                    decoration: BoxDecoration(
                      color: theme.scaffoldBackgroundColor,
                      borderRadius: BorderRadius.circular(DsRadii.xl),
                    ),
                    child: Column(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        Text(
                          tr('userProfile.chooseProfileIcon'),
                          style: TextStyle(
                            fontSize: ThemeManager().tokens.textLg,
                            fontWeight: FontWeight.bold,
                            color: tokens.fg,
                          ),
                        ),
                        const SizedBox(height: DsSpacing.xl),
                        Row(
                          mainAxisAlignment: MainAxisAlignment.spaceEvenly,
                          children: ['preset', 'upload', 'initials'].map((t) {
                            final active = _iconTab == t;
                            return DsButton(
                              label: tr(
                                'userProfile.${t == 'preset' ? 'presetIcons' : t}',
                              ),
                              variant: active
                                  ? DsButtonVariant.primary
                                  : DsButtonVariant.ghost,
                              onPressed: () => setState(() => _iconTab = t),
                            );
                          }).toList(),
                        ),
                        const Divider(height: 30),
                        if (_iconTab == 'preset')
                          GridView.count(
                            shrinkWrap: true,
                            crossAxisCount: 4,
                            mainAxisSpacing: DsSpacing.md,
                            crossAxisSpacing: DsSpacing.md,
                            children: _presetIcons.map((path) {
                              final selected =
                                  _formData['personalIdentification']?['profileIcon'] ==
                                  path;
                              return GestureDetector(
                                onTap: () {
                                  setState(() {
                                    _formData['personalIdentification']?['profileIcon'] =
                                        path;
                                    _showIconSelector = false;
                                  });
                                },
                                child: Container(
                                  decoration: BoxDecoration(
                                    border: Border.all(
                                      color: selected
                                          ? tokens.accent
                                          : Colors.transparent,
                                      width: 4,
                                    ),
                                    borderRadius: BorderRadius.circular(
                                      DsRadii.lg,
                                    ),
                                  ),
                                  child: ClipRRect(
                                    borderRadius: BorderRadius.circular(
                                      DsRadii.md,
                                    ),
                                    child: Image.asset(path, fit: BoxFit.cover),
                                  ),
                                ),
                              );
                            }).toList(),
                          ),
                        if (_iconTab == 'upload')
                          Center(
                            child: DsButton(
                              label: tr('userProfile.clickToUpload'),
                              icon: Icons.photo_library,
                              variant: DsButtonVariant.secondary,
                              onPressed: _pickImageForIcon,
                            ),
                          ),
                        if (_iconTab == 'initials')
                          Column(
                            children: [
                              CircleAvatar(
                                radius: 70,
                                backgroundColor: _initialsColor,
                                child: Text(
                                  _getInitials(
                                    _formData['personalIdentification']?['fullName'],
                                  ),
                                  style: TextStyle(
                                    fontSize: 70,
                                    color: tokens.fg,
                                    fontWeight: FontWeight.bold,
                                  ),
                                ),
                              ),
                              const SizedBox(height: 30),
                              Wrap(
                                spacing: DsSpacing.md,
                                runSpacing: DsSpacing.md,
                                children: _colorOptions.map((c) {
                                  final selected = c == _initialsColor;
                                  return GestureDetector(
                                    onTap: () => setState(() {
                                      _initialsColor = c;
                                      _formData['personalIdentification']?['profileIcon'] =
                                          null;
                                    }),
                                    child: Container(
                                      width: 60,
                                      height: 60,
                                      decoration: BoxDecoration(
                                        color: c,
                                        shape: BoxShape.circle,
                                        border: Border.all(
                                          color: selected
                                              ? tokens.accent
                                              : Colors.transparent,
                                          width: 4,
                                        ),
                                        boxShadow: [
                                          BoxShadow(
                                            color: tokens.muted20,
                                            blurRadius: selected ? 10 : 4,
                                          ),
                                        ],
                                      ),
                                    ),
                                  );
                                }).toList(),
                              ),
                            ],
                          ),
                        const SizedBox(height: 30),
                        Row(
                          mainAxisAlignment: MainAxisAlignment.end,
                          children: [
                            DsButton(
                              label: tr('userProfile.actions.cancel'),
                              variant: DsButtonVariant.ghost,
                              onPressed: () =>
                                  setState(() => _showIconSelector = false),
                            ),
                            DsButton(
                              label: tr('common.done'),
                              variant: DsButtonVariant.primary,
                              onPressed: () =>
                                  setState(() => _showIconSelector = false),
                            ),
                          ],
                        ),
                      ],
                    ),
                  ),
                ),
              ),
            ),
        ],
      ),
    );
  }
}
