import { useEffect, useMemo, useRef, useState } from 'react';
import type { GoalSource, LlmConfig } from '../types';
import type { StepInput } from '../lib/goals';
import { decomposeViaApi, estimateDailyEffort, goalQuestions, grillQuestions, recognizeNotice } from '../lib/decompose';
import type { Decomposition, MissingField, VisionResult } from '../lib/decompose';
import { buildNoticeAppend, type NoticeFields } from '../lib/noticeFields';
import { containsCrisis } from '../lib/submissionGuard';
import { fileToImage } from '../lib/image';
import { dateKeyLocal, parseLocalDate } from '../lib/schedule';
import { readDecomposeDraft, saveDecomposeDraft, DECOMPOSE_DRAFT_KEY } from '../lib/decomposeDraft';

interface Props {
  config: LlmConfig;
  onSave: (input: { title: string; detail: string; source: GoalSource; steps: StepInput[]; dueAt?: number }, schedule: boolean) => void;
  onClose: () => void;
  onModelAttempt: (kind?: 'decompose' | 'vision') => void;
}
export default function DecomposeSheet({ config, onSave, onClose, onModelAttempt }: Props) {
  const [stored] = useState(() => readDecomposeDraft(localStorage));
  const [goal,setGoal] = useState(stored.goal);
  const [deadline,setDeadline] = useState(stored.confirmedDeadline);
  const [manualSteps,setManualSteps] = useState(stored.manualSteps);
  const [mode,setMode] = useState<'manual'|'ai'|'grill'>(stored.mode);
  const [phase,setPhase] = useState<'entry'|'questions'|'requesting'|'preview'>('entry');
  const [answers,setAnswers] = useState<Partial<Record<MissingField,string>>>(stored.answers);
  const [questionIndex,setQuestionIndex] = useState(Object.values(stored.answers).filter((v) => Boolean(v?.trim())).length);
  const [answer,setAnswer] = useState('');
  const [skipped,setSkipped] = useState(false);
  const [source,setSource] = useState<GoalSource>('ai');
  const [plan,setPlan] = useState<Decomposition | null>(null);
  const [checked,setChecked] = useState<number[]>([]);
  const [busy,setBusy] = useState(false);
  const [elapsed,setElapsed] = useState(0);
  const activeController = useRef<AbortController | null>(null);
  const operationId = useRef(0);
  const activeMounted = useRef(true);
  const [error,setError] = useState('');
  const [visionText,setVisionText] = useState('');
  const [visionResult,setVisionResult] = useState<Extract<VisionResult,{ok:true}> | null>(null);
  const [visionBusy,setVisionBusy] = useState(false);
  const [visionNotice,setVisionNotice] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const goalInputRef = useRef<HTMLTextAreaElement>(null);
  const questions = useMemo(
    () => (mode === 'grill' ? grillQuestions(goal, answers) : goalQuestions(goal, answers)),
    [mode, goal, answers],
  );
  useEffect(() => {
    try { saveDecomposeDraft(localStorage, { goal, manualSteps, answers, confirmedDeadline: deadline, mode }); }
    catch { /* storage may be unavailable */ }
  }, [goal, manualSteps, answers, deadline, mode]);
  useEffect(() => {
    if (phase !== 'requesting') return;
    const started = Date.now();
    setElapsed(0);
    const timer = window.setInterval(() => setElapsed(Math.floor((Date.now() - started) / 1000)), 250);
    return () => window.clearInterval(timer);
  }, [phase]);
  useEffect(() => {
    activeMounted.current = true;
    return () => {
      activeMounted.current = false;
      operationId.current++;
      activeController.current?.abort();
    };
  }, []);
  const stopCurrent = () => {
    operationId.current++;
    activeController.current?.abort();
    activeController.current = null;
    setBusy(false);
    setVisionBusy(false);
    setPhase('entry');
    setError('');
  };
  const closeSheet = () => { stopCurrent(); onClose(); };
  const effort = useMemo(() => plan ? estimateDailyEffort(
    plan.steps.filter((_, i) => checked.includes(i)), parseLocalDate(deadline), Date.now()) : null,
    [plan, checked, deadline]);
  const start = () => {
    if (!goal.trim() || goal.length > 2000) {setError('请先填写目标（最多 2000 字）');return;}
    setError('');
    if (mode === 'manual') {
      const lines=manualSteps.split(/\r?\n/).map((s)=>s.trim()).filter(Boolean);
      if (lines.length < 1 || lines.length > 12) {setError('自由拆解需要输入 1–12 行步骤');return;}
      setPlan({title:goal.trim().slice(0,120), assumptions:[],
        steps:lines.map((text)=>({text,minutes:20,kind:'other' as const}))});
      setChecked(lines.map((_,i)=>i)); setSource('manual');setPhase('preview');return;
    }
    setQuestionIndex(Object.values(answers).filter((v) => Boolean(v?.trim())).length);setAnswer('');
    if (questions.length) setPhase('questions');
    else void generate(answers,false);
  };
  const generate = async (nextAnswers: Partial<Record<MissingField,string>>, didSkip: boolean) => {
    const ticket = ++operationId.current;
    const controller = new AbortController();
    activeController.current = controller;
    setBusy(true); setError(''); setPhase('requesting');
    try {
      onModelAttempt('decompose'); // reserve before the first network request
      const result = await decomposeViaApi(config, {
        goalText: goal, answers: nextAnswers, skipped: didSkip, signal: controller.signal,
        onRetryAttempt: () => onModelAttempt('decompose'),
      });
      if (!activeMounted.current || ticket !== operationId.current || controller.signal.aborted) return;
      setPlan(result); setChecked(result.steps.map((_, i) => i));
      setSource(visionText ? 'image' : 'ai'); setPhase('preview');
    } catch (e) {
      if (!activeMounted.current || ticket !== operationId.current || controller.signal.aborted) return;
      setError(`${(e as Error).message}。可以重试或选择自由拆解。`); setPhase('entry');
    } finally {
      if (ticket === operationId.current && activeMounted.current) { setBusy(false); activeController.current = null; }
    }
  };
  const submitAnswer = () => {
    const q = questions[0];
    if (!q) { void generate(answers, skipped); return; }
    const next = { ...answers, [q.field]: answer.trim() };
    setAnswers(next); setAnswer(''); setQuestionIndex((i) => i + 1);
    const remaining = mode === 'grill' ? grillQuestions(goal, next) : goalQuestions(goal, next);
    if (!remaining.length) void generate(next, false);
  };
  const skipQuestions = () => {
    // A typed answer must survive skip as well as an already-submitted answer.
    const q = questions[0];
    const next = q && answer.trim() ? { ...answers, [q.field]: answer.trim() } : answers;
    setAnswers(next); setAnswer(''); setSkipped(true);
    void generate(next, true);
  };
  const upload = async (file?: File) => {
    if (!file || busy || !config.visionModel?.trim()) return;
    const ticket = ++operationId.current;
    const controller = new AbortController();
    activeController.current = controller;
    setBusy(true); setVisionBusy(true); setVisionResult(null); setVisionNotice(''); setError('');
    try {
      if (file.size > 15_000_000) throw new Error('截图超过 15MB');
      const dataURL = await fileToImage(file);
      if (controller.signal.aborted || ticket !== operationId.current) return;
      const result = await recognizeNotice(config, dataURL, {
        signal: controller.signal, onModelAttempt: () => onModelAttempt('vision'),
      });
      if (!activeMounted.current || ticket !== operationId.current || controller.signal.aborted) return;
      if (!result.ok) { setError(`${result.message}；也可以直接粘贴通知原文。`); return; }
      setVisionResult(result);
      setVisionNotice(result.format === 'raw'
        ? '没有按字段识别出来，已保留识别原文。请核对后使用；也可以重新上传或自己粘贴。'
        : '识别结果需要核对。日期仅供参考，不会作为已确认的真实截止日。');
    } catch(e) {
      if (!activeMounted.current || ticket !== operationId.current || controller.signal.aborted) return;
      setError(`${(e as Error).message}；可直接粘贴通知原文。`);
    } finally {
      if (ticket === operationId.current && activeMounted.current) {
        setBusy(false); setVisionBusy(false); activeController.current = null;
      }
    }
  };
  const cancelVision = () => {
    operationId.current++;
    activeController.current?.abort(); activeController.current = null;
    setVisionBusy(false); setBusy(false); setVisionResult(null); setVisionNotice(''); setError('');
  };
  const appendVision = () => {
    if (!visionResult) return;
    const result = buildNoticeAppend(goal, visionResult.format === 'fields'
      ? {format:'fields',fields:visionResult.fields} : {format:'raw',raw:visionResult.raw});
    if (!result.ok) { setError(result.message); return; }
    if (containsCrisis([result.added])) {setError('识别文字包含需要单独处理的高风险内容，不能直接用于目标拆解');return;}
    setGoal(result.text); setVisionText(result.added);
    setVisionResult(null); setVisionNotice(''); setError('');
    goalInputRef.current?.focus();
  };
  const editVisionField = (key: keyof NoticeFields, value: string) => {
    setVisionResult((previous) => previous?.format === 'fields'
      ? {...previous,fields:{...previous.fields,[key]:value}} : previous);
  };
  const reuploadVision = () => {
    setVisionResult(null);setVisionNotice('');setError('');
    if (fileInputRef.current) {fileInputRef.current.value = '';fileInputRef.current.click();}
  };
  const save = (schedule:boolean) => {
    if (!plan || checked.length === 0) {setError('请至少选中一个步骤');return;}
    if (plan.steps.some((step, i) => checked.includes(i) && (!step.text.trim() || !Number.isInteger(step.minutes) || (step.minutes ?? 0) < 1 || (step.minutes ?? 0) > 120))) { setError('请检查所选步骤的动作和分钟数（1–120）'); return; }
    try {
      onSave({title:plan.title,detail:[goal,plan.assumptions.length?'【拆解假设（非事实）】'+plan.assumptions.join('；'):''].filter(Boolean).join('\n'),source,
        steps:plan.steps.filter((_,i)=>checked.includes(i)), dueAt:parseLocalDate(deadline)},schedule);
      localStorage.removeItem(DECOMPOSE_DRAFT_KEY);
      onClose();
    } catch(e) {setError((e as Error).message);}
  };
  return <div className="scrim" onMouseDown={(e)=>{if(e.target===e.currentTarget) closeSheet();}}>
    <div className="sheet meeting-sheet" role="dialog" aria-modal="true" aria-label="拆解一个目标">
      <div className="sheet-head"><div><h2>拆解一个目标</h2><p>可以自己拆，也可以让系统提几个关键问题；「/grill-me」会多问几句，随时可以跳过。</p></div>
        <button className="icon-btn" type="button" aria-label="关闭" onClick={closeSheet}>×</button></div>
      {phase==='entry' && <>
        <div className="meeting-switch" role="group" aria-label="拆解方式">
          <button className={mode==='ai'?'on':''} onClick={()=>setMode('ai')}>自动拆解</button>
          <button className={mode==='grill'?'on':''} onClick={()=>setMode('grill')}>/grill-me · 问清楚</button>
          <button className={mode==='manual'?'on':''} onClick={()=>setMode('manual')}>自由拆解</button>
        </div>
        <label className="field"><span className="field-label">我想完成的目标</span>
          <textarea ref={goalInputRef} rows={4} value={goal} maxLength={2000} onChange={(e)=>setGoal(e.target.value)}
            placeholder="例如：周三前把实验报告写完，数据已经跑完。" /></label>
        <label className="field"><span className="field-label">确认的截止日期（可空；不填不会当成真实 DDL）</span>
          <input type="date" value={deadline} onChange={(e)=>setDeadline(e.target.value)} /></label>
        {<label className="field"><span className="field-label">老师通知 / 作业材料截图（可选）</span>
          <input ref={fileInputRef} type="file" accept="image/png,image/jpeg,image/webp" disabled={busy || !config.visionModel?.trim()}
            onChange={(e)=>{const file=e.currentTarget.files?.[0];e.currentTarget.value='';void upload(file);}}/>
          <small>{config.visionModel?.trim() ? '三种拆解方式都可上传；只有你主动上传才发送到视觉模型，原文可能含老师姓名/群名，导出前请注意隐私。' : '当前没有配置视觉模型。请把通知文字粘贴到输入框。'}</small></label>}
        {visionBusy && <div role="status" aria-live="polite" className="meeting-vision-preview">
          <p>正在识别通知…通常需要 5–15 秒（重试可能更久）。</p>
          <button type="button" className="btn btn-ghost" onClick={cancelVision}>取消识图</button>
        </div>}
        {visionResult && <section className="meeting-vision-preview" aria-label="识图结果核对" role="region">
          <h3>{visionResult.format==='fields'?'识别结果（请核对）':'识别原文（请核对）'}</h3>
          <p role="status">{visionNotice}</p>
          {visionResult.format==='fields' ? <>
            {(['item','date','location','submission'] as const).map((key)=>
              <label className="field" key={key}><span className="field-label">{({item:'事项',date:'日期或 DDL（建议排期，不是实际截止）',location:'地点',submission:'提交方式'} as const)[key]}</span>
                <input value={visionResult.fields[key]} maxLength={250} onChange={(e)=>editVisionField(key,e.target.value)}/></label>)}
            <details><summary>原文摘录（可能含个人信息）</summary><p className="meeting-vision-raw">{visionResult.fields.excerpt==='[未提及]' ? visionResult.raw : visionResult.fields.excerpt}</p></details>
          </> : <label className="field"><span className="field-label">没有按字段识别出来，可修改后再使用</span>
            <textarea rows={7} maxLength={2800} aria-label="识别原文（可编辑）" value={visionResult.raw}
              onChange={(e)=>setVisionResult((prev)=>prev?.format==='raw'?{...prev,raw:e.target.value}:prev)}/></label>}
          <p className="field-hint">识别文字只是待核对材料，不会自动成为真实 DDL，也不会自动保存目标或日程。</p>
          <div className="sheet-actions meeting-actions">
            <button type="button" className="btn btn-primary" onClick={appendVision}>{visionResult.format==='raw'?'用这段文字拆解':'追加到目标输入'}</button>
            <button type="button" className="btn btn-ghost" onClick={reuploadVision}>重新上传</button>
            <button type="button" className="btn btn-ghost" onClick={cancelVision}>取消</button>
            {visionResult.format==='raw' && <button type="button" className="btn btn-ghost" onClick={()=>{cancelVision();goalInputRef.current?.focus();}}>粘贴自己的通知</button>}
          </div>
        </section>}
        {mode==='manual' && <label className="field"><span className="field-label">每行一个小步骤（1–12 行）</span>
          <textarea rows={5} value={manualSteps} onChange={(e)=>setManualSteps(e.target.value)}
            placeholder={'列出异常数据\n写方法段 200 字\n核对参考文献'} /></label>}
        <div className="sheet-actions"><button className="btn btn-ghost" onClick={closeSheet}>取消（保留草稿）</button>
          <button className="btn btn-primary" disabled={busy||!goal.trim()} onClick={start}>{busy?'处理中…':'开始拆解'}</button></div>
      </>}
      {phase==='requesting' && <>
        <p role="status" aria-live="polite" className="meeting-label">{elapsed < 8 ? '正在理解目标…' : elapsed < 20 ? '正在拆步骤…' : '正在整理日期…'}</p>
        {elapsed >= 8 && <p>通常需要 10–40 秒。</p>}
        {elapsed >= 20 && <p>还在拆，你可以继续等，也可以取消。</p>}
        <div className="sheet-actions"><button className="btn btn-ghost" onClick={stopCurrent}>取消拆解（保留输入）</button></div>
      </>}
      {phase==='questions' && <>
        <p className="meeting-label">问题 {Math.min(questionIndex + 1, mode==='grill'?5:3)}/{mode==='grill'?5:3} · 可以跳过</p>
        <p>{questions[0]?.text}</p>
        <input aria-label="回答关键问题" value={answer} onChange={(e)=>setAnswer(e.target.value)} maxLength={180}/>
        <div className="sheet-actions">
          <button className="btn btn-ghost" onClick={skipQuestions}>跳过追问</button>
          <button className="btn btn-primary" disabled={busy||!answer.trim()} onClick={submitAnswer}>继续</button>
        </div>
      </>}
      {phase==='preview' && plan && <>
        <h3>{plan.title}</h3>
        {plan.assumptions.length>0 && <div className="meeting-assumptions" role="note"><b>仅供修改的默认假设</b>
          {plan.assumptions.map((s,i)=><p key={i}>{s}</p>)}
        </div>}
        {effort && <div role="note" className="meeting-assumptions">
          <b>总约 {effort.totalMinutes} 分钟 · 按 {effort.days} 天算，每天约 {effort.dailyMinutes} 分钟</b>
          {!effort.isDeadlineConfirmed && <p>按默认 3 天估算，仅供修改，不是真实 DDL。</p>}
          {effort.heavy && <p>这个方案每天约 {effort.dailyMinutes} 分钟，可能偏重，可以删掉一些步骤。</p>}
        </div>}
        <p className="meeting-label">勾选要采用的步骤；可修改动作、时长和日期（没有日期就不排期）。模型给出的步骤日期只是建议排期，并非老师或学校的真实截止日。</p>
        {plan.steps.map((s,i)=><div className="meeting-step" key={i}>
          <input type="checkbox" aria-label={`采纳步骤 ${i+1}`} checked={checked.includes(i)}
            onChange={(e)=>setChecked((prev)=>e.target.checked?[...prev,i]:prev.filter((v)=>v!==i))}/>
          <div className="meeting-step-fields">
            <input aria-label={`步骤 ${i+1}`} value={s.text} onChange={(e)=>setPlan((p)=>p?{...p,steps:p.steps.map((x,n)=>n===i?{...x,text:e.target.value}:x)}:p)} />
            <div className="meeting-step-meta">
              <label>分钟 <input type="number" min={1} max={120} value={s.minutes ?? 20}
                onChange={(e)=>setPlan((p)=>p?{...p,steps:p.steps.map((x,n)=>n===i?{...x,minutes:Number(e.target.value)}:x)}:p)}/></label>
              <label>日期 <input type="date" value={s.dueAt?dateKeyLocal(s.dueAt):''}
                onChange={(e)=>setPlan((p)=>p?{...p,steps:p.steps.map((x,n)=>n===i?{...x,dueAt:parseLocalDate(e.target.value)}:x)}:p)}/></label>
            </div>
          </div>
        </div>)}
        <div className="sheet-actions meeting-actions">
          <button className="btn btn-ghost" onClick={()=>{setPlan(null);setChecked([]);setPhase('entry');}}>放弃方案（保留草稿）</button>
          <button className="btn btn-ghost" onClick={()=>{setPhase('entry');setError('');}}>返回修改</button>
          <button className="btn btn-ghost" onClick={()=>save(false)}>只保存不排日程</button>
          <button className="btn btn-primary" onClick={()=>save(true)}>加入我的目标并排日程</button>
        </div>
      </>}
      {!!error && <p role="status" className="meeting-error">{error}</p>}
    </div>
  </div>;
}
