class AssignedCaregiver {
  final String       id;
  final String       name;
  final String       phone;
  final String?      relationship;
  final List<String> permissions;
  final String?      consentDate;
  final bool         isRevoked;
  final String       note;

  const AssignedCaregiver({
    required this.id,
    required this.name,
    required this.phone,
    this.relationship,
    this.permissions = const [],
    this.consentDate,
    this.isRevoked   = false,
    this.note        = '',
  });
}
