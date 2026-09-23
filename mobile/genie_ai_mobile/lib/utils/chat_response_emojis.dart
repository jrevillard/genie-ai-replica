/// Deterministic crop / weather emojis for assistant replies - a port of the
/// web `utils/chatResponseEmojis.js` (same topics, same rules) so both
/// clients render an identical response.
///
/// Each topic is decorated once (its first mention), an emoji the model
/// already placed anywhere in the text is moved in front of that mention, and
/// stray whitespace / punctuation left behind is tidied.
library;

class _Topic {
  final String emoji;
  final RegExp pattern;
  const _Topic(this.emoji, this.pattern);
}

final List<_Topic> _cropEmojis = [
  _Topic(
    '🌾',
    RegExp(r'\b(?:rice aman|aman rice|rice)\b', caseSensitive: false),
  ),
  _Topic('🍆', RegExp(r'\beggplant\b', caseSensitive: false)),
  _Topic('🥭', RegExp(r'\bmango\b', caseSensitive: false)),
  _Topic('🫚', RegExp(r'\bturmeric\b', caseSensitive: false)),
];

final List<_Topic> _weatherEmojis = [
  _Topic(
    '⚠️',
    RegExp(r'\b(?:warnings?|alerts?|hazards?)\b', caseSensitive: false),
  ),
  _Topic(
    '⛈️',
    RegExp(r'\b(?:thunderstorms?|storms?|lightning)\b', caseSensitive: false),
  ),
  _Topic(
    '🌧️',
    RegExp(
      r'\b(?:rain(?:fall|s|ing)?|showers?|drizzle)\b',
      caseSensitive: false,
    ),
  ),
  _Topic(
    '☀️',
    RegExp(r'\b(?:sunny|sunshine|clear sky)\b', caseSensitive: false),
  ),
  _Topic(
    '☁️',
    RegExp(r'\b(?:cloudy|clouds?|overcast)\b', caseSensitive: false),
  ),
  _Topic(
    '🌡️',
    RegExp(r'\b(?:temperatures?|heat|hot|cold)\b', caseSensitive: false),
  ),
  _Topic('💧', RegExp(r'\b(?:humidity|moisture)\b', caseSensitive: false)),
  _Topic('💨', RegExp(r'\b(?:winds?|windy|gusts?)\b', caseSensitive: false)),
  _Topic('🏜️', RegExp(r'\bdroughts?\b', caseSensitive: false)),
  _Topic(
    '🌊',
    RegExp(r'\b(?:floods?|flooded|flooding)\b', caseSensitive: false),
  ),
];

// Markdown link destinations: "](" up to the closing ")". These are URLs, not
// prose, and must never be decorated. In a translated (e.g. Bengali) answer the
// only Latin "drought" left is the one inside "/api/weather/drought-report/..."
// — decorating it broke the report link.
final RegExp _linkDestination = RegExp(r'\]\([^)]*\)');

final RegExp _leadingSpaceBeforeEmoji = RegExp(
  r'^[ \t]+(?=(?:🌾|🍆|🥭|⚠️|⛈️|🌧️|☀️|☁️|🌡️|💧|💨|🏜️|🌊))',
  multiLine: true,
);
final RegExp _spaceBeforePunct = RegExp(r'[ \t]+([,.;:!?])');
final RegExp _doublePunct = RegExp(r'([.!?])[,;:]');
final RegExp _trailingSpace = RegExp(r'[ \t]+$', multiLine: true);

String _decorateTopic(String content, _Topic topic) {
  if (!topic.pattern.hasMatch(content)) return content;
  final plainEmoji = topic.emoji.replaceAll('️', '');
  final withoutMisplaced = content
      .split(topic.emoji)
      .join('')
      .split(plainEmoji)
      .join('');
  // JS `String.replace` with a non-global RegExp: first match only.
  return withoutMisplaced.replaceFirstMapped(
    topic.pattern,
    (m) => '${topic.emoji} ${m[0]}',
  );
}

/// Web `decorateChatResponse`. Non-string / blank input is returned as is.
String _decorateProse(String content) =>
    [..._cropEmojis, ..._weatherEmojis].fold(content, _decorateTopic);

String decorateChatResponse(String? content) {
  if (content == null || content.trim().isEmpty) return content ?? '';
  // Decorate only the text between link destinations; splice the destinations
  // back verbatim.
  final links = _linkDestination.allMatches(content).map((m) => m[0]!).toList();
  final prose = content.split(_linkDestination).map(_decorateProse).toList();
  final buffer = StringBuffer();
  for (var i = 0; i < prose.length; i++) {
    buffer.write(prose[i]);
    if (i < links.length) buffer.write(links[i]);
  }
  final decorated = buffer.toString();
  return decorated
      .replaceAll(_leadingSpaceBeforeEmoji, '')
      .replaceAllMapped(_spaceBeforePunct, (m) => m[1]!)
      .replaceAllMapped(_doublePunct, (m) => m[1]!)
      .replaceAll(_trailingSpace, '');
}
