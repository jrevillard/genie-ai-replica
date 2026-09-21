/**
 * Backend twin of the web client's `utils/chatResponseEmojis.js`.
 *
 * The client decorates answers by matching ENGLISH words ("rain", "drought"),
 * so a translated Bengali answer never gets emojis: by the time it reaches the
 * client the words are Bengali. The translator, however, carries emojis
 * through untouched (verified 4/4 on gemma-3-4b-it), so decorating the English
 * text BEFORE it is translated gives Bengali answers the same emojis English
 * ones get. The client skips text that already carries an emoji, so an
 * English answer decorated here is not decorated twice.
 *
 * Keep the patterns in step with the client file. Pure / synchronous.
 */
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

// Markdown link destinations are URLs, not prose: never decorate them
// ("/drought-report/" would otherwise become "/🏜️ drought-report/").
const LINK_DESTINATION = /\]\([^)]*\)/g;

function decorateTopic(content, { emoji, pattern }) {
  if (!pattern.test(content)) return content;
  const plainEmoji = emoji.replace('️', '');
  const withoutMisplacedEmoji = content.split(emoji).join('').split(plainEmoji).join('');
  return withoutMisplacedEmoji.replace(pattern, (topic) => `${emoji} ${topic}`);
}

function decorateProse(content) {
  return [...CROP_EMOJIS, ...WEATHER_EMOJIS].reduce(decorateTopic, content);
}

function decorateChatResponse(content) {
  if (typeof content !== 'string' || !content.trim()) return content;
  const links = content.match(LINK_DESTINATION) || [];
  const prose = content.split(LINK_DESTINATION).map(decorateProse);
  const decorated = prose.reduce((out, part, i) => out + part + (links[i] || ''), '');
  return decorated
    .replace(/^[ \t]+(?=(?:🌾|🍆|🥭|⚠️|⛈️|🌧️|☀️|☁️|🌡️|💧|💨|🏜️|🌊))/gm, '')
    .replace(/[ \t]+([,.;:!?])/g, '$1')
    .replace(/([.!?])[,;:]/g, '$1')
    .replace(/[ \t]+$/gm, '');
}

module.exports = { decorateChatResponse };
