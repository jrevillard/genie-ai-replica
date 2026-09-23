const CROP_EMOJIS = [
  { emoji: '🌾', pattern: /\b(?:rice aman|aman rice|rice)\b/i },
  { emoji: '🍆', pattern: /\beggplant\b/i },
  { emoji: '🥭', pattern: /\bmango\b/i },
  { emoji: '🫚', pattern: /\bturmeric\b/i }
];

const WEATHER_EMOJIS = [
  { emoji: '⚠️', pattern: /\b(?:warnings?|alerts?|hazards?)\b/i },
  { emoji: '⛈️', pattern: /\b(?:thunderstorms?|storms?|lightning)\b/i },
  { emoji: '🌧️', pattern: /\b(?:rain(?:fall|s|ing)?|showers?|drizzle)\b/i },
  { emoji: '☀️', pattern: /\b(?:sunny|sunshine|clear sky)\b/i },
  { emoji: '☁️', pattern: /\b(?:cloudy|clouds?|overcast)\b/i },
  { emoji: '🌡️', pattern: /\b(?:temperatures?|heat|hot|cold)\b/i },
  { emoji: '💧', pattern: /\b(?:humidity|moisture)\b/i },
  { emoji: '💨', pattern: /\b(?:winds?|windy|gusts?)\b/i },
  { emoji: '🏜️', pattern: /\bdroughts?\b/i },
  { emoji: '🌊', pattern: /\b(?:floods?|flooded|flooding)\b/i }
];

function decorateTopic(content, { emoji, pattern }) {
  if (!pattern.test(content)) return content;

  const plainEmoji = emoji.replace('\ufe0f', '');
  const withoutMisplacedEmoji = content.split(emoji).join('').split(plainEmoji).join('');
  return withoutMisplacedEmoji.replace(pattern, (topic) => `${emoji} ${topic}`);
}

// Markdown link destinations: "](" up to the closing ")". These are URLs, not
// prose, and must never be decorated. In a translated (e.g. Bengali) answer
// the only Latin "drought" left is the one inside
// "/api/weather/drought-report/..." — decorating it broke the report link.
const LINK_DESTINATION = /\]\([^)]*\)/g;

function decorateProse(content) {
  return [...CROP_EMOJIS, ...WEATHER_EMOJIS].reduce(decorateTopic, content);
}

export function decorateChatResponse(content) {
  if (typeof content !== 'string' || !content.trim()) return content;

  // Decorate only the text between link destinations; splice the destinations
  // back verbatim.
  const links = content.match(LINK_DESTINATION) || [];
  const prose = content.split(LINK_DESTINATION).map(decorateProse);
  const decorated = prose.reduce((out, part, i) => out + part + (links[i] || ''), '');

  return decorated
    .replace(/^[ \t]+(?=(?:🌾|🍆|🥭|⚠️|⛈️|🌧️|☀️|☁️|🌡️|💧|💨|🏜️|🌊))/gm, '')
    .replace(/[ \t]+([,.;:!?])/g, '$1')
    .replace(/([.!?])[,;:]/g, '$1')
    .replace(/[ \t]+$/gm, '');
}
