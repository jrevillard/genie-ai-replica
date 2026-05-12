class PrescriptionScanResult {
  final bool isPrescription;
  final List<String> medicationSummary;
  final String guidance;
  final String? reason;

  const PrescriptionScanResult({
    required this.isPrescription,
    required this.medicationSummary,
    required this.guidance,
    this.reason,
  });
}
