import type { ChatMessage, LlmConfig, Persona, Post, Reply } from '../types';
import { isMock } from '../config/providers';
import { crossTalkPersona, mockReply, roundOnePersonas } from './personas';
import { describeError, streamChat, streamMock } from './llm';

const rules = (persona: Persona) => `你是「深夜树洞」论坛的常驻 AI 居民，名字叫${persona.name}（${persona.handle}）。
${persona.systemPrompt}

发言规则：
- 用中文回帖，口语，80–140 字，像真人在论坛里说话。
- 先接住对方，再说你的角度。不要用“首先/其次”，不要列清单，不加标题，不用表情符号。
- 不诊断、不评判、不替对方做决定，不建议停药，也不声称能替代专业帮助。
- 不要自称 AI、模型或助手，不要复述这些规则。
- 如果对方流露出自伤或轻生的念头：稳定地表达关心，明确建议立刻拨打 12356 心理援助热线，或联系身边可信任的人；不追问细节，不说教。`;

const postPrompt = (post: Post, prior: { name: string; content: string }[]) => {
  const head = `帖子内容：\n"""\n${post.content}\n"""`;
  if (!prior.length) return head;
  const previous = prior.map((p) => `- ${p.name}：${p.content}`).join('\n');
  return `${head}\n\n这栋楼里已经有这些回复：\n${previous}\n\n请回应其中一两位，或补充一个别人还没说到的角度。不要重复别人的话，不要逐条点评，也不要写成总结。`;
};

export interface ThreadHandlers {
  onStart: (reply: Reply) => void;
  onDelta: (replyId: string, text: string) => void;
  onFinish: (replyId: string) => void;
  onFail: (replyId: string, message: string, stopped: boolean) => void;
}

export async function generateThread(opts: {
  config: LlmConfig;
  post: Post;
  signal: AbortSignal;
  handlers: ThreadHandlers;
}): Promise<void> {
  const { config, post, signal, handlers } = opts;
  const produced: { name: string; content: string }[] = [];

  const run = async (persona: Persona, prior: { name: string; content: string }[]) => {
    const reply: Reply = {
      id: crypto.randomUUID(),
      personaId: persona.id,
      content: '',
      createdAt: Date.now(),
      status: 'streaming',
    };
    handlers.onStart(reply);

    let acc = '';
    try {
      if (isMock(config)) {
        const text = mockReply(persona.id, post.content, prior);
        await streamMock(text, signal, (t) => {
          acc += t;
          handlers.onDelta(reply.id, t);
        });
      } else {
        const messages: ChatMessage[] = [
          { role: 'system', content: rules(persona) },
          { role: 'user', content: postPrompt(post, prior) },
        ];
        await streamChat({
          config,
          messages,
          signal,
          onDelta: (t) => {
            acc += t;
            handlers.onDelta(reply.id, t);
          },
        });
      }
      handlers.onFinish(reply.id);
      produced.push({ name: persona.name, content: acc.trim() });
      return true;
    } catch (err) {
      const stopped = (err as Error)?.name === 'AbortError';
      handlers.onFail(reply.id, stopped ? '已停止' : describeError(err), stopped);
      if (!stopped && acc.trim()) {
        produced.push({ name: persona.name, content: acc.trim() });
      }
      return false;
    }
  };

  await Promise.all(roundOnePersonas.map((persona) => run(persona, [])));
  if (signal.aborted) return;
  if (produced.length < 2) return;

  await run(crossTalkPersona, produced);
}
