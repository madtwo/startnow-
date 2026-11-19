import type { Card, Persona } from '../types';

/** Builds a competition-only seed on a clean browser; never rewrites existing saves. */
export function buildCompetitionSeedCards(seed: readonly Card[], personas: readonly Persona[], now = Date.now()): Card[] {
  const original = seed.filter((c) => c.kind !== 'guide' && c.kind !== 'goal' && c.kind !== 'progress' && !c.goalId && !c.image);
  const intros = personas.slice(0, 4).map((p, index) => {
    const existing = original.find((c) => c.authorId === p.id && c.intro);
    if (existing) return existing;
    return {
      id: `competition-intro-${p.id}`, authorId: p.id, authorName: p.name,
      authorKind: 'persona' as const, intro: true, kind: 'worry' as const,
      text: `${p.school} · ${p.major} · ${p.cohort}。${p.tagline}`,
      createdAt: now - (10 - index) * 60_000, status: 'talking' as const,
      arrivals: [], plan: [], pending: [], comments: [], likes: 0, origin: 'demo' as const,
    };
  });
  const worries = original.filter((c) => c.kind === 'worry' && !c.intro && c.authorKind === 'persona' &&
    /(作业|课程|论文|实验|考试|学习|实习|报告|复习|科研|文献)/.test(`${c.title ?? ''}${c.text}`));
  // Reserve one of the three study slots for the mandatory literature card.
  const study = worries.slice(0, 2);
  const miaoze = personas.find((p) => p.id === 'miaoze');
  if (miaoze && !study.some((c) => c.authorId === 'miaoze' && /文献综述/.test(`${c.title ?? ''}${c.text}`))) {
    study.push({
      id: 'competition-miaoze-literature', authorId: miaoze.id, authorName: miaoze.name,
      authorKind: 'persona', kind: 'worry', title: '文献综述还是没动笔',
      text: '材料方向的文献综述又收藏了好多篇。今天准备先读一篇摘要，在纸上写下它研究的材料和方法。',
      createdAt: now - 4 * 60_000, status: 'talking', arrivals: [], plan: [], pending: [], comments: [],
      origin: 'simulated', likes: 0,
    });
  }
  const who = miaoze ?? personas[0];
  const result: Card[] = who ? [{
    id: 'competition-prerun-result', authorId: who.id, authorName: who.name,
    authorKind: 'persona', kind: 'brag', origin: 'simulated',
    title: `${who.name} · 小小炫耀`,
    text: '【AI 虚构剧情·模拟结果】今天终于从文献综述里选出一篇，只读了摘要，记下材料和方法。还没开始写正文。',
    createdAt: now - 60_000, status: 'talking', arrivals: [], plan: [], pending: [], comments: [], likes: 0,
  }] : [];
  return [...intros, ...study, ...result];
}
