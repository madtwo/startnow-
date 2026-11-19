import { useMemo, useState } from 'react';
import type { Goal, ScheduleItem } from '../types';
import { dateKeyLocal, parseLocalDate } from '../lib/schedule';

interface Props {
  items: ScheduleItem[];
  goals: Goal[];
  onToggle: (id: string, done: boolean) => void;
  onAdd: (title: string, date: string, time?: number) => void;
  onOpenGoal: (id: string) => void;
  onDecompose: () => void;
}
export default function ScheduleView({ items,goals,onToggle,onAdd,onOpenGoal,onDecompose }: Props) {
  const [mode,setMode] = useState<'calendar'|'list'>(()=>localStorage.getItem('startnow.calendarView')==='list'?'list':'calendar');
  const [selected,setSelected] = useState(()=>dateKeyLocal(Date.now()));
  const [title,setTitle]=useState('');
  const [date,setDate]=useState(()=>dateKeyLocal(Date.now()));
  const [clock,setClock]=useState('');
  const [error,setError]=useState('');
  const [month,setMonth]=useState(()=>new Date(new Date().getFullYear(),new Date().getMonth(),1));
  const mine=items.filter((item)=>item.ownerId==='me');
  const byDate=useMemo(()=>new Map([...new Set(mine.map((i)=>i.dateKey))].map((key)=>
    [key,mine.filter((item)=>item.dateKey===key)])),[items]);
  const start = new Date(month.getFullYear(),month.getMonth(),1);
  start.setDate(start.getDate()-((start.getDay()+6)%7));
  const monthCells=Array.from({length:42},(_,i)=>{
    const d=new Date(start);d.setDate(start.getDate()+i);return {key:dateKeyLocal(d.getTime()),day:d.getDate(),inMonth:d.getMonth()===month.getMonth()};
  });
  const visible=mode==='list'?mine.slice().sort((a,b)=>a.dateKey.localeCompare(b.dateKey)):
    [...(byDate.get(selected)??[])];
  const listDateLabel = (key: string): string => {
    const today = dateKeyLocal(Date.now());
    const tomorrow = new Date(); tomorrow.setDate(tomorrow.getDate()+1);
    return key===today ? `今天 · ${key}` : key===dateKeyLocal(tomorrow.getTime()) ? `明天 · ${key}` : key;
  };
  const add=()=>{
    try { const parts=clock.split(':');const minute=clock?Number(parts[0])*60+Number(parts[1]):undefined;
      onAdd(title,date,minute);setTitle('');setClock('');setError(''); }
    catch(e){setError((e as Error).message);}
  };
  return <div className="feed meeting-schedule">
    <div className="page-head"><div><h1 className="page-title">日程</h1><p className="page-sub">这里安排长期目标；便签仍记录现在的一小步。</p></div>
      <div className="meeting-switch"><button className={mode==='calendar'?'on':''} onClick={()=>{setMode('calendar');localStorage.setItem('startnow.calendarView','calendar');}}>日历</button>
        <button className={mode==='list'?'on':''} onClick={()=>{setMode('list');localStorage.setItem('startnow.calendarView','list');}}>列表</button></div></div>
    {mode==='calendar' && <section className="card section-card meeting-calendar">
      <div className="meeting-calendar-head"><button aria-label="上个月" onClick={()=>setMonth(new Date(month.getFullYear(),month.getMonth()-1,1))}>‹</button>
        <b>{month.getFullYear()} 年 {month.getMonth()+1} 月</b>
        <button aria-label="下个月" onClick={()=>setMonth(new Date(month.getFullYear(),month.getMonth()+1,1))}>›</button></div>
      <div className="meeting-days">{['一','二','三','四','五','六','日'].map((day)=><b key={day}>{day}</b>)}</div>
      <div className="meeting-days">{monthCells.map((cell)=><button key={cell.key} type="button"
        className={`${cell.key===selected?'selected ':''}${cell.inMonth?'':'faded'}`} aria-label={`${cell.key}，${(byDate.get(cell.key)??[]).length} 条日程`}
        onClick={()=>setSelected(cell.key)}>{cell.day}{byDate.has(cell.key)&&<span className="meeting-dot"/>}</button>)}</div>
      <p className="meeting-label">{selected} · {(byDate.get(selected)??[]).length} 条</p>
    </section>}
    {visible.length===0 && <div className="empty"><p>还没有安排。去「试试」拆解一个目标，或手动加一条。</p>
      <button className="btn btn-ghost" onClick={onDecompose}>拆解一个目标</button></div>}
    {visible.length>0 && <div className="meeting-agenda">{visible.map((item,index)=>{
      const linked=goals.find((g)=>g.id===item.goalId);
      const overdue=item.status==='todo' && (parseLocalDate(item.dateKey)??Infinity)<new Date().setHours(0,0,0,0);
      return <div key={item.id}>
        {mode==='list' && (index===0||visible[index-1].dateKey!==item.dateKey) &&
          <h3 className="meeting-list-date">{listDateLabel(item.dateKey)}</h3>}
        <div className={`meeting-agenda-row ${overdue?'overdue':''}`}>
        <input type="checkbox" checked={item.status==='done'} aria-label={`完成 ${item.title}`}
          onChange={(e)=>onToggle(item.id,e.target.checked)}/>
        <div><b>{item.title}</b><small>{item.dateKey}{item.startMin!==undefined?` · ${String(Math.floor(item.startMin/60)).padStart(2,'0')}:${String(item.startMin%60).padStart(2,'0')}`:' · 全天'}
          {overdue?' · 已逾期':''}</small>{linked && <button className="meeting-link" onClick={()=>onOpenGoal(linked.id)}>{linked.title}</button>}</div>
        </div>
      </div>;
    })}</div>}
    <section className="card section-card"><h3>手动添加</h3>
      <div className="meeting-manual"><input aria-label="日程标题" placeholder="例如：核对方法段" value={title} onChange={(e)=>setTitle(e.target.value)}/>
        <input aria-label="日程日期" type="date" value={date} onChange={(e)=>setDate(e.target.value)}/>
        <input aria-label="日程时间（可空）" type="time" value={clock} onChange={(e)=>setClock(e.target.value)}/>
        <button className="btn btn-primary" disabled={!title.trim()} onClick={add}>添加日程</button></div>
      {!!error&&<p role="alert" className="meeting-error">{error}</p>}
    </section>
  </div>;
}
