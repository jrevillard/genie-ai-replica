class SessionStatus {
  final bool hasSession;
  final String appMode; // 'patient' | 'caregiverOnly'

  const SessionStatus({required this.hasSession, required this.appMode});
}
