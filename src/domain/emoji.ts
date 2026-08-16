const keycap = /^[0-9#*]\uFE0F?\u20E3$/u;
const flag = /^(?:\p{Regional_Indicator}){2}$/u;
const pictographicSequence = /^(?:\p{Extended_Pictographic}|\p{Emoji_Modifier}|\u200D|\uFE0E|\uFE0F)+$/u;

export function isOrdinaryEmoji(value: string): boolean {
  if (!value || value.length > 16) return false;
  if (keycap.test(value) || flag.test(value)) return true;
  return /\p{Extended_Pictographic}/u.test(value) && pictographicSequence.test(value);
}

export function containsOrdinaryEmoji(value: string): boolean {
  return /\p{Extended_Pictographic}/u.test(value) || /(?:\p{Regional_Indicator}){2}/u.test(value) || /[0-9#*]\uFE0F?\u20E3/u.test(value);
}
