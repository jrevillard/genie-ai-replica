const CROP_EMOJIS = [
  { emoji: '🌾', pattern: /\b(?:rice aman|aman rice|rice)\b/i },
  { emoji: '🍆', pattern: /\beggplant\b/i },
  { emoji: '🥭', pattern: /\bmango\b/i }
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

export function decorateChatResponse(content) {
  if (typeof content !== 'string' || !content.trim()) return content;

  const decorated = [...CROP_EMOJIS, ...WEATHER_EMOJIS].reduce(decorateTopic, content);
  return decorated
    .replace(/^[ \t]+(?=(?:🌾|🍆|🥭|⚠️|⛈️|🌧️|☀️|☁️|🌡️|💧|💨|🏜️|🌊))/gm, '')
    .replace(/[ \t]+([,.;:!?])/g, '$1')
    .replace(/([.!?])[,;:]/g, '$1')
    .replace(/[ \t]+$/gm, '');
}
