/** Old archives baked fictional-AI prefixes into card text. Strip only the
 * leading provenance marker; never rewrite the user's actual words. */
export function stripAiProvenance(text: string): string {
  return text.replace(/^\s*【AI 虚构剧情(?:·模拟结果|·方向碎念)?】\s*/, '');
}
