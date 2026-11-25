import { channels, choices, closeFields, roles, site, types } from './config.mjs';
import { byDay, evidence, last } from './flow.mjs';

export function fail(code, message) {
  throw new Error('[' + code + '] ' + message);
}
function check(ok, message) { if (!ok) fail('INVALID', message); }
export function validDay(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(value + 'T00:00:00Z');
  return Number.isFinite(d.getTime()) && d.toISOString().slice(0,10) === value;
}
function key(value) { return typeof value === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/.test(value); }
function known(table,value) { return typeof value==='string' && Object.hasOwn(table,value); }
function shape(obj, keys) {
  check(obj && typeof obj === 'object' && !Array.isArray(obj) &&
    Object.keys(obj).length === keys.length && keys.every(k => Object.hasOwn(obj,k)), '요청 항목과 형식을 확인하세요.');
}
function number(value, max, decimal = false) {
  check(value === null || (Number.isFinite(value) && value >= 0 && value <= max &&
    Number.isInteger(decimal ? value * 10 : value)), '숫자 범위를 확인하세요. 미측정은 빈칸으로 둡니다.');
}
function textValue(value, limit) { check(typeof value === 'string' && value.trim() && value.length <= limit, '필수 문구와 글자 수를 확인하세요.'); }
function time(value) { return typeof value === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(value); }
function windowTimes(d) { check(time(d.start) && (time(d.end) || d.end === '24:00') && d.start < d.end, '종료 시각을 시작 이후로 입력하세요.'); }
function dateTime(v) { return typeof v === 'string' && v.length === 16 && v[10] === 'T' && validDay(v.slice(0,10)) && time(v.slice(11)); }
function same(a,b) {
  if (a === b) return true;
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return false;
  const keys = Object.keys(a);
  return keys.length === Object.keys(b).length && keys.every(k => Object.hasOwn(b,k) && same(a[k],b[k]));
}
export function authorize(actor, mode, businessId) {
  if (!actor || !key(actor.id) || !known(roles,actor.role) || !['demo','pilot'].includes(mode) ||
      actor.mode !== mode || actor.businessId !== businessId || site[mode] !== businessId) {
    fail('AUTH','승인된 사용자와 사업장을 확인하세요.');
  }
}
export const fields = {
  plan: ['channel','creative','hypothesis','start','end','budget'],
  run: ['planId','start','end'],
  report: ['runId','channel','from','to','spend','impressions','clicks'],
  close: closeFields,
  opinion: ['note'],
  decision: ['runId','compareDay','baselineId','comparable','choice','note'],
  approval: ['decisionId','status','note'],
};
// Validate the stored envelope and links without recomputing historical decisions.
export function verifyJournal(events, mode, businessId) {
  const seen=new Map(), versions=new Map(), planRevisions=new Map(), closes=new Map(), reports=new Map();
  const bad=()=>fail('CORRUPT','원장 행 또는 연결된 기록이 누락됐습니다. 저장소를 확인하세요.');
  if (!Array.isArray(events)) bad();
  for (const e of events) {
    if (!e || !key(e.id) || seen.has(e.id) || e.businessId!==businessId || e.mode!==mode || !validDay(e.day) ||
        !key(e.actorId) || !known(roles,e.role) || !Number.isFinite(Date.parse(e.updatedAt)) ||
        e.version!==(versions.get(e.day) || 0)+1 || !known(fields,e.type)) bad();
    try { validateData(e.type,e.data,e.day); } catch { bad(); }
    const s=e.snapshot;
    if (e.type==='plan') {
      if (s?.planRevision !== (planRevisions.get(e.day) || 0)+1) bad();
      planRevisions.set(e.day,s.planRevision);
    }
    if (e.type==='run' || e.type==='report' || e.type==='approval') {
      const [id,type]=e.type==='run'?[e.data.planId,'plan']:e.type==='report'?[e.data.runId,'run']:[e.data.decisionId,'decision'];
      const parent=seen.get(id);
      if(parent?.type!==type || parent.day!==e.day) bad();
      if(e.type==='approval' && e.role!=='owner') bad();
      if(e.type!=='approval' && (s?.planRevision!==parent.snapshot.planRevision || s?.planId!==(type==='plan'?parent.id:parent.data.planId))) bad();
    }
    if (e.type==='close') closes.set(e.day,e);
    if (e.type==='report') reports.set(e.data.runId,e);
    if (e.type==='decision') {
      const d=e.data, run=seen.get(d.runId), baseline=closes.get(d.compareDay);
      if (!s?.engineVersion || !known(choices,s.suggested) || !s.metrics || typeof s.description!=='string' ||
          s.day!==e.day || s.compareDay!==d.compareDay || s.comparable!==d.comparable ||
          (baseline?.id ?? null)!==d.baselineId || (d.runId!==null && (run?.type!=='run' || run.day!==e.day))) bad();
      for (const metric of ['cpc','ctr','difference','contribution','breakEven']) {
        if (s.metrics[metric]!==null && !Number.isFinite(s.metrics[metric])) bad();
      }
      const sources={plan:seen.get(run?.data.planId),run,report:reports.get(d.runId),close:closes.get(e.day),baseline};
      for (const [field,source] of Object.entries(sources)) {
        const saved=s[field];
        if (!source) { if(saved!==null) bad(); continue; }
        if (saved?.id!==source.id || saved.version!==source.version || saved.at!==source.updatedAt ||
            saved.planRevision!==(source.snapshot?.planRevision ?? null) || !same(saved.data,source.data)) bad();
      }
    }
    seen.set(e.id,e);versions.set(e.day,e.version);
  }
}
function target(rows,id,type) {
  const e = rows.find(row => row.id === id && row.type === type);
  check(e, '같은 영업일의 대상 기록을 선택하세요.');
  return e;
}

