// lib/screens/user_profile_screen.dart
// FULL FILE - FILE PICKER FIXED FOR MOBILE + WEB (NO PATH ACCESS CRASH) + ALL PREVIOUS FIXES

import 'dart:io';
import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:image_picker/image_picker.dart';
import 'package:file_picker/file_picker.dart';
import 'package:country_picker/country_picker.dart';
import 'package:genie_ai_mobile/services/user_profile_proxy.dart';

class UserProfileScreen extends StatefulWidget {
  final Map<String, dynamic> user;

  const UserProfileScreen({super.key, required this.user});

  @override
  State<UserProfileScreen> createState() => _UserProfileScreenState();
}

class _UserProfileScreenState extends State<UserProfileScreen>
    with SingleTickerProviderStateMixin {
  final UserProfileProxy _proxy = UserProfileProxy();
  final ImagePicker _imagePicker = ImagePicker();
  final FilePicker _filePicker = FilePicker.platform;

  late TabController _tabController;

  final List<String> _tabs = [
    'Personal',
    'Civil',
    'Address',
    'Identity',
    'Health',
    'Employment',
    'Education',
    'Financial',
    'Social',
    'Criminal',
    'Transport',
    'Civic'
  ];

  bool _isLoading = true;
  String? _errorMessage;
  String _userId = '';

  Map<String, dynamic> _formData = {};

  bool _showIconSelector = false;
  String _iconTab = 'preset';
  Color _initialsColor = const Color(0xFF4E97D1);

  final List<Color> _colorOptions = [
    const Color(0xFF4E97D1),
    Colors.green,
    Colors.red,
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
    'Prefer not to say'
  ];

  final List<String> _maritalStatuses = [
    'Single',
    'Married',
    'Divorced',
    'Widowed',
    'Separated',
    'Domestic Partnership'
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
    'Unknown'
  ];

  @override
  void initState() {
    super.initState();
    _tabController = TabController(length: _tabs.length, vsync: this);
    _userId =
        widget.user['id'] ?? widget.user['_id'] ?? widget.user['userId'] ?? '';
    debugPrint(
        '[PROFILE SCREEN] Extracted userId: "$_userId" from widget.user: ${widget.user}');
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
      debugPrint('[PROFILE SCREEN] Calling _proxy.getProfile($_userId)');
      final data = await _proxy.getProfile(_userId);
      debugPrint(
          '[PROFILE SCREEN] API response received. Keys: ${data.keys.toList()}');

      setState(() {
        debugPrint('[PROFILE SCREEN] Creating empty profile structure');
        _formData = _getEmptyProfile();
        debugPrint(
            '[PROFILE SCREEN] Empty profile created with keys: ${_formData.keys.toList()}');

        debugPrint('[PROFILE SCREEN] Starting safe merge');
        try {
          _formData = _safeMerge(_formData, data);
          debugPrint('[PROFILE SCREEN] Safe merge SUCCESS');
          debugPrint(
              '[PROFILE SCREEN] Final _formData keys: ${_formData.keys.toList()}');
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
      // FIX: Explicitly type as <String, dynamic> and use null for file fields
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
        '[PROFILE SCREEN] _getEmptyProfile() created with ${empty.keys.length} top-level sections');
    return empty;
  }

  Map<String, dynamic> _safeMerge(
      Map<String, dynamic> base, Map<String, dynamic> override) {
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
        '[SAFE MERGE] Starting safe merge. Valid sections: $validSections');
    debugPrint('[SAFE MERGE] Override keys: ${override.keys.toList()}');

    for (final section in validSections) {
      if (override.containsKey(section)) {
        debugPrint('[SAFE MERGE] Merging section: $section');
        if (override[section] is Map<String, dynamic> &&
            base[section] is Map<String, dynamic>) {
          base[section] = _deepMerge(
              base[section] as Map<String, dynamic>, override[section]);
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
      Map<String, dynamic> base, Map<String, dynamic> override) {
    debugPrint(
        '[DEEP MERGE] Starting deep merge. Base keys: ${base.keys.toList()} | Override keys: ${override.keys.toList()}');

    override.forEach((key, value) {
      debugPrint('[DEEP MERGE] Processing key: "$key"');
      debugPrint(
          '[DEEP MERGE]   Override value type: ${value.runtimeType} | value: $value');
      debugPrint(
          '[DEEP MERGE]   Base current value type: ${base[key]?.runtimeType} | value: ${base[key]}');

      if (value is Map<String, dynamic> && base[key] is Map<String, dynamic>) {
        debugPrint('[DEEP MERGE]   Recursing into nested map for key "$key"');
        base[key] = _deepMerge(base[key] as Map<String, dynamic>, value);
      } else {
        // Critical fix: always assign the override value, regardless of type
        // This prevents "String is not a subtype of Null" when backend sends "" for a field initialized as null
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
    final XFile? file =
        await _imagePicker.pickImage(source: ImageSource.gallery);
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

  // FINAL FIXED FILE PICKER - NO CRASH ON WEB
  Future<void> _pickFile(String section, String field) async {
    debugPrint('[FILE PICKER] Opening picker for $section.$field');
    final FilePickerResult? result =
        await _filePicker.pickFiles(type: FileType.any);
    if (result != null && result.files.isNotEmpty) {
      final platformFile = result.files.single;
      debugPrint('[FILE PICKER] Selected file name: ${platformFile.name}');
      debugPrint(
          '[FILE PICKER] bytes available: ${platformFile.bytes != null}');
      // REMOVED ANY ACCESS TO platformFile.path — it causes crash on web

      XFile xfile;
      if (platformFile.bytes != null) {
        // Web — use bytes
        xfile = XFile.fromData(platformFile.bytes!, name: platformFile.name);
        debugPrint('[FILE PICKER] Created XFile from bytes (web)');
      } else {
        // Mobile — use path (safe because on mobile path is always available)
        if (platformFile.path == null) {
          debugPrint('[FILE PICKER] Unexpected: path is null on mobile');
          ScaffoldMessenger.of(context).showSnackBar(
            const SnackBar(
                content: Text('File selected but no data available')),
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
            '[FILE PICKER] Successfully stored XFile for $section.$field');
      });
    } else {
      debugPrint('[FILE PICKER] Picker cancelled or no file selected');
    }
  }

  // Helper: Recursively finds files, converts to Base64, and locks them in a JSON STRING
  // Helper: Recursively finds files, converts to Base64, and locks them in a JSON STRING
  Future<Map<String, dynamic>> _prepareDataForSubmission(
      Map<String, dynamic> data) async {
    final Map<String, dynamic> output = {};

    for (final key in data.keys) {
      final value = data[key];

      if (value is Map<String, dynamic>) {
        // Recurse deeper into nested sections
        output[key] = await _prepareDataForSubmission(value);
      } else if (value is XFile) {
        debugPrint('[DATA PREP] Processing file: ${value.name}');
        try {
          // 1. Read the raw binary bytes (Safe for .ffs_db, .pdf, .png, etc)
          final bytes = await value.readAsBytes();

          // 2. Convert binary bytes to safe Base64 text
          final base64String = base64Encode(bytes);

          // 3. Create the data map
          final fileData = {
            'fileName': value.name,
            'fileSize': bytes.length,
            'mimeType': value.mimeType ?? 'application/octet-stream',
            'data': base64String,
          };

          // 4. CRITICAL FIX: jsonEncode this map into a String.
          // The server expects a String value for these fields, not a JSON Object.
          output[key] = jsonEncode(fileData);
        } catch (e) {
          debugPrint('[DATA PREP] Error reading file $key: $e');
          output[key] = null;
        }
      } else {
        // Pass through existing values (Strings, Nulls)
        output[key] = value;
      }
    }
    return output;
  }

  Future<void> _saveProfile() async {
    debugPrint('[PROFILE SCREEN] Save button pressed');
    setState(() => _isLoading = true);

    try {
      // 1. Convert all XFiles to safe JSON data
      debugPrint('[PROFILE SCREEN] Encoding files for API transmission...');
      final dataToSubmit = await _prepareDataForSubmission(_formData);

      // 2. Send the clean data to the proxy
      await _proxy.updateProfile(_userId, dataToSubmit);

      debugPrint('[PROFILE SCREEN] Profile saved successfully');
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Profile saved successfully!')),
        );
        Navigator.pop(context);
      }
    } catch (e, stack) {
      debugPrint('[PROFILE SCREEN] SAVE FAILED: $e');
      debugPrint('[PROFILE SCREEN] Save stack trace: $stack');
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Save failed: $e')),
        );
      }
    } finally {
      if (mounted) {
        setState(() => _isLoading = false);
      }
    }
  }

  Widget _buildProfileIcon() {
    final icon = _formData['personalIdentification']?['profileIcon'];
    debugPrint(
        '[UI] Building profile icon, current value: $icon (${icon.runtimeType})');

    String? url;
    XFile? xfile;
    File? file;

    if (icon is String && icon.startsWith('http')) url = icon;
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
                        : null,
            backgroundColor: url == null && xfile == null && file == null
                ? _initialsColor
                : null,
            child: url == null && xfile == null && file == null
                ? Text(
                    _getInitials(
                        _formData['personalIdentification']?['fullName']),
                    style: const TextStyle(
                        fontSize: 50,
                        color: Colors.white,
                        fontWeight: FontWeight.bold),
                  )
                : null,
          ),
          Positioned(
            bottom: 0,
            right: 0,
            child: Container(
              padding: const EdgeInsets.all(8),
              decoration: const BoxDecoration(
                  color: Colors.black54, shape: BoxShape.circle),
              child: const Icon(Icons.edit, color: Colors.white, size: 24),
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildTextField(String label, String section, String field,
      {bool multiline = false}) {
    final String currentValue = (_formData[section]?[field]?.toString() ?? '');
    debugPrint(
        '[UI] Building TextField "$label" ($section.$field) = "$currentValue"');

    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 8),
      child: TextFormField(
        initialValue: currentValue,
        decoration: InputDecoration(
          labelText: label,
          border: const OutlineInputBorder(),
        ),
        maxLines: multiline ? 4 : 1,
        onChanged: (v) {
          setState(() {
            _formData[section] ??= {};
            _formData[section][field] = v.isEmpty ? null : v;
            debugPrint(
                '[UI] TextField updated $section.$field = "${v.isEmpty ? "null" : v}"');
          });
        },
      ),
    );
  }

  Widget _buildDropdown(
      String label, String section, String field, List<String> items) {
    final String? currentValue = _formData[section]?[field];
    debugPrint(
        '[UI] Building Dropdown "$label" ($section.$field) raw value: "$currentValue"');

    String? normalizedValue;
    if (currentValue != null && currentValue.isNotEmpty) {
      normalizedValue = items.firstWhere(
        (item) => item.toLowerCase() == currentValue.toLowerCase(),
        orElse: () => currentValue,
      );
    }

    debugPrint('[UI] Normalized dropdown value: "$normalizedValue"');

    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 8),
      child: DropdownButtonFormField<String>(
        value: normalizedValue,
        decoration: InputDecoration(
          labelText: label,
          border: const OutlineInputBorder(),
        ),
        items: items
            .map((item) => DropdownMenuItem(value: item, child: Text(item)))
            .toList(),
        onChanged: (v) {
          setState(() {
            _formData[section] ??= {};
            _formData[section][field] = v ?? null;
            debugPrint('[UI] Dropdown updated $section.$field = "$v"');
          });
        },
      ),
    );
  }

  Widget _buildSearchableCountryPicker(
      String label, String section, String field) {
    final String currentValue = _formData[section]?[field] ?? '';
    debugPrint(
        '[UI] Building CountryPicker "$label" ($section.$field) = "$currentValue"');

    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 8),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(label, style: Theme.of(context).textTheme.titleMedium),
          const SizedBox(height: 8),
          OutlinedButton.icon(
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
                        '[UI] Country selected: "${country.name}" for $section.$field');
                  });
                },
                countryListTheme: CountryListThemeData(
                  inputDecoration: const InputDecoration(
                    labelText: 'Search country',
                    border: OutlineInputBorder(),
                  ),
                ),
              );
            },
            icon: const Icon(Icons.flag),
            label: Text(currentValue.isEmpty ? 'Select country' : currentValue),
          ),
        ],
      ),
    );
  }

  Widget _buildFilePicker(String label, String section, String field) {
    final file = _formData[section]?[field];
    String fileName = 'No file selected';

    if (file is XFile) {
      // Case A: User just picked this file (not saved yet)
      fileName = file.name;
    } else if (file is File) {
      // Case B: Legacy mobile file object
      fileName = file.path.split(Platform.pathSeparator).last;
    } else if (file is String && file.isNotEmpty) {
      // Case C: File saved in backend as a JSON String
      try {
        if (file.trim().startsWith('{')) {
          final Map<String, dynamic> data = jsonDecode(file);
          fileName = data['fileName'] ?? 'Attached File';
        } else {
          // Fallback for legacy plain filenames/URLs
          fileName = file.length > 20
              ? '...${file.substring(file.length - 20)}'
              : file;
        }
      } catch (e) {
        fileName = 'Attached File (Unknown)';
      }
    }

    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 8),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(label, style: Theme.of(context).textTheme.titleMedium),
          const SizedBox(height: 8),
          Row(
            children: [
              Expanded(
                child: Text(
                  fileName,
                  style: const TextStyle(color: Colors.grey),
                  overflow: TextOverflow.ellipsis,
                ),
              ),
              const SizedBox(width: 10),
              ElevatedButton(
                onPressed: () => _pickFile(section, field),
                child: const Text('Choose File'),
              ),
            ],
          ),
        ],
      ),
    );
  }

  Widget _buildDateOfBirthPicker() {
    final String currentDob = _formData['personalIdentification']?['dob'] ?? '';
    debugPrint('[UI] Building DateOfBirthPicker, current value: "$currentDob"');

    DateTime? selectedDate;
    if (currentDob.isNotEmpty) {
      selectedDate = DateTime.tryParse(currentDob);
      debugPrint('[UI] Parsed existing DOB: $selectedDate');
    }

    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 8),
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
                  colorScheme: Theme.of(context).colorScheme.copyWith(
                        primary: const Color(0xFF4E97D1),
                      ),
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
          decoration: const InputDecoration(
            labelText: 'Date of Birth (YYYY-MM-DD)',
            border: OutlineInputBorder(),
          ),
          child: Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Text(currentDob.isEmpty ? 'Select date' : currentDob),
              const Icon(Icons.calendar_today),
            ],
          ),
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    debugPrint(
        '[UI] build() called. _isLoading: $_isLoading, _errorMessage: $_errorMessage');

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
              ElevatedButton(
                  onPressed: _loadProfile, child: const Text('Retry')),
            ],
          ),
        ),
      );
    }

    debugPrint(
        '[UI] Building full profile screen with ${_formData.keys.length} sections');

    return Scaffold(
      appBar: AppBar(
        title: const Text('User Profile'),
        actions: [
          TextButton(
            onPressed: _saveProfile,
            child: const Text('Save', style: TextStyle(color: Colors.white)),
          ),
          IconButton(
              onPressed: () => Navigator.pop(context),
              icon: const Icon(Icons.close)),
        ],
      ),
      body: Stack(
        children: [
          Column(
            children: [
              Container(
                padding: const EdgeInsets.all(20),
                color: theme.brightness == Brightness.dark
                    ? Colors.grey[900]
                    : Colors.grey[50],
                child: Column(
                  children: [
                    _buildProfileIcon(),
                    const SizedBox(height: 20),
                    const Text(
                      'Your personal data is protected. We only collect information required for service delivery.',
                      textAlign: TextAlign.center,
                      style: TextStyle(fontSize: 14, color: Colors.grey),
                    ),
                    TextButton(
                        onPressed: () {}, child: const Text('Privacy Policy')),
                  ],
                ),
              ),
              TabBar(
                controller: _tabController,
                isScrollable: true,
                indicatorSize: TabBarIndicatorSize.label,
                labelColor: theme.primaryColor,
                unselectedLabelColor: Colors.grey,
                tabs: _tabs.map((t) => Tab(text: t)).toList(),
              ),
              Expanded(
                child: TabBarView(
                  controller: _tabController,
                  children: [
                    ListView(padding: const EdgeInsets.all(16), children: [
                      _buildTextField(
                          'Full Name', 'personalIdentification', 'fullName'),
                      _buildDateOfBirthPicker(),
                      _buildDropdown('Gender', 'personalIdentification',
                          'gender', _genders),
                      _buildSearchableCountryPicker('Nationality',
                          'personalIdentification', 'nationality'),
                      _buildDropdown('Marital Status', 'personalIdentification',
                          'maritalStatus', _maritalStatuses),
                    ]),
                    ListView(padding: const EdgeInsets.all(16), children: [
                      _buildFilePicker('Birth Certificate', 'civilRegistration',
                          'birthCert'),
                      _buildFilePicker('Death Certificate (if applicable)',
                          'civilRegistration', 'deathCert'),
                      _buildFilePicker('Marriage/Divorce Papers',
                          'civilRegistration', 'marriageDivorce'),
                      _buildFilePicker(
                          'Adoption Papers', 'civilRegistration', 'adoption'),
                      _buildFilePicker('Citizenship Certificate',
                          'civilRegistration', 'citizenship'),
                      _buildFilePicker('Immigration Documents',
                          'civilRegistration', 'immigration'),
                    ]),
                    ListView(padding: const EdgeInsets.all(16), children: [
                      _buildTextField('Current Address', 'addressResidency',
                          'currentAddress',
                          multiline: true),
                      _buildTextField('Previous Addresses', 'addressResidency',
                          'previousAddresses',
                          multiline: true),
                      _buildTextField('Home Ownership / Rental Status',
                          'addressResidency', 'homeOrRental'),
                      _buildFilePicker(
                          'Utility Bills', 'addressResidency', 'utilityBills'),
                      _buildFilePicker('Land/Property Records',
                          'addressResidency', 'landRecords'),
                    ]),
                    ListView(padding: const EdgeInsets.all(16), children: [
                      _buildTextField(
                          'ID Card Number', 'identityTravel', 'idCard'),
                      _buildTextField(
                          'Passport Number', 'identityTravel', 'passport'),
                      _buildTextField('Driver\'s License', 'identityTravel',
                          'driversLicense'),
                      _buildTextField('Voter ID', 'identityTravel', 'voterId'),
                      _buildTextField(
                          'Social Security Number', 'identityTravel', 'ssn'),
                      _buildFilePicker('Military Records', 'identityTravel',
                          'militaryRecords'),
                    ]),
                    ListView(padding: const EdgeInsets.all(16), children: [
                      _buildTextField(
                          'Medical History', 'healthMedical', 'medicalHistory',
                          multiline: true),
                      _buildFilePicker('Vaccination Records', 'healthMedical',
                          'vaccinations'),
                      _buildTextField('Insurance Details', 'healthMedical',
                          'insuranceDetails'),
                      _buildDropdown('Blood Type', 'healthMedical', 'bloodType',
                          _bloodTypes),
                      _buildTextField('Disability Information', 'healthMedical',
                          'disability'),
                      _buildTextField(
                          'Organ Donor Status', 'healthMedical', 'organDonor'),
                      _buildTextField(
                          'Prescriptions', 'healthMedical', 'prescriptions',
                          multiline: true),
                      _buildTextField('Mental Health Records', 'healthMedical',
                          'mentalHealth',
                          multiline: true),
                    ]),
                    ListView(padding: const EdgeInsets.all(16), children: [
                      _buildTextField(
                          'Employment History', 'employment', 'eHistory',
                          multiline: true),
                      _buildTextField(
                          'Current Employer', 'employment', 'currentEmployer'),
                      _buildFilePicker(
                          'Work Permits', 'employment', 'workPermits'),
                      _buildFilePicker('Professional Certifications',
                          'employment', 'certifications'),
                      _buildTextField(
                          'Unemployment Records', 'employment', 'unemployment'),
                      _buildTextField('Tax Identification Number (TIN)',
                          'employment', 'tin'),
                      _buildTextField('Business Affiliations', 'employment',
                          'businessAffiliations'),
                    ]),
                    ListView(padding: const EdgeInsets.all(16), children: [
                      _buildTextField(
                          'Schools Attended', 'education', 'schools',
                          multiline: true),
                      _buildTextField(
                          'Diplomas/Degrees', 'education', 'diplomas'),
                      _buildTextField(
                          'Academic Performance', 'education', 'performance'),
                      _buildTextField(
                          'Scholarships & Awards', 'education', 'scholarships'),
                    ]),
                    ListView(padding: const EdgeInsets.all(16), children: [
                      _buildFilePicker(
                          'Income Tax Returns', 'financialTax', 'incomeTax'),
                      _buildTextField('Bank Account Details', 'financialTax',
                          'bankAccounts'),
                      _buildFilePicker('Property Tax Records', 'financialTax',
                          'propertyTax'),
                      _buildFilePicker('Business Tax Records', 'financialTax',
                          'businessTax'),
                      _buildFilePicker('Pension Contributions', 'financialTax',
                          'pensionContrib'),
                      _buildFilePicker(
                          'Loans & Financial Aid', 'financialTax', 'loanAid'),
                    ]),
                    ListView(padding: const EdgeInsets.all(16), children: [
                      _buildTextField(
                          'Pension Status', 'socialSecurity', 'pensionStatus'),
                      _buildTextField('Unemployment Benefits', 'socialSecurity',
                          'unemployment'),
                      _buildTextField('Disability Benefits', 'socialSecurity',
                          'disability'),
                      _buildTextField('Childcare Assistance', 'socialSecurity',
                          'childcare'),
                      _buildTextField('Food Assistance', 'socialSecurity',
                          'foodAssistance'),
                      _buildTextField('Housing Assistance', 'socialSecurity',
                          'housingAssistance'),
                    ]),
                    ListView(padding: const EdgeInsets.all(16), children: [
                      _buildFilePicker(
                          'Police Records', 'criminalLegal', 'policeRecords'),
                      _buildFilePicker(
                          'Court Cases', 'criminalLegal', 'courtCases'),
                      _buildFilePicker('Fines & Penalties', 'criminalLegal',
                          'finesPenalties'),
                      _buildTextField('Parole/Probation Status',
                          'criminalLegal', 'paroleProbation'),
                      _buildTextField('Citizenship Revocation', 'criminalLegal',
                          'citizenshipRevocation'),
                    ]),
                    ListView(padding: const EdgeInsets.all(16), children: [
                      _buildTextField('Vehicle Registration', 'transportation',
                          'vehicleReg'),
                      _buildFilePicker('Traffic Violations', 'transportation',
                          'trafficViolations'),
                      _buildTextField('License History', 'transportation',
                          'licenseHistory'),
                      _buildTextField('Public Transport Card', 'transportation',
                          'publicTransportCard'),
                    ]),
                    ListView(padding: const EdgeInsets.all(16), children: [
                      _buildTextField('Voter Registration',
                          'civicParticipation', 'voterRegistration'),
                      _buildTextField('Election History', 'civicParticipation',
                          'electionHistory'),
                      _buildTextField('Party Membership', 'civicParticipation',
                          'partyMembership'),
                      _buildTextField('Military Service Status',
                          'civicParticipation', 'militaryStatus'),
                      _buildTextField('Public Service Roles',
                          'civicParticipation', 'publicServiceRoles'),
                    ]),
                  ],
                ),
              ),
            ],
          ),
          if (_showIconSelector)
            Material(
              color: Colors.black.withOpacity(0.7),
              child: Center(
                child: Container(
                  width: MediaQuery.of(context).size.width * 0.9,
                  constraints: const BoxConstraints(maxWidth: 500),
                  padding: const EdgeInsets.all(24),
                  decoration: BoxDecoration(
                    color: theme.scaffoldBackgroundColor,
                    borderRadius: BorderRadius.circular(16),
                  ),
                  child: Column(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      const Text('Choose Profile Icon',
                          style: TextStyle(
                              fontSize: 20, fontWeight: FontWeight.bold)),
                      const SizedBox(height: 20),
                      Row(
                        mainAxisAlignment: MainAxisAlignment.spaceEvenly,
                        children: ['preset', 'upload', 'initials'].map((t) {
                          final active = _iconTab == t;
                          return TextButton(
                            onPressed: () => setState(() => _iconTab = t),
                            child: Text(
                              t[0].toUpperCase() + t.substring(1),
                              style: TextStyle(
                                color:
                                    active ? theme.primaryColor : Colors.grey,
                                fontWeight: active
                                    ? FontWeight.bold
                                    : FontWeight.normal,
                              ),
                            ),
                          );
                        }).toList(),
                      ),
                      const Divider(height: 30),
                      if (_iconTab == 'preset')
                        GridView.count(
                          shrinkWrap: true,
                          crossAxisCount: 4,
                          mainAxisSpacing: 16,
                          crossAxisSpacing: 16,
                          children: _presetIcons.map((path) {
                            final selected = _formData['personalIdentification']
                                    ?['profileIcon'] ==
                                path;
                            return GestureDetector(
                              onTap: () {
                                setState(() {
                                  _formData['personalIdentification']
                                      ?['profileIcon'] = path;
                                  _showIconSelector = false;
                                });
                              },
                              child: Container(
                                decoration: BoxDecoration(
                                  border: Border.all(
                                      color: selected
                                          ? theme.primaryColor
                                          : Colors.transparent,
                                      width: 4),
                                  borderRadius: BorderRadius.circular(12),
                                ),
                                child: ClipRRect(
                                  borderRadius: BorderRadius.circular(8),
                                  child: Image.asset(path, fit: BoxFit.cover),
                                ),
                              ),
                            );
                          }).toList(),
                        ),
                      if (_iconTab == 'upload')
                        Center(
                          child: ElevatedButton.icon(
                            onPressed: _pickImageForIcon,
                            icon: const Icon(Icons.photo_library),
                            label: const Text('Select from Gallery'),
                          ),
                        ),
                      if (_iconTab == 'initials')
                        Column(
                          children: [
                            CircleAvatar(
                              radius: 70,
                              backgroundColor: _initialsColor,
                              child: Text(
                                _getInitials(_formData['personalIdentification']
                                    ?['fullName']),
                                style: const TextStyle(
                                    fontSize: 70,
                                    color: Colors.white,
                                    fontWeight: FontWeight.bold),
                              ),
                            ),
                            const SizedBox(height: 30),
                            Wrap(
                              spacing: 16,
                              runSpacing: 16,
                              children: _colorOptions.map((c) {
                                final selected = c == _initialsColor;
                                return GestureDetector(
                                  onTap: () => setState(() {
                                    _initialsColor = c;
                                    _formData['personalIdentification']
                                        ?['profileIcon'] = null;
                                  }),
                                  child: Container(
                                    width: 60,
                                    height: 60,
                                    decoration: BoxDecoration(
                                      color: c,
                                      shape: BoxShape.circle,
                                      border: Border.all(
                                          color: selected
                                              ? Colors.white
                                              : Colors.transparent,
                                          width: 4),
                                      boxShadow: [
                                        BoxShadow(
                                            color: Colors.black26,
                                            blurRadius: selected ? 10 : 4),
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
                          TextButton(
                            onPressed: () =>
                                setState(() => _showIconSelector = false),
                            child: const Text('Cancel'),
                          ),
                          ElevatedButton(
                            onPressed: () =>
                                setState(() => _showIconSelector = false),
                            child: const Text('Done'),
                          ),
                        ],
                      ),
                    ],
                  ),
                ),
              ),
            ),
        ],
      ),
    );
  }
}
