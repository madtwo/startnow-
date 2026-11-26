// Minimal pre-model crisis guard for the gateway MVP. This is not a classifier
// and must not be described as one; it only fails closed on explicit phrases.
const CRISIS = /(?:自杀|自残|轻生|不想活|结束(?:自己|生命)|跳楼|割腕|吞药|安眠药过量|活不下去)/u;
const INVISIBLE = /[\p{Default_Ignorable_Code_Point}\p{Cf}\p{Cc}]/gu;

export const SAFETY_RULESET = 'gateway-mvp-crisis-v1';

export function hasExplicitCrisis(messages) {
  // System prompts contain the product's own crisis-policy wording; only the
  // user-authored turns are actual input.
  return messages.some((message) =>
    message && message.role === 'user' && typeof message.content === 'string' &&
    CRISIS.test(message.content.normalize('NFKC').replace(INVISIBLE, '')));
}

export function validateMessages(messages) {
  if (!Array.isArray(messages) || messages.length < 1 || messages.length > 40) return false;
  const chars = messages.reduce((sum, message) => sum + (typeof message?.content === 'string' ? message.content.length : 0), 0);
  if (chars > 48_000) return false;
  return messages.some(message => message?.role === 'user') && messages.every((message) =>
    message && typeof message === 'object' && !Array.isArray(message) &&
    Object.keys(message).every(key => key === 'role' || key === 'content') &&
    ['system', 'user', 'assistant'].includes(message.role) &&
    typeof message.content === 'string' &&
    message.content.length <= 16_000);
}
