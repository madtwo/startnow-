import { useState } from 'react';
import type { Gender, Identity, MemoryEntry, Persona, World, WorldSettings } from '../types';
import { AVATAR_KEYS, AVATAR_LABELS, AvatarMark } from '../lib/avatars';
import { BASELINE } from '../lib/baseline';
import { ensureMind, MOOD_LABEL } from '../lib/mind';
import { useDialogFocus } from '../lib/useDialogFocus';
import Avatar from './Avatar';

const COLORS = ['#5f7f66', '#b06a45', '#97784a', '#80667a', '#4f6b8a', '#8a5a4a', '#6b7a4f', '#9a6b7a'];

interface Props {
  personas: Persona[];
  settings: WorldSettings;
  identity: Identity;
  world: World;
  onChangePersona: (persona: Persona) => void;
  onChangeSettings: (settings: WorldSettings) => void;
  onChangeIdentity: (identity: Identity) => void;
  onMemory: (personaId: string, memory: MemoryEntry[]) => void;
  onPersonas: (personas: Persona[]) => void;
  onTick: () => void;
  onAdvance: (hours: number) => void;
  onSummon: (personaId: string) => void;
  onPostAs: (personaId: string) => void;
  onExport: () => void;
  onImport: (raw: string) => void;
  onReseed: () => void;
  onClear: () => void;
  onClose: () => void;
}

type Tab = 'people' | 'world' | 'data';

const newPersona = (index: number): Persona => ({
  id: `custom-${Date.now().toString(36)}`,
  name: '新同伴',
  handle: `@guest${index + 1}`,
  tagline: '还没写完',
  background: '',
  voice: '',
  color: COLORS[index % COLORS.length],
  avatarKey: 'spiral',
  gender: 'none',
  age: 20,
  school: '',
  major: '',
  cohort: '',
  personality: '',
  speech: '',
  approach: '',
  weights: { study: 35, people: 20, love: 15, family: 10, self: 10, future: 10 },
  followUp: 'sometimes',
  intimacy: 10,
  replyDesire: 60,
  memoryMode: 'trim',
  memory: [],
  lastDistillAt: 0,
  weekLog: [],
});

