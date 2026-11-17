/** 将底层的可诊断模型错误转成普通用户能理解的轻量提示，不冒充角色回话。 */
export function modelFailureNotice(logs: readonly string[]): string | null {
  const failed = logs.find((line) =>
    /本轮模型不可用|发帖模型不可用|建议决定失败|模型挑选下一步失败/.test(line));
  if (!failed) return null;
  if (/429|请求太频繁/.test(failed)) return '模型请求受到限流（429），这次没有发布不完整回复；稍后再试。';
  if (/中途断开|断流/.test(failed)) return '模型回复中途断开，这次没有发布不完整回复；稍后再试。';
  if (/模型挑选下一步失败/.test(failed)) return '模型暂时无法选择下一步，已使用标明来源的预置动作。';
  return '模型暂时不可用，当前任务稍后会重试。';
}
