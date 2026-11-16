import type { Persona } from '../types';

interface Props {
  personas: Persona[];
  onForgetOne: (personaId: string, entryId: string) => void;
  onForgetRole: (personaId: string) => void;
  onForgetAll: () => void;
}

export default function MemoryManager({ personas, onForgetOne, onForgetRole, onForgetAll }: Props) {
  const count = personas.reduce((sum, p) => sum + p.memory.length, 0);
  return (
    <section className="profile-block memory-manager" aria-label="角色记忆管理">
      <h3>角色记忆 · {count} 条</h3>
      <p className="profile-hint">
        这里列出保存在当前浏览器的长期角色记忆，不是聊天全文。删除也会清理角色近期背景与心情缓存；不会删除原帖、备份、已发出的模型请求或服务方记录。
      </p>
      {personas.map((persona) => (
        <details className="memory-persona" key={persona.id}>
          <summary>{persona.name}（虚构 AI · {persona.memory.length} 条）</summary>
          {persona.memory.length === 0 ? <p className="profile-hint">目前没有长期记忆。</p> : (
            <>
              <button className="btn btn-ghost danger" onClick={() => onForgetRole(persona.id)}>
                删除这个角色的全部记忆
              </button>
              <ul className="memory-list">
                {[...persona.memory].sort((a, b) => b.at - a.at).map((m) => (
                  <li key={m.id}>
                    <div><strong>{m.about}</strong>：{m.what}</div>
                    <small>
                      {m.weight === 'deep' ? '较长期' : '短期'} · {new Date(m.at).toLocaleDateString('zh-CN')} · 来源卡 {m.postId.slice(0, 10)}
                      {m.merged ? ' · 旧摘要（来源不完整）' : ''}
                    </small>
                    <button className="btn btn-ghost" onClick={() => onForgetOne(persona.id, m.id)}>
                      删除这一条
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}
        </details>
      ))}
      {count > 0 && (
        <button className="btn btn-ghost danger" onClick={onForgetAll}>清空全部角色记忆</button>
      )}
      <p className="profile-hint">
        删除会把可追溯的来源卡标记为“不再提炼记忆”；旧合并摘要无法逐条还原来源，导入旧备份也可能恢复已删除内容。
      </p>
    </section>
  );
}
