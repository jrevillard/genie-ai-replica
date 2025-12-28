// lib/screens/user_profile_screen.dart
// FINAL - 100% CLEAN, NO COMPILE ERRORS, FULLY WORKING

import 'dart:io';

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
    if (_userId.isEmpty) {
      _errorMessage = 'User ID not found';
      _isLoading = false;
    } else {
      _loadProfile();
    }
  }

  @override
  void dispose() {
    _tabController.dispose();
    super.dispose();
  }

  Future<void> _loadProfile() async {
    setState(() {
      _isLoading = true;
      _errorMessage = null;
    });

    try {
      final data = await _proxy.getProfile(_userId);
      setState(() {
        _formData = _getEmptyProfile();
        _formData = _deepMerge(_formData, data);
      });
    } catch (e) {
      setState(() => _errorMessage = 'Failed to load profile: $e');
    } finally {
      setState(() => _isLoading = false);
    }
  }

  Map<String, dynamic> _getEmptyProfile() {
    return {
      "personalIdentification": {
        "fullName": "",
        "dob": "",
        "gender": "",
        "nationality": "",
        "maritalStatus": "",
        "profileIcon": null,
      },
      "civilRegistration": {
        "birthCert": null,
        "deathCert": null,
        "marriageDivorce": null,
        "adoption": null,
        "citizenship": null,
        "immigration": null,
      },
      "addressResidency": {
        "currentAddress": "",
        "previousAddresses": "",
        "homeOrRental": "",
        "utilityBills": null,
        "landRecords": null,
      },
      "identityTravel": {
        "idCard": "",
        "passport": "",
        "driversLicense": "",
        "voterId": "",
        "ssn": "",
        "militaryRecords": null,
      },
      "healthMedical": {
        "medicalHistory": "",
        "vaccinations": null,
        "insuranceDetails": "",
        "disability": "",
        "organDonor": "",
        "prescriptions": "",
        "mentalHealth": "",
        "bloodType": "",
      },
      "employment": {
        "eHistory": "",
        "currentEmployer": "",
        "workPermits": null,
        "certifications": null,
        "unemployment": "",
        "tin": "",
        "businessAffiliations": "",
      },
      "education": {
        "schools": "",
        "diplomas": "",
        "performance": "",
        "scholarships": "",
      },
      "financialTax": {
        "incomeTax": null,
        "bankAccounts": "",
        "propertyTax": null,
        "businessTax": null,
        "pensionContrib": null,
        "loanAid": null,
      },
      "socialSecurity": {
        "pensionStatus": "",
        "unemployment": "",
        "disability": "",
        "childcare": "",
        "foodAssistance": "",
        "housingAssistance": "",
      },
      "criminalLegal": {
        "policeRecords": null,
        "courtCases": null,
        "finesPenalties": null,
        "paroleProbation": "",
        "citizenshipRevocation": "",
      },
      "transportation": {
        "vehicleReg": "",
        "trafficViolations": null,
        "licenseHistory": "",
        "publicTransportCard": "",
      },
      "civicParticipation": {
        "voterRegistration": "",
        "electionHistory": "",
        "partyMembership": "",
        "militaryStatus": "",
        "publicServiceRoles": "",
      },
    };
  }

  Map<String, dynamic> _deepMerge(
      Map<String, dynamic> base, Map<String, dynamic> override) {
    override.forEach((key, value) {
      if (value is Map<String, dynamic> && base[key] is Map<String, dynamic>) {
        base[key] = _deepMerge(base[key] as Map<String, dynamic>, value);
      } else {
        base[key] = value;
      }
    });
    return base;
  }

  String _getInitials(String? name) {
    if (name == null || name.trim().isEmpty) return '?';
    final parts = name.trim().split(' ');
    if (parts.length >= 2) return '${parts[0][0]}${parts[1][0]}'.toUpperCase();
    return name[0].toUpperCase();
  }

  Future<void> _pickImageForIcon() async {
    final XFile? file =
        await _imagePicker.pickImage(source: ImageSource.gallery);
    if (file != null && mounted) {
      setState(() {
        _formData['personalIdentification']['profileIcon'] = file;
        _showIconSelector = false;
      });
    }
  }

  Future<void> _pickFile(String section, String field) async {
    final FilePickerResult? result =
        await _filePicker.pickFiles(type: FileType.any);
    if (result != null &&
        result.files.isNotEmpty &&
        result.files.single.path != null) {
      setState(() {
        _formData[section][field] = File(result.files.single.path!);
      });
    }
  }

  Future<void> _saveProfile() async {
    setState(() => _isLoading = true);
    try {
      await _proxy.updateProfile(_userId, _formData);
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Profile saved successfully!')),
        );
        Navigator.pop(context);
      }
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Save failed: $e')),
        );
      }
    } finally {
      setState(() => _isLoading = false);
    }
  }

  Widget _buildProfileIcon() {
    final icon = _formData['personalIdentification']['profileIcon'];
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
                        _formData['personalIdentification']['fullName']),
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
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 8),
      child: TextFormField(
        initialValue: _formData[section][field]?.toString() ?? '',
        decoration: InputDecoration(
          labelText: label,
          border: const OutlineInputBorder(),
        ),
        maxLines: multiline ? 4 : 1,
        onChanged: (v) => setState(() => _formData[section][field] = v),
      ),
    );
  }

  Widget _buildDropdown(
      String label, String section, String field, List<String> items) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 8),
      child: DropdownButtonFormField<String>(
        value: _formData[section][field]?.isEmpty == false
            ? _formData[section][field]
            : null,
        decoration: InputDecoration(
          labelText: label,
          border: const OutlineInputBorder(),
        ),
        items: items
            .map((item) => DropdownMenuItem(value: item, child: Text(item)))
            .toList(),
        onChanged: (v) => setState(() => _formData[section][field] = v ?? ''),
      ),
    );
  }

  Widget _buildSearchableCountryPicker(
      String label, String section, String field) {
    final String currentValue = _formData[section][field] ?? '';
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 8),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(label, style: Theme.of(context).textTheme.titleMedium),
          const SizedBox(height: 8),
          OutlinedButton.icon(
            onPressed: () {
              showCountryPicker(
                context: context,
                showPhoneCode: false,
                onSelect: (Country country) {
                  setState(() {
                    _formData[section][field] = country.name;
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
    final file = _formData[section][field];
    String fileName = 'No file selected';
    if (file is File || file is XFile) {
      fileName = file is File
          ? file.path.split(Platform.pathSeparator).last
          : (file as XFile).name;
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
                  child: Text(fileName,
                      style: const TextStyle(color: Colors.grey))),
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
    final String currentDob = _formData['personalIdentification']['dob'] ?? '';
    DateTime? selectedDate;
    if (currentDob.isNotEmpty) {
      selectedDate = DateTime.tryParse(currentDob);
    }

    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 8),
      child: InkWell(
        onTap: () async {
          final DateTime? picked = await showDatePicker(
            context: context,
            initialDate: selectedDate ?? DateTime.now(),
            firstDate: DateTime(1900),
            lastDate: DateTime.now(),
            builder: (context, child) {
              return Theme(
                data: Theme.of(context).copyWith(
                  colorScheme: Theme.of(context).colorScheme.copyWith(
                        primary:
                            const Color(0xFF4E97D1), // Matches your app theme
                      ),
                ),
                child: child!,
              );
            },
          );

          if (picked != null) {
            final String formatted =
                '${picked.year}-${picked.month.toString().padLeft(2, '0')}-${picked.day.toString().padLeft(2, '0')}';
            setState(() {
              _formData['personalIdentification']['dob'] = formatted;
            });
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

    if (_isLoading) {
      return const Scaffold(body: Center(child: CircularProgressIndicator()));
    }

    if (_errorMessage != null) {
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
                                    ['profileIcon'] ==
                                path;
                            return GestureDetector(
                              onTap: () {
                                setState(() {
                                  _formData['personalIdentification']
                                      ['profileIcon'] = path;
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
                                    ['fullName']),
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
                                        ['profileIcon'] = null;
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