export default function AdminPanel(props: Props) {
  const { personas, settings, identity, world, onClose } = props;
  const [tab, setTab] = useState<Tab>('people');
  const [selected, setSelected] = useState(personas[0]?.id ?? '');
  const [raw, setRaw] = useState('');
  const persona = personas.find((p) => p.id === selected) ?? personas[0];
  const mind = persona ? ensureMind(persona) : null;
  const dialogRef = useDialogFocus<HTMLDivElement>(onClose);

  const patch = (part: Partial<Persona>) => {
    if (!persona) return;
    props.onChangePersona({ ...persona, ...part });
  };

  return (
    <div
      className="scrim"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="sheet admin"
        ref={dialogRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label="作者后台"
      >
        <div className="sheet-head">
          <div>
            <h2>作者后台</h2>
            <p>
              改动立刻生效，只留在这台设备。今日调用 {world.callsToday} / {settings.dailyCalls}
            </p>
          </div>
          <button className="icon-btn" onClick={onClose} aria-label="关闭">
            ×
          </button>
        </div>

        <div className="adm-tabs">
          {(
            [
              ['people', '同伴'],
              ['world', '圈子'],
              ['data', '数据'],
            ] as [Tab, string][]
          ).map(([id, label]) => (
            <button key={id} className={tab === id ? 'on' : ''} onClick={() => setTab(id)}>
              {label}
            </button>
          ))}
        </div>

        {tab === 'people' && persona && (
          <div className="adm-body">
            <div className="adm-people">
              {personas.map((p) => (
                <button
                  key={p.id}
                  className={`adm-person ${p.id === persona.id ? 'on' : ''}`}
                  onClick={() => setSelected(p.id)}
                >
                  <Avatar avatarKey={p.avatarKey} color={p.color} size="sm" />
                  <span>{p.name}</span>
                </button>
              ))}
              {personas.length < 6 && (
                <button
                  className="adm-person add"
                  onClick={() => {
                    const created = newPersona(personas.length);
                    props.onPersonas([...personas, created]);
                    setSelected(created.id);
                  }}
                  title="每多一位，每天大约多 2–4 次调用"
                >
                  + 添加同伴
                </button>
              )}
            </div>

            <div className="adm-grid">
              <label className="field">
                <span className="field-label">名字</span>
                <input value={persona.name} onChange={(e) => patch({ name: e.target.value })} />
              </label>
              <label className="field">
                <span className="field-label">一句话</span>
                <input value={persona.tagline} onChange={(e) => patch({ tagline: e.target.value })} />
              </label>
              <label className="field">
                <span className="field-label">性别</span>
                <select
                  value={persona.gender}
                  onChange={(e) => patch({ gender: e.target.value as Gender })}
                >
                  <option value="none">不设定</option>
                  <option value="female">女</option>
                  <option value="male">男</option>
                </select>
              </label>
              <label className="field">
                <span className="field-label">年龄</span>
                <input
                  type="number"
                  value={persona.age}
                  onChange={(e) => patch({ age: Number(e.target.value) || 0 })}
                />
              </label>
              <label className="field">
                <span className="field-label">学校（虚构）</span>
                <input value={persona.school} onChange={(e) => patch({ school: e.target.value })} />
              </label>
              <label className="field">
                <span className="field-label">专业 / 届别</span>
                <div className="adm-pair">
                  <input value={persona.major} onChange={(e) => patch({ major: e.target.value })} />
                  <input value={persona.cohort} onChange={(e) => patch({ cohort: e.target.value })} />
                </div>
              </label>
              <label className="field">
                <span className="field-label">露脸倾向 · {persona.replyDesire}</span>
                <input
                  type="range"
                  min={0}
                  max={100}
                  step={5}
                  value={persona.replyDesire}
                  onChange={(e) => patch({ replyDesire: Number(e.target.value) })}
                />
              </label>
              <label className="field">
                <span className="field-label">熟悉度 · {persona.intimacy}（越高才越会说重的事）</span>
                <input
                  type="range"
                  min={0}
                  max={100}
                  step={5}
                  value={persona.intimacy}
                  onChange={(e) => patch({ intimacy: Number(e.target.value) })}
                />
              </label>
              <label className="field">
                <span className="field-label">烦恼三档 · 学业 {persona.weights.study}</span>
                <input
                  type="range"
                  min={0}
                  max={60}
                  step={5}
                  value={persona.weights.study}
                  onChange={(e) =>
                    patch({ weights: { ...persona.weights, study: Number(e.target.value) } })
                  }
                />
              </label>
              <label className="field">
                <span className="field-label">人际 {persona.weights.people}</span>
                <input
                  type="range"
                  min={0}
                  max={60}
                  step={5}
                  value={persona.weights.people}
                  onChange={(e) =>
                    patch({ weights: { ...persona.weights, people: Number(e.target.value) } })
                  }
                />
              </label>
              <label className="field">
                <span className="field-label">感情 {persona.weights.love}</span>
                <input
                  type="range"
                  min={0}
                  max={60}
                  step={5}
                  value={persona.weights.love}
                  onChange={(e) =>
                    patch({ weights: { ...persona.weights, love: Number(e.target.value) } })
                  }
                />
              </label>
              <label className="field">
                <span className="field-label">做完会不会发后续</span>
                <select
                  value={persona.followUp}
                  onChange={(e) =>
                    patch({ followUp: e.target.value as Persona['followUp'] })
                  }
                >
                  <option value="rare">很少</option>
                  <option value="sometimes">有时</option>
                  <option value="often">经常</option>
                </select>
              </label>
            </div>

            <label className="field">
              <span className="field-label">背景（学校、专业、寝室、习惯、最近在忙什么）</span>
              <textarea
                rows={4}
                value={persona.background}
                onChange={(e) => patch({ background: e.target.value })}
              />
            </label>
            <label className="field">
              <span className="field-label">他说话的样子（一段原话，用来校准语气）</span>
              <textarea
                rows={2}
                value={persona.voice}
                onChange={(e) => patch({ voice: e.target.value })}
              />
            </label>
            <label className="field">
              <span className="field-label">性格</span>
              <textarea
                rows={2}
                value={persona.personality}
                onChange={(e) => patch({ personality: e.target.value })}
              />
            </label>
            <label className="field">
              <span className="field-label">说话习惯</span>
              <textarea
                rows={2}
                value={persona.speech}
                onChange={(e) => patch({ speech: e.target.value })}
              />
            </label>
            <label className="field">
              <span className="field-label">怎么接话</span>
              <textarea
                rows={2}
                value={persona.approach}
                onChange={(e) => patch({ approach: e.target.value })}
              />
            </label>

            <div className="field">
              <span className="field-label">头像</span>
              <div className="adm-marks">
                {AVATAR_KEYS.map((key) => (
                  <button
                    key={key}
                    className={`adm-mark ${persona.avatarKey === key ? 'on' : ''}`}
                    title={AVATAR_LABELS[key]}
                    onClick={() => patch({ avatarKey: key })}
                  >
                    <AvatarMark avatarKey={key} />
                  </button>
                ))}
              </div>
            </div>

            <div className="field">
              <span className="field-label">颜色</span>
              <div className="adm-colors">
                {COLORS.map((c) => (
                  <button
                    key={c}
                    className={`adm-color ${persona.color === c ? 'on' : ''}`}
                    style={{ background: c }}
                    onClick={() => patch({ color: c })}
                    aria-label={c}
                  />
                ))}
              </div>
            </div>

            {mind && (
              <div className="adm-memory">
                <p className="field-label">此刻心智 · 独立状态（只影响语气，不直接给玩家看）</p>
                <div className="mem-row">
                  <span className="mem-tag">{MOOD_LABEL[mind.mood]}</span>
                  <span className="mem-text">
                    <b>在想</b> {mind.thought}
                  </span>
                </div>
                <div className="mem-row">
                  <span className="mem-tag">惦记</span>
                  <span className="mem-text">{mind.focus}</span>
                </div>
                {mind.movedBy && (
                  <div className="mem-row">
                    <span className="mem-tag">刚被</span>
                    <span className="mem-text">
                      <b>{mind.movedBy.by}</b> {mind.movedBy.what}
                    </span>
                  </div>
                )}
                <p className="adm-hint">
                  发卡、回帖、被别的同伴接话，都会改这里；它也会进入下一次生成的提示词。
                </p>
              </div>
            )}

            <label className="field">
              <span className="field-label">上下文压缩</span>
              <select
                value={persona.memoryMode}
                onChange={(e) => patch({ memoryMode: e.target.value as Persona['memoryMode'] })}
              >
                <option value="trim">只截断</option>
                <option value="summary">允许摘要压缩</option>
              </select>
            </label>

            <div className="adm-memory">
              <p className="field-label">记忆 · {persona.memory.length} 条</p>
              {persona.memory.length === 0 && <p className="adm-hint">还没有记住什么。</p>}
              {persona.memory.map((m) => (
                <div className="mem-row" key={m.id}>
                  <span className={`mem-tag ${m.weight}`}>{m.weight === 'deep' ? '深刻' : '普通'}</span>
                  <span className="mem-text">
                    <b>{m.about}</b> {m.what}
                  </span>
                  <span className="mem-actions">
                    <button
                      className="link"
                      onClick={() =>
                        props.onMemory(
                          persona.id,
                          persona.memory.map((x) =>
                            x.id === m.id
                              ? { ...x, weight: x.weight === 'deep' ? 'light' : 'deep' }
                              : x,
                          ),
                        )
                      }
                    >
                      {m.weight === 'deep' ? '降级' : '钉住'}
                    </button>
                    <button
                      className="link"
                      onClick={() =>
                        props.onMemory(
                          persona.id,
                          persona.memory.filter((x) => x.id !== m.id),
                        )
                      }
                    >
                      删除
                    </button>
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {tab === 'world' && (
          <div className="adm-body">
            <label className="field adm-inline">
              <span className="field-label">暂停</span>
              <input
                type="checkbox"
                checked={settings.paused}
                onChange={(e) => props.onChangeSettings({ ...settings, paused: e.target.checked })}
              />
            </label>
            <div className="adm-grid">
              <label className="field">
                <span className="field-label">每张卡最多来几个人</span>
                <input
                  type="number"
                  min={1}
                  max={4}
                  value={settings.maxArrivals}
                  onChange={(e) =>
                    props.onChangeSettings({ ...settings, maxArrivals: Number(e.target.value) || 1 })
                  }
                />
              </label>
              <label className="field">
                <span className="field-label">同时开着的 AI 卡上限</span>
                <input
                  type="number"
                  min={0}
                  max={4}
                  value={settings.aiCardLimit}
                  onChange={(e) =>
                    props.onChangeSettings({ ...settings, aiCardLimit: Number(e.target.value) || 0 })
                  }
                />
              </label>
              <label className="field">
                <span className="field-label">每天调用上限</span>
                <input
                  type="number"
                  value={settings.dailyCalls}
                  onChange={(e) =>
                    props.onChangeSettings({ ...settings, dailyCalls: Number(e.target.value) || 0 })
                  }
                />
              </label>
              <label className="field">
                <span className="field-label">每次推进最多调用</span>
                <input
                  type="number"
                  value={settings.maxCallsPerTick}
                  onChange={(e) =>
                    props.onChangeSettings({
                      ...settings,
                      maxCallsPerTick: Number(e.target.value) || 1,
                    })
                  }
                />
              </label>
              <label className="field">
                <span className="field-label">原型速度 ×{settings.speed}</span>
                <input
                  type="range"
                  min={1}
                  max={30}
                  step={1}
                  value={settings.speed}
                  onChange={(e) =>
                    props.onChangeSettings({ ...settings, speed: Number(e.target.value) || 1 })
                  }
                />
              </label>
            </div>

            <div className="adm-actions">
              <span className="field-label">调试：推进时间（不在评委主界面出现）</span>
              {[1, 3, 12].map((hours) => (
                <button
                  key={hours}
                  className="btn btn-ghost"
                  onClick={() => props.onAdvance(hours)}
                >
                  +{hours} 小时
                </button>
              ))}
            </div>
            <div className="adm-actions">
              {personas.map((p) => (
                <button
                  key={p.id}
                  className="btn btn-ghost"
                  onClick={() => props.onSummon(p.id)}
                  title="作用在你最新一张没结束的卡上"
                >
                  让{p.name}来
                </button>
              ))}
            </div>
            <div className="adm-actions">
              {personas.map((p) => (
                <button key={p.id} className="btn btn-ghost" onClick={() => props.onPostAs(p.id)}>
                  {p.name}发一张卡
                </button>
              ))}
            </div>
            <details className="adm-baseline">
              <summary>全局底线（只读）</summary>
              <pre>{BASELINE}</pre>
            </details>
            <label className="field">
              <span className="field-label">追加底线 · 只能收紧，不能删改上面那些</span>
              <textarea
                rows={2}
                placeholder="例如：不要提任何品牌名。"
                value={settings.baselineExtra}
                onChange={(e) =>
                  props.onChangeSettings({ ...settings, baselineExtra: e.target.value })
                }
              />
            </label>
            <div className="adm-actions">
              <button className="btn btn-ghost" onClick={props.onTick}>
                让下一个人现在就说话
              </button>
            </div>
            <p className="adm-hint">
              默认是随机的：发完卡第一个人 20–60 秒到（按速度倍率压缩），之后陆续来，不保证都来。上面两排按钮可以手动指定。
            </p>
            <div className="adm-log">
              <p className="field-label">最近日志</p>
              {world.logs.length === 0 && <p className="adm-hint">还没有记录。</p>}
              {world.logs.map((line, i) => (
                <p key={`${i}-${line}`}>{line}</p>
              ))}
            </div>
          </div>
        )}

        {tab === 'data' && (
          <div className="adm-body">
            <div className="adm-grid">
              <label className="field">
                <span className="field-label">你的昵称</span>
                <input
                  value={identity.name}
                  onChange={(e) => props.onChangeIdentity({ ...identity, name: e.target.value })}
                />
              </label>
              <label className="field">
                <span className="field-label">头像</span>
                <div className="adm-marks">
                  {AVATAR_KEYS.slice(0, 6).map((key) => (
                    <button
                      key={key}
                      className={`adm-mark ${identity.avatarKey === key ? 'on' : ''}`}
                      title={AVATAR_LABELS[key]}
                      onClick={() => props.onChangeIdentity({ ...identity, avatarKey: key })}
                    >
                      <AvatarMark avatarKey={key} />
                    </button>
                  ))}
                </div>
              </label>
            </div>
            <label className="field">
              <span className="field-label">一句话自我介绍</span>
              <input
                value={identity.bio}
                onChange={(e) => props.onChangeIdentity({ ...identity, bio: e.target.value })}
              />
            </label>

            <div className="adm-actions">
              <button className="btn btn-ghost" onClick={props.onExport}>
                导出 JSON
              </button>
              <button
                className="btn btn-ghost"
                onClick={() => {
                  if (confirm('重建种子卡？当前卡片会被替换。')) props.onReseed();
                }}
              >
                重建种子
              </button>
              <button
                className="btn btn-ghost danger"
                onClick={() => {
                  if (confirm('清空所有卡片、人设和记忆？')) props.onClear();
                }}
              >
                清空全部
              </button>
            </div>

            <label className="field">
              <span className="field-label">导入 JSON</span>
              <textarea
                rows={4}
                value={raw}
                placeholder="把导出的内容贴回来"
                onChange={(e) => setRaw(e.target.value)}
              />
            </label>
            <div className="adm-actions">
              <button className="btn btn-ghost" onClick={() => props.onImport(raw)}>
                导入
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
