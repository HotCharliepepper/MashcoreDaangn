import { channels, choices, closeFields, roles, seoulDay, shiftDay, types } from './config.mjs';
import { byDay, daily, evidence, last, nextMidnight } from './flow.mjs';
import { authorize, prepare, validDay } from './ledger.mjs';
import { acknowledge, connect } from './connection.mjs';
import { $, collaborationHistory, dashboard, fill, options, planName, readForm, recommendation, records, runName, stamp } from './view.mjs';

const forms=['plan','run','report','close','decision','opinion','approval'];
const tabs=['today','ads','closing','review','records'];
let day=seoulDay(), actor=null, events=[], gateway=null, busy=false, pending=null, conflict=null;
let tab='today';
const drafts=new Map(), targets=new Map();
const scope=()=>[actor?.mode,actor?.id,day].join('/');
const targetKey=(type)=>scope()+'/'+type;
const formKey=type=>targetKey(type)+(type==='report'?'/'+($(type).elements.runId.value || ''):'');
function context(type) { return drafts.get(formKey(type)); }
function alertText(t) { $('problem').textContent=t; $('problem').hidden=!t; }
function message(t) { $('feedback').textContent=t; }
function current() { return daily(events,day); }
function changeTab(focus=false) {
  const requested=location.hash.slice(1);
  tab=tabs.includes(requested)?requested:'today';
  for (const id of tabs) {
    $('page-'+id).hidden=id!==tab;
    const link=document.querySelector('[data-tab="'+id+'"]');
    if(id===tab) link.setAttribute('aria-current','page');else link.removeAttribute('aria-current');
  }
  if (focus) $('title-'+tab).focus();
}
function selectTarget(type,field,items,empty) {
  const select=$(type).elements[field];
  const wanted=targets.get(targetKey(type)) ?? items[0]?.[0];
  options(select,items,wanted,empty);
  targets.set(targetKey(type),select.value);
  return select.value;
}
function redrawDecision() {
  const f=$('decision'), draft=context('decision'), values=readForm(f);
  const selection={runId:values.runId || null,compareDay:values.compareDay,comparable:values.comparable};
  const facts=evidence(events,day,selection);
  const selected=facts.suggested==='hold' ? 'hold' : draft?.manualChoice ?? facts.suggested;
  options(f.elements.choice,Object.entries(choices),selected);
  for(const option of f.elements.choice.options) option.disabled=facts.suggested==='hold' && option.value!=='hold';
  f.elements.choice.value=selected;
  if(draft) draft.values.choice=selected;
  recommendation(facts);
}
function paint() {
  if (!actor) return;
  const d=current(), plans=d.rows.filter(e=>e.type==='plan').reverse();
  const defaults=d.latestPlan?.data ?? {channel:'daangn',creative:'',hypothesis:'',start:'15:00',end:'18:00',budget:null};
  fill($('plan'),context('plan')?.values ?? defaults);
  const unused=plans.filter(p=>!d.runs.some(r=>r.data.planId===p.id));
  selectTarget('run','planId',unused.map(e=>[e.id,planName(e)]),'새 계획 버전 필요');
  const runDraft=context('run')?.values;
  fill($('run'),runDraft && unused.some(p=>p.id===runDraft.planId)?runDraft:{start:'',end:''});
  const matches=d.runs.slice().reverse().map(e=>[e.id,runName(e)]);
  const runId=selectTarget('report','runId',matches,'집행 기록 필요');
  const linked=d.runs.find(e=>e.id===runId);
  const reported=last(d.rows,'report',e=>e.data.runId===runId);
  const planned=plans.find(p=>p.id===linked?.data.planId);
  fill($('report'),context('report')?.values ?? reported?.data ?? {channel:planned?.data.channel ?? 'daangn',from:day+'T00:00',to:nextMidnight(day),spend:null,impressions:null,clicks:null});
  fill($('close'),context('close')?.values ?? d.close?.data ?? Object.fromEntries(closeFields.map(k=>[k,null])));
  const decisionDraft=context('decision')?.values;
  options($('decision').elements.runId,matches,decisionDraft?.runId ?? matches[0]?.[0],'집행 기록 없음');
  fill($('decision'),decisionDraft ?? {compareDay:shiftDay(day,-7),comparable:false,note:''});
  $('decision').elements.compareDay.max=shiftDay(day,-1);
  redrawDecision();
  fill($('opinion'),context('opinion')?.values ?? {note:''});
  const open=d.rows.filter(e=>e.type==='decision'&&!d.rows.some(a=>a.type==='approval'&&a.data.decisionId===e.id)).reverse();
  selectTarget('approval','decisionId',open.map(e=>[e.id, choices[e.data.choice]+' · '+e.data.note]),'승인 대기 판단 없음');
  const approval=context('approval')?.values;
  fill($('approval'),approval && open.some(e=>e.id===approval.decisionId)?approval:{status:'approved',note:''});
  $('approval').hidden=actor.role!=='owner' || !open.length;
  $('approval-hint').textContent=!open.length?'승인 대기 중인 판단이 없습니다.':actor.role!=='owner'?'대표 계정에서 승인 또는 보류할 수 있습니다.':'';
  dashboard(d);collaborationHistory(d.rows);records(events,day,$('period').value);
  controls();
}
function controls() {
  for (const type of forms) {
    const form=$(type), needsTarget=(type==='run'&&!form.elements.planId.value)||(type==='report'&&!form.elements.runId.value);
    for (const control of form.elements) {
      control.disabled=!actor || busy || !!pending || (type==='approval' && actor.role!=='owner') ||
        (control.tagName==='BUTTON' && needsTarget);
    }
  }
  $('sync').disabled=busy; $('demo-role').disabled=busy||!!pending;
  for(const id of ['day','prev','next-day','today']) $(id).disabled=busy;
  $('retry').hidden=!pending || busy; $('resolve').hidden=!conflict || busy || !!pending;
}
function draftFor(type, changed='') {
  const key=formKey(type), prior=drafts.get(key);
  const values=readForm($(type));
  const base=type==='decision'?last(byDay(events,values.compareDay),'close')?.id ?? null:null;
  const baselineId=prior && prior.values.compareDay===values.compareDay ? prior.baselineId : base;
  const manualChoice=changed==='choice'?values.choice:prior?.manualChoice;
  const draft={values, expected:prior?.expected ?? current().rows.length, baselineId, manualChoice};
  drafts.set(key,draft);return draft;
}
function selectDay(value) {
  if (!validDay(value)) { $('day').value=day;return; }
  day=value;$('day').value=day;paint();message('');
}
function pendingKey(){ return 'mashcore.r05.pending.'+actor.mode+'.'+actor.businessId+'.'+actor.id; }
function remember(value) {
  pending=value;
  try { if(value) sessionStorage.setItem(pendingKey(),JSON.stringify(value));else sessionStorage.removeItem(pendingKey()); } catch { /* The open tab can still retry. */ }
}
function accept(reply, request=null) {
  acknowledge(reply,actor,request);
  events=reply.events;
  $('synced').textContent=(actor.mode==='demo'?'데모 확인 ':'마지막 동기화 ')+stamp(reply.syncedAt);
  $('mode').textContent=actor.mode==='demo'?'데모 · 가상 원장':'실증 · Sheets';
  $('account').textContent=roles[actor.role]+' · '+actor.id;
  $('demo-role-label').hidden=actor.mode!=='demo';
  $('demo-role').value=actor.role;
}
function setBusy(value) {busy=value;controls();}
function closeSession() {
  actor=null;gateway=null;events=[];pending=null;conflict=null;
  drafts.clear();targets.clear();
  for(const id of tabs) $('page-'+id).hidden=true;
  $('account').textContent='';$('demo-role-label').hidden=true;$('mode').textContent='연결 제한';
  $('synced').textContent='동기화 대기';
}
async function sync(initial=false) {
  if(busy) return false;
  setBusy(true);alertText('');message('원장을 읽는 중…');
  try {
    if (initial || !gateway) {
      const c=await connect($('demo-role').value);
      const a=c.initial?.actor;
      authorize(a,c.initial?.mode,c.initial?.businessId);
      acknowledge(c.initial,a);
      actor=a;gateway=c.gateway;
      try {pending=JSON.parse(sessionStorage.getItem(pendingKey()) || 'null');} catch {pending=null;}
      conflict=null;
      accept(c.initial);
    } else accept(await gateway.load());
    if(pending && events.some(e=>e.id===pending.id && e.actorId===actor.id)) {
      if (!prepare(events,pending,actor,new Date().toISOString()).replay) throw Error('[STORE] 저장 요청을 대조할 수 없습니다.');
      drafts.delete([actor.mode,actor.id,pending.day,pending.type].join('/')+(pending.type==='report'?'/'+pending.data.runId:''));
      remember(null);message('원장에서 저장 완료를 확인했습니다.');
    } else message(pending?'확인 대기 중인 저장 요청이 있습니다. 같은 요청으로 재시도하세요.':'');
    paint();return true;
  } catch(error) {
    if(initial || /\[(AUTH|FORBIDDEN|CONFIG)\]/.test(error.message)) closeSession();
    alertText(error.message);message('동기화 실패');return false;
  } finally {setBusy(false);if(actor)changeTab();}
}
async function send(cmd,key) {
  if(busy || !actor) return;
  setBusy(true);remember(cmd);alertText('');message('저장 확인 중…');
  try {
    const reply=await gateway.save(cmd);
    accept(reply,cmd);remember(null);conflict=null;drafts.delete(key);
    // Rebase independent drafts after our own acknowledged append. Evidence changes
    // still require a review of a previously drafted decision.
    const prefix=[actor.mode,actor.id,cmd.day].join('/')+'/';
    for (const [k,d] of drafts) if(k.startsWith(prefix) && d.expected===cmd.expected &&
        !(k===prefix+'decision' && ['run','report','close'].includes(cmd.type))) d.expected++;
    paint();message(types[cmd.type]+' 저장 완료 · '+(actor.mode==='demo'?'이 브라우저':'실증 원장'));
  } catch(error) {
    const definitive=/\[(AUTH|FORBIDDEN|INVALID|CONFLICT|ID_CONFLICT|UNCHANGED|CONFIG|CORRUPT|LIMIT)\]/.test(error.message);
    if(definitive) remember(null);
    if(error.message.includes('[CONFLICT]')) conflict=key;
    if(error.message.includes('[UNCHANGED]')) drafts.delete(key);
    if(/\[(AUTH|CONFIG)\]/.test(error.message)) closeSession();
    alertText(error.message);message(definitive?'저장 상태를 확인하세요.':'저장 확인 대기 · 재시도는 같은 ID를 사용합니다.');
  } finally {setBusy(false);}
}
async function submit(type) {
  if (busy || pending || !actor) return;
  const key=formKey(type), draft=context(type) ?? draftFor(type), data={...draft.values};
  if(type==='decision') {data.runId=data.runId || null;data.baselineId=draft.baselineId;}
  const cmd={id:crypto.randomUUID(),businessId:actor.businessId,mode:actor.mode,day,expected:draft.expected,type,data};
  try {prepare(events,cmd,actor,new Date().toISOString());}
  catch(e) {
    if(e.message.includes('[CONFLICT]')) conflict=key;
    if(e.message.includes('[UNCHANGED]')) drafts.delete(key);
    alertText(e.message);message('');controls();return;
  }
  await send(cmd,key);
}