function validateData(type,d,day) {
  shape(d, fields[type]);
  switch (type) {
    case 'plan':
      check(known(channels,d.channel),'계획 채널을 선택하세요.');
      textValue(d.creative,100); textValue(d.hypothesis,300); windowTimes(d);
      number(d.budget,10000000); check(d.budget !== null,'계획 예산을 입력하세요.');
      break;
    case 'run':
      check(key(d.planId),'집행 당시 계획을 선택하세요.'); windowTimes(d);
      break;
    case 'report':
      check(key(d.runId) && known(channels,d.channel),'집행과 성과 원천 채널을 선택하세요.');
      check(dateTime(d.from) && dateTime(d.to) && d.from < d.to, '광고 실적 집계 시작과 종료를 확인하세요.');
      for (const k of ['spend','impressions','clicks']) number(d[k],100000000);
      check([d.spend,d.impressions,d.clicks].some(v=>v!==null),'실측한 광고 수치를 하나 이상 입력하세요.');
      check(d.clicks === null || d.impressions === null || d.clicks <= d.impressions,'클릭 수는 노출 수 이하여야 합니다.');
      break;
    case 'close':
      for (const k of closeFields) {
        const max = {lunchTeams:100000,dinnerTeams:100000,minutes:1440,margin:100}[k] ?? 100000000;
        number(d[k],max,k === 'margin');
      }
      check(closeFields.some(k=>d[k]!==null),'실측한 마감 항목을 하나 이상 입력하세요.');
      for (const meal of ['lunch','dinner']) check(d[meal+'Teams'] !== 0 || !(d[meal+'Revenue'] > 0),'방문 0팀인 구간의 매출을 확인하세요.');
      break;
    case 'opinion': textValue(d.note,500); break;
    case 'decision':
      check((d.runId===null || key(d.runId)) && (d.baselineId===null || key(d.baselineId)) && known(choices,d.choice),'검토할 집행·비교 마감·판단을 확인하세요.');
      check(validDay(d.compareDay) && d.compareDay<day && typeof d.comparable==='boolean','앞선 비교일과 영업 조건을 확인하세요.');
      textValue(d.note,500);
      break;
    case 'approval':
      check(key(d.decisionId) && ['approved','deferred'].includes(d.status),'판단과 승인 상태를 선택하세요.');
      textValue(d.note,300);
      break;
  }
}

