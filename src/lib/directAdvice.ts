/** Distinguish an explicit one-step request from ordinary discussion or quoted advice. */
export function wantsDirectAdvice(text: string): boolean {
  const clean = text.normalize('NFKC').replace(/\s+/g, '');
  if (/(?:不要|别|不需要|不用|不想要)(?:你|你们)?(?:给|告诉|再给|直接给|急着给)(?:我)?.{0,12}(?:下一步|建议|办法|主意|行动)/.test(clean)) return false;
  return /(?:给我|告诉我|帮我想|说个|来个|直接要).{0,14}(?:下一步|一个行动|具体一步|第一步|小步骤|具体建议|建议)/.test(clean) ||
    /(?:下一步|第一步).{0,10}(?:怎么做|该做啥|先做啥|做什么|先干什么|是什么)/.test(clean) ||
    /(?:我现在|现在我|接下来我|接下来)(?:能|该|要|先|可以).{0,8}(?:做什么|干什么|做啥|干啥)/.test(clean);
}
