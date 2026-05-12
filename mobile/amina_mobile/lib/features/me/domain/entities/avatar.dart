class AvatarState {
  final int     selectedIndex;
  final String? customPhotoPath;

  const AvatarState({
    this.selectedIndex   = -1,
    this.customPhotoPath,
  });

  bool get hasPreset     => selectedIndex >= 0;
  bool get isCustomPhoto => selectedIndex == -1 && customPhotoPath != null;
  bool get isPlaceholder => !hasPreset && !isCustomPhoto;
}
