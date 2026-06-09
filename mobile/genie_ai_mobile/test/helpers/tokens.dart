/// Minimal config map that produces valid light-mode tokens.
const Map<String, dynamic> lightConfig = {'theme': <String, dynamic>{}};

/// Minimal config map that produces valid dark-mode tokens.
const Map<String, dynamic> darkConfig = {'theme': <String, dynamic>{}};

/// Config with a custom brand color.
const Map<String, dynamic> customBrandConfig = {
  'theme': {'brandColor': '#FF5722'},
};

/// Config with custom navbar colors.
const Map<String, dynamic> customNavbarConfig = {
  'theme': {
    'navbar': {'background': '#333333', 'text': '#FFFFFF'},
  },
};

/// Config with custom status colors.
const Map<String, dynamic> customColorsConfig = {
  'theme': {
    'colors': {
      'success': '#22C55E',
      'warning': '#FBBF24',
      'danger': '#DC2626',
      'info': '#2563EB',
    },
  },
};

/// Config with custom typography scale.
const Map<String, dynamic> customTypographyConfig = {
  'theme': {
    'typography': {'fontScale': 1.5},
  },
};
