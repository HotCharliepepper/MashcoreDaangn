import { channels, choices, roles, types } from './config.mjs';
import { daily, last, rangeReport } from './flow.mjs';
export const $ = id => document.getElementById(id);
export function el(tag, text, css) {
  const n=document.createElement(tag);
  if (text!=null) n.textContent=text;
  if (css) n.className=css;
  return n;
}
const fmt = new Intl.NumberFormat('ko-KR',{maximumFractionDigits:0});
const timeFmt = new Intl.DateTimeFormat('ko-KR',{timeZone:'Asia/Seoul',month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit',hour12:false});
export const stamp = iso => timeFmt.format(new Date(iso));
export const amount = (n,unit) => n==null ? '미측정' : fmt.format(n)+unit;
export const planName = e => 'v'+e.snapshot.planRevision+' · '+e.data.creative;
export const runName = e => '계획 v'+e.snapshot.planRevision+' · '+e.data.start+'–'+e.data.end;
export function options(select, entries, selected, empty='대기 중인 기록 없음') {
  select.replaceChildren(...(entries.length? entries:[['',empty]]).map(([id,label])=>new Option(label,id)));
  if (entries.some(([id])=>id===selected)) select.value=selected;
}
export function fill(form, values) {
  for (const input of form.elements) {
    if (!input.name || !Object.hasOwn(values,input.name)) continue;
    if (input.type==='checkbox') input.checked=values[input.name];
    else input.value=values[input.name] ?? '';
  }
}
export function readForm(form) {
  const field={};
  for (const x of form.elements) {
    if (!x.name) continue;
    if (x.type==='number') field[x.name]=x.value===''?null:x.valueAsNumber;
    else if (x.type==='checkbox') field[x.name]=x.checked;
    else field[x.name]=x.value.trim();
  }
  return field;
}
function cards(id,items) {
  $(id).replaceChildren(...items.map(([label,value,sub])=>{
    const d=el('div',null,'kpi'); d.append(el('small',label),el('b',value),el('small',sub)); return d;
  }));
}
function nodeList(id,entries,empty) {
  $(id).replaceChildren(...(entries.length?entries:[el('p',empty,'help')]));
}
function entry(title, desc, meta) {
  const row=el('div',null,'entry'); row.append(el('strong',title));
  if (desc) row.append(el('p',desc));
  if (meta) row.append(el('small',meta));
  return row;
}
function info(e) { return roles[e.role]+' · '+e.actorId+' · '+stamp(e.updatedAt); }
function minutes(t) { const [h,m]=t.split(':').map(Number); return h*60+m; }
function track(start,end,kind) {
  const line=el('div',null,'track '+kind), bar=el('i');
  line.setAttribute('aria-hidden','true');
  bar.style.left=minutes(start)/1440*100+'%'; bar.style.width=(minutes(end)-minutes(start))/1440*100+'%';
  line.append(bar);return line;
}
export function dashboard(d) {
  cards('today-kpis',[
    ['방문 팀',amount(d.teams,'팀'),'점심 + 저녁'],['매출',amount(d.revenue,'원'),'영업일 마감'],
    ['광고비',amount(d.spend,'원'),'하루 집계 기준'],['관리 시간',amount(d.minutes,'분'),'직접 기록'],
  ]);
  const plans=d.rows.filter(e=>e.type==='plan');
  const visible=plans.filter(p=>p===d.latestPlan || d.runs.some(r=>r.data.planId===p.id));
  const schedules=visible.map(p=>{
    const row=el('div',null,'schedule'), run=d.runs.find(e=>e.data.planId===p.id);
    row.append(el('strong',planName(p)),el('small',channels[p.data.channel]+' · 계획 '+p.data.start+'–'+p.data.end+' · '+amount(p.data.budget,'원'),'dim'),track(p.data.start,p.data.end,'plan'));
    if (run) row.append(el('small','기록한 집행 '+run.data.start+'–'+run.data.end,'dim'),track(run.data.start,run.data.end,'run'));
    return row;
  });
  const axis=el('div',null,'axis'); for(const t of ['00시','06시','12시','18시','24시']) axis.append(el('span',t));
  nodeList('timeline',schedules.length?[axis,...schedules]:[],'아직 계획이 없습니다. 광고 메뉴에서 첫 계획을 저장하세요.');
  const decision=last(d.rows,'decision');
  const steps=[['광고 계획',d.latestPlan?planName(d.latestPlan):'작성 대기','ads'],['실제 집행',d.runs.length+'건','ads'],
    ['광고 실적',d.reports.filter(Boolean).length+' / '+d.runs.length+'건','ads'],['현장 마감',d.close?(d.teams!=null&&d.revenue!=null?'방문·매출 입력':'부분 입력'):'입력 대기','closing'],
    ['공동 판단',decision?choices[decision.data.choice]:'검토 대기','review']];
  $('checklist').replaceChildren(...steps.map(([title,status,tab])=>{
    const row=el('div',null,'row'),a=el('a',title);a.href='#'+tab;row.append(a,el('small',status));return row;
  }));
  nodeList('plans',plans.slice().reverse().map(p=>entry(planName(p),channels[p.data.channel]+' · '+p.data.start+'–'+p.data.end+' · '+amount(p.data.budget,'원'),info(p))),'저장된 계획이 없습니다.');
}
export function recommendation(facts) {
  const verdict=$('recommendation'); verdict.classList.toggle('hold',facts.suggested==='hold');
  verdict.replaceChildren(el('strong',choices[facts.suggested]),el('p',facts.description));
  if(facts.plan) verdict.append(el('small','집행 계획 v'+facts.plan.planRevision+' · '+facts.plan.data.creative,'dim'));
  const m=facts.metrics;
  const fields=[['클릭당 비용',amount(m.cpc,'원')],['클릭률',m.ctr==null?'미측정':m.ctr.toFixed(2)+'%'],
    ['방문 차이',amount(m.difference,'팀')],['손익분기',amount(m.breakEven,'팀')],['가정 기여액',amount(m.contribution,'원')]];
  $('evidence-metrics').replaceChildren(...fields.map(([label,v])=>{const n=el('span',label);n.append(el('b',v));return n;}));
}
export function collaborationHistory(rows) {
  nodeList('opinions',rows.filter(e=>e.type==='opinion').reverse().map(e=>entry(roles[e.role]+' 의견',e.data.note,info(e))),'남긴 의견이 없습니다.');
  nodeList('decisions',rows.filter(e=>e.type==='decision').reverse().map(e=>{
    const f=e.snapshot, approval=last(rows,'approval',a=>a.data.decisionId===e.id);
    const n=entry(choices[e.data.choice]+' · '+(approval?(approval.data.status==='approved'?'대표 승인':'대표 보류'):'승인 대기'),e.data.note,info(e));
    const detail=el('details');detail.append(el('summary','저장 당시 판단 근거'));
    detail.append(el('p',f.engineVersion+' · 당시 제안 '+choices[f.suggested]+' · '+f.description),
      el('p','비교일 '+f.compareDay+' · 가정 기여액 '+amount(f.metrics.contribution,'원')),
      el('p',f.plan?'계획 v'+f.plan.planRevision+' · '+f.plan.data.creative+' · 예산 '+amount(f.plan.data.budget,'원'):'집행 계획 미확인'));
    if(f.report) detail.append(el('p','실적 집계 '+f.report.data.from.replace('T',' ')+' ~ '+f.report.data.to.replace('T',' ')+' · '+amount(f.report.data.spend,'원')));
    if(approval) detail.append(el('p','대표 검토 · '+approval.data.note+' · '+info(approval)));
    n.append(detail);return n;
  }),'기록한 판단이 없습니다.');
}
export function records(events,day,period) {
  const r=rangeReport(events,day,period);
  $('range-title').textContent=r.start+' ~ '+r.end+' · 기록된 영업일 '+r.rows.length+'일 · 지표별 측정일 합계';
  const labels={teams:['방문 팀','팀'],revenue:['매출','원'],spend:['광고비','원'],minutes:['관리 시간','분']};
  cards('range-kpis',Object.entries(labels).map(([key,[name,unit]])=>[name,amount(r.totals[key].value,unit),'측정 '+r.totals[key].days+'일']));
  nodeList('range-days',r.rows.map(d=>{
    const row=el('div',null,'row'),b=el('button',d.day);b.type='button';b.dataset.openDay=d.day;
    row.append(b,el('small','방문 '+amount(d.teams,'팀')+' · 매출 '+amount(d.revenue,'원')));return row;
  }),'이 기간에 저장한 기록이 없습니다.');
  nodeList('events',daily(events,day).rows.slice().reverse().map(e=>{
    const d=e.data;
    const desc={plan:()=>planName(e),run:()=>runName(e),report:()=>channels[d.channel]+' · '+amount(d.spend,'원')+' · '+d.from+' ~ '+d.to,
      close:()=>'점심 '+amount(d.lunchTeams,'팀')+' / '+amount(d.lunchRevenue,'원')+' · 저녁 '+amount(d.dinnerTeams,'팀')+' / '+amount(d.dinnerRevenue,'원')+' · 관리 '+amount(d.minutes,'분'),
      decision:()=>choices[d.choice]+' · '+d.note,opinion:()=>d.note,approval:()=>(d.status==='approved'?'승인':'보류')+' · '+d.note};
    return entry(types[e.type]+' · 원장 '+e.version,desc[e.type](),info(e));
  }),'선택한 날짜의 원장이 비어 있습니다.');
}
