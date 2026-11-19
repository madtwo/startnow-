/** Interprets a *visible* date expression in the browser's local timezone.
 * Missing year/time or competing dates are ambiguous and must not be scheduled.
 * This is an assistive preview, never authorization to create a Goal/Schedule.
 */
export interface DeadlineParse { iso: string | null; ambiguous: boolean }
const DAY_NAMES: Record<string,number> = {日:0,天:0,一:1,二:2,三:3,四:4,五:5,六:6};
const invalid:DeadlineParse={iso:null,ambiguous:true};

export function parseMaterialDeadline(value: string | undefined, now=Date.now()):DeadlineParse {
  if (!value?.trim() || value.length>160) return invalid;
  const text=value.trim().replace(/[０-９]/g, d=>String(d.charCodeAt(0)-65296));
  const dates=Array.from(text.matchAll(/(?:20\d\d[-/.年]\d{1,2}[-/.月]\d{1,2}日?|\d{1,2}月\d{1,2}日|(?:下周|本周|周|星期)[一二三四五六日天]|今天|明天|后天)/g),m=>m[0]);
  if (dates.length!==1) return invalid;
  // Do not guess that an unlabeled time is 23:59. A date alone is not a due instant.
  const time=/(凌晨|早上|上午|中午|下午|晚上)?\s*(\d{1,2})(?:[:：](\d{2})|点(?:钟)?(?:半|\s*(\d{1,2})分?)?)/.exec(text.replace(dates[0],''));
  if (!time) return invalid;
  let hour=Number(time[2]);
  let minute=time[3] ? Number(time[3]) : text.includes('半') ? 30 : Number(time[4]??0);
  if (!Number.isInteger(hour) || !Number.isInteger(minute) || minute<0 || minute>59 || hour>23) return invalid;
  if (time[1] && hour>12) return invalid;
  if (['下午','晚上'].includes(time[1]??'') && hour<12) hour+=12;
  if (time[1]==='凌晨' && hour===12) hour=0;
  if (time[1]==='中午' && hour<11) hour+=12;
  let year:number,month:number,day:number;
  const date=dates[0];
  const ref=new Date(now);
  const absolute=/^(20\d\d)[-/\.年](\d{1,2})[-/\.月](\d{1,2})日?$/.exec(date);
  if (absolute) {
    year=Number(absolute[1]); month=Number(absolute[2]); day=Number(absolute[3]);
  } else if (/^\d{1,2}月\d{1,2}日$/.test(date)) {
    // A yearless month/day might be next year or a past announcement.
    return invalid;
  } else if (['今天','明天','后天'].includes(date)) {
    const d=new Date(ref.getFullYear(),ref.getMonth(),ref.getDate()+['今天','明天','后天'].indexOf(date));
    year=d.getFullYear();month=d.getMonth()+1;day=d.getDate();
  } else {
    const match=/^(下周|本周|周|星期)([一二三四五六日天])$/.exec(date);
    if (!match) return invalid;
    const dayOfWeek=DAY_NAMES[match[2]];
    const current=ref.getDay();
    const thisMonday=new Date(ref.getFullYear(),ref.getMonth(),ref.getDate()-((current+6)%7));
    const target=new Date(thisMonday.getFullYear(),thisMonday.getMonth(),thisMonday.getDate()+
      (dayOfWeek+6)%7+(match[1]==='下周'?7:0));
    // An unqualified week-day in the past is ambiguous: do not silently shift a week.
    if (target.getTime()+86_400_000<=new Date(ref.getFullYear(),ref.getMonth(),ref.getDate()).getTime()) return invalid;
    year=target.getFullYear();month=target.getMonth()+1;day=target.getDate();
  }
  if (year<2020 || year>2100 || month<1 || month>12 || day<1 || day>31) return invalid;
  const dateObj=new Date(year,month-1,day,hour,minute,0,0);
  if (dateObj.getFullYear()!==year || dateObj.getMonth()!==month-1 ||
      dateObj.getDate()!==day || dateObj.getHours()!==hour || dateObj.getMinutes()!==minute ||
      dateObj.getTime()<=now) return invalid;
  return {iso:dateObj.toISOString(),ambiguous:false};
}

/** UI local datetime entry, not UTC. Never accept accidental past dates. */
export function confirmedDeadline(value: string, now=Date.now()): number|null {
  if (!/^20\d{2}-\d\d-\d\dT\d\d:\d\d$/.test(value)) return null;
  const date=new Date(value);
  const ts=date.getTime();
  if (!Number.isFinite(ts) || ts<=now || ts>now+3*365*86_400_000) return null;
  const same=`${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}T${String(date.getHours()).padStart(2,'0')}:${String(date.getMinutes()).padStart(2,'0')}`;
  return same===value ? ts : null;
}

export function deadlineInputValue(parsed:DeadlineParse):string {
  if (!parsed.iso || parsed.ambiguous) return '';
  const d=new Date(parsed.iso);
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}T${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
}