// The host serializes calls and appends exactly one returned event before acknowledging.
export function prepare(events, cmd, actor, updatedAt) {
  shape(cmd, ['id','businessId','mode','day','expected','type','data']);
  authorize(actor, cmd.mode, cmd.businessId);
  check(key(cmd.id) && validDay(cmd.day) && Number.isSafeInteger(cmd.expected) && cmd.expected >= 0, '저장 ID·영업일·버전을 확인하세요.');
  check(known(types,cmd.type), '기록 종류를 확인하세요.');
  if (cmd.type === 'approval' && actor.role !== 'owner') fail('FORBIDDEN','대표만 승인 또는 보류할 수 있습니다.');
  const d=cmd.data;
  const existing=events.find(e => e.id === cmd.id);
  if (existing) {
    if (existing.actorId !== actor.id || existing.mode !== cmd.mode || existing.businessId !== cmd.businessId ||
      existing.day !== cmd.day || existing.type !== cmd.type || existing.version !== cmd.expected+1 || !same(existing.data,d)) {
      fail('ID_CONFLICT','다른 요청에 사용된 저장 ID입니다.');
    }
    return {event:existing,replay:true};
  }
  validateData(cmd.type,d,cmd.day);
  const scoped=events.filter(e=>e.mode===actor.mode && e.businessId===actor.businessId);
  const rows=byDay(scoped,cmd.day);
  if (cmd.expected!==rows.length) fail('CONFLICT','다른 저장이 먼저 반영됐습니다. 동기화 후 입력값을 확인하세요.');
  let snapshot=null, previous=null;
  switch (cmd.type) {
    case 'plan':
      previous=last(rows,'plan');
      snapshot={planRevision:rows.filter(e=>e.type==='plan').length+1};
      break;
    case 'run': {
      const plan=target(rows,d.planId,'plan');
      check(!rows.some(e=>e.type==='run' && e.data.planId===d.planId),'이 계획 버전의 집행은 이미 기록됐습니다.');
      snapshot={planId:plan.id,planRevision:plan.snapshot.planRevision};
      break;
    }
    case 'report': {
      const run=target(rows,d.runId,'run');
      check(d.from<cmd.day+'T'+run.data.end && d.to>cmd.day+'T'+run.data.start,'집계 기간과 실제 집행 시간이 겹쳐야 합니다.');
      snapshot={planId:run.data.planId,planRevision:run.snapshot.planRevision};
      previous=last(rows,'report',e=>e.data.runId===d.runId);
      break;
    }
    case 'close': previous=last(rows,'close'); break;
    case 'opinion': previous=last(rows,'opinion',e=>e.actorId===actor.id); break;
    case 'decision': {
      if (d.runId!==null) target(rows,d.runId,'run');
      snapshot=evidence(scoped,cmd.day,d);
      if ((snapshot.baseline?.id ?? null)!==d.baselineId) fail('CONFLICT','비교일 마감이 변경됐습니다. 동기화 후 다시 검토하세요.');
      check(snapshot.suggested!=='hold' || d.choice==='hold','근거가 부족해 판단 유보만 기록할 수 있습니다.');
      const prior=last(rows,'decision',e=>e.actorId===actor.id);
      if(prior && same(prior.snapshot,snapshot)) previous=prior;
      break;
    }
    case 'approval':
      target(rows,d.decisionId,'decision');
      check(!last(rows,'approval',e=>e.data.decisionId===d.decisionId),'이미 대표 검토가 끝난 판단입니다.');
      break;
  }
  if (previous && same(previous.data,d)) fail('UNCHANGED','이미 같은 내용이 기록되어 있습니다.');
  return {replay:false, event:{ id:cmd.id, businessId:actor.businessId, mode:actor.mode, day:cmd.day,
    version:rows.length+1, type:cmd.type, data:{...d}, actorId:actor.id, role:actor.role, updatedAt, snapshot }};
}
