// Editor installation: initializePilot_(). Only the three public functions below are web entry points.
const PILOT_TAB_ = 'R05_FIELD_EVENTS';
const PILOT_HEADER_ = ['event_id','business_id','mode','business_day','day_version','event_type','actor_id','role','updated_at','data_json','evidence_json'];

function doGet() {
  return HtmlService.createHtmlOutputFromFile('Index').setTitle('마장동 · 운영 일지')
    .addMetaTag('viewport','width=device-width, initial-scale=1, viewport-fit=cover');
}
function props_() { return PropertiesService.getScriptProperties(); }
function actor_() {
  const email = String(Session.getActiveUser().getEmail() || '').trim().toLowerCase();
  if (!email) throw Error('[AUTH] 로그인한 운영 계정을 확인할 수 없습니다.');
  let members;
  try { members = JSON.parse(props_().getProperty('R05_MEMBERS_JSON') || '{}'); }
  catch (_) { throw Error('[CONFIG] 운영자 설정을 확인하세요.'); }
  if (!members || !Object.prototype.hasOwnProperty.call(members,email)) throw Error('[AUTH] 등록된 운영 계정이 필요합니다.');
  const m = members[email];
  if (!m || Object.keys(members).filter(k => members[k] && members[k].id === m.id).length !== 1) throw Error('[CONFIG] 운영자 ID 설정을 확인하세요.');
  const actor = {mode:'pilot',id:m.id,role:m.role,businessId:m.businessId};
  PilotCore.authorize(actor,'pilot','majang-sacheon');
  return actor;
}
function configuredBook_() {
  const sid = props_().getProperty('R05_SHEET_ID');
  if (!sid || props_().getProperty('R05_BOUND_SHEET_ID') !== sid) throw Error('[CONFIG] 신규 실증 원장을 초기화하세요.');
  return SpreadsheetApp.openById(sid);
}
function checkHeader_(sh) {
  if (!sh || sh.getLastColumn() !== PILOT_HEADER_.length ||
      JSON.stringify(sh.getRange(1,1,1,PILOT_HEADER_.length).getDisplayValues()[0]) !== JSON.stringify(PILOT_HEADER_)) {
    throw Error('[CONFIG] R0.5 원장 탭과 헤더를 확인하세요.');
  }
}
function initializePilot_() {
  const actor = actor_();
  if (actor.role !== 'owner') throw Error('[FORBIDDEN] 대표 역할로 초기화하세요.');
  const p=props_(), id=p.getProperty('R05_SHEET_ID'), bound=p.getProperty('R05_BOUND_SHEET_ID');
  if (!id || (bound && bound !== id)) throw Error('[CONFIG] 별도 신규 시트 ID를 확인하세요.');
  const lock=LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const book=SpreadsheetApp.openById(id);
    let sh=book.getSheetByName(PILOT_TAB_);
    if (bound) { checkHeader_(sh); return '기존 실증 원장 확인'; }
    if (book.getSheets().some(s=>s.getName()!==PILOT_TAB_ && s.getLastRow()>0) || (sh && sh.getLastRow()>1))
      throw Error('[CONFIG] 빈 신규 스프레드시트를 지정하세요.');
    if (!sh) sh=book.insertSheet(PILOT_TAB_);
    if (sh.getLastRow()===0) sh.getRange(1,1,1,PILOT_HEADER_.length).setValues([PILOT_HEADER_]);
    checkHeader_(sh);
    sh.setFrozenRows(1);
    SpreadsheetApp.flush();
    p.setProperty('R05_BOUND_SHEET_ID',id);
    return 'R0.5 원장 초기화 완료';
  } finally { lock.releaseLock(); }
}
function rows_(sheet) {
  checkHeader_(sheet);
  const count=sheet.getLastRow()-1;
  if (!count) return [];
  if (count>10000) throw Error('[LIMIT] 원장 10,000건을 초과했습니다.');
  const ids=new Set(), versions={};
  const events=sheet.getRange(2,1,count,PILOT_HEADER_.length).getDisplayValues().map(r=>{
    const [id,businessId,mode,day,version,type,actorId,role,updatedAt,data,snapshot]=r;
    const expected=(versions[day] || 0)+1;
    if (!PilotCore.validDay(day) || !id || ids.has(id) || businessId!=='majang-sacheon' || mode!=='pilot' ||
        Number(version)!==expected || !Object.prototype.hasOwnProperty.call(PilotCore.fields,type) || !actorId ||
        !['owner','mashcore'].includes(role) || !Number.isFinite(Date.parse(updatedAt))) throw Error('[CORRUPT] 원장 행을 확인하세요.');
    ids.add(id); versions[day]=expected;
    try {
      const payload=JSON.parse(data), facts=JSON.parse(snapshot);
      if (!payload || typeof payload!=='object' || (type==='decision' && (!facts || !facts.engineVersion || !facts.suggested))) throw Error();
      return {id,businessId,mode,day,version:expected,type,actorId,role,updatedAt,data:payload,snapshot:facts};
    } catch (_) { throw Error('[CORRUPT] 원장 기록을 해석할 수 없습니다.'); }
  });
  PilotCore.verifyJournal(events,'pilot','majang-sacheon');
  return events;
}
function mode_() {
  const mode=props_().getProperty('R05_MODE') || 'demo';
  if (!['demo','pilot'].includes(mode)) throw Error('[CONFIG] R05_MODE 값을 확인하세요.');
  return mode;
}
function response_(actor, events, acceptedId) {
  return {ok:true,mode:'pilot',businessId:actor.businessId,actor,events,acceptedId:acceptedId || null,syncedAt:new Date().toISOString()};
}
function safeRpc_(fn) {
  try { return fn(); }
  catch(e) {
    if (/^\[(AUTH|CONFIG|FORBIDDEN|INVALID|CONFLICT|ID_CONFLICT|UNCHANGED|CORRUPT|LIMIT)\]/.test(e.message)) throw e;
    throw Error('[STORE] 원장 응답을 확인할 수 없습니다. 같은 요청으로 다시 시도하세요.');
  }
}
function loadPilot(businessId) {
  return safeRpc_(()=>{
    if (mode_()==='demo') return {ok:true,mode:'demo'};
    const actor=actor_();
    PilotCore.authorize(actor,'pilot',businessId);
    const sheet=configuredBook_().getSheetByName(PILOT_TAB_);
    return response_(actor,rows_(sheet));
  });
}
function savePilot(command) {
  return safeRpc_(()=>{
    if (mode_()!=='pilot') throw Error('[CONFIG] 실증 원장이 활성화되지 않았습니다.');
    const actor=actor_();
    PilotCore.authorize(actor,command && command.mode,command && command.businessId);
    const lock=LockService.getScriptLock();
    lock.waitLock(10000);
    try {
      const sheet=configuredBook_().getSheetByName(PILOT_TAB_), events=rows_(sheet);
      const prepared=PilotCore.prepare(events,command,actor,new Date().toISOString()), e=prepared.event;
      if (!prepared.replay) {
        if (events.length>=10000) throw Error('[LIMIT] 실증 원장 용량을 확인하세요.');
        const row=sheet.getLastRow()+1;
        if (row>sheet.getMaxRows()) sheet.insertRowsAfter(sheet.getMaxRows(),100);
        const cells=[e.id,e.businessId,e.mode,e.day,String(e.version),e.type,e.actorId,e.role,e.updatedAt,JSON.stringify(e.data),JSON.stringify(e.snapshot)];
        const range=sheet.getRange(row,1,1,cells.length);
        range.setNumberFormat('@').setValues([cells]);
        SpreadsheetApp.flush();
        if (JSON.stringify(range.getDisplayValues()[0])!==JSON.stringify(cells)) throw Error('write verification');
        events.push(e);
      }
      return response_(actor,events,e.id);
    } finally { lock.releaseLock(); }
  });
}