for (const f of [ $('plan'), $('report') ]) options(f.elements.channel,Object.entries(channels),'daangn');
$('day').value=day;
for (const type of forms) {
  const form=$(type);
  function edited(event) {
    if(!actor || busy) return;
    if(type==='report' && event.target.name==='runId') {
      targets.set(targetKey(type),event.target.value);paint();return;
    }
    if(type==='decision' && ['runId','compareDay'].includes(event.target.name)) form.elements.comparable.checked=false;
    draftFor(type,event.target.name);
    if(type==='decision') redrawDecision();
  }
  form.addEventListener('input',edited);
  form.addEventListener('change',edited);
  form.addEventListener('submit',e=>{e.preventDefault();submit(type);});
}
$('day').addEventListener('change',e=>selectDay(e.target.value));
$('prev').onclick=()=>selectDay(shiftDay(day,-1));$('next-day').onclick=()=>selectDay(shiftDay(day,1));
$('today').onclick=()=>selectDay(seoulDay());
$('period').onchange=()=>{if(actor)records(events,day,$('period').value);};
$('range-days').onclick=e=>{const b=e.target.closest('[data-open-day]');if(b&&!busy){selectDay(b.dataset.openDay);location.hash='today';}};
$('sync').onclick=()=>sync(!actor);
$('retry').onclick=()=>{if(pending)send(pending,[actor.mode,actor.id,pending.day,pending.type].join('/')+(pending.type==='report'?'/'+pending.data.runId:''));};
$('resolve').onclick=async()=>{const key=conflict;if(await sync()){drafts.delete(key);conflict=null;paint();message('충돌 입력을 비웠습니다. 최신 기록을 확인하세요.');}};
$('demo-role').onchange=()=>sync(true);
window.addEventListener('hashchange',()=>{if(actor)changeTab(true);});
window.addEventListener('beforeunload',e=>{if(drafts.size||pending){e.preventDefault();e.returnValue=true;}});
document.addEventListener('visibilitychange',()=>{if(!document.hidden && actor && !busy && !pending && !drafts.size) sync();});
changeTab();sync(true);
