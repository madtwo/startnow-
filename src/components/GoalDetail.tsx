import { useState } from 'react';
import type { Goal, GoalStep } from '../types';
import { goalProgress } from '../lib/goals';

interface Props {
  goal: Goal; onBack:()=>void; onToggle:(step:GoalStep,done:boolean)=>void;
  onShare:()=>void; onDelete:(removeSchedule:boolean)=>void; onProgress:(feeling:string)=>void;
}
export default function GoalDetail({goal,onBack,onToggle,onShare,onDelete,onProgress}:Props) {
  const [feeling,setFeeling]=useState('');
  const [deleting,setDeleting]=useState(false);
  const {done,total}=goalProgress(goal);
  const within24h=!!goal.sharedAt && Date.now()-goal.sharedAt<86_400_000;
  return <div className="feed meeting-goal-detail">
    <button className="link" onClick={onBack}>← 返回</button>
    <h1 className="page-title">{goal.title}</h1>
    <p className="page-sub">{done}/{total} 步完成 · {goal.visibility==='forum'?'已分享到论坛':'私人目标'}
      {goal.dueAt?` · 截止 ${new Date(goal.dueAt).toLocaleDateString('zh-CN')}`:''}</p>
    {goal.detail&&<p className="meeting-goal-detail-text">{goal.detail}</p>}
    <section className="card section-card"><h3>步骤</h3>
      {goal.steps.map((step)=><label key={step.id} className="meeting-agenda-row">
        <input type="checkbox" checked={step.status==='done'} onChange={(e)=>onToggle(step,e.target.checked)}/>
        <div><b>{step.text}</b><small>{step.estimateMin?`${step.estimateMin} 分钟 · `:''}
          {step.dueAt?new Date(step.dueAt).toLocaleDateString('zh-CN'):'尚未排日期'}</small></div>
      </label>)}
    </section>
    <div className="meeting-actions">
      <button className="btn btn-primary" disabled={within24h||goal.ownerId!=='me'} onClick={onShare}>
        {within24h?'今天已分享':'分享到论坛'}</button>
      <button className="btn btn-ghost" onClick={()=>setDeleting((s)=>!s)}>删除目标…</button>
    </div>
    {deleting&&<section className="card section-card" role="group" aria-label="删除目标选项">
      <p>删除目标后，已安排的日程默认保留为普通日程。</p>
      <button className="btn btn-ghost" onClick={()=>onDelete(false)}>删除目标，保留日程（推荐）</button>
      <button className="btn btn-ghost" onClick={()=>onDelete(true)}>目标和关联日程一起删除</button>
      <button className="btn btn-ghost" onClick={()=>setDeleting(false)}>不删除</button>
    </section>}
    {goal.visibility==='forum'&&<section className="card section-card"><h3>分享进度</h3>
      <textarea rows={2} placeholder="说一句今天做到了什么，或还卡在哪（可以留空）" maxLength={300} value={feeling} onChange={(e)=>setFeeling(e.target.value)}/>
      <button className="btn btn-ghost" onClick={()=>{onProgress(feeling);setFeeling('');}}>发一张进度卡</button>
    </section>}
  </div>;
}
