class CaregiverDirectoryEntry {
  final String       id;
  final String       name;
  final String       specialization;
  final String       bio;
  final List<String> specialtyTags;
  final String       region;
  final int          experienceYears;
  final List<String> languages;
  final bool         acceptingPatients;

  const CaregiverDirectoryEntry({
    required this.id,
    required this.name,
    required this.specialization,
    required this.bio,
    required this.specialtyTags,
    required this.region,
    required this.experienceYears,
    required this.languages,
    required this.acceptingPatients,
  });
}
