/** ARVO & MAJANG CONNECT R0.2 — internal Sheets pilot.
 * New project only. Do not paste over Seolmajung or existing production code.
 * Deploy as user accessing, signed-in users only. Public QR must be separate.
 * Script properties: CONNECT_SHEET_ID, CONNECT_MEMBERS_JSON.
 */
const CONNECT_TZ = 'Asia/Seoul';
const CONNECT_TAB = 'CONNECT_EVENTS';
const CONNECT_HEADERS = ['event_id','unit','business_date','type','payload_json','actor_email','recorded_at'];
const CONNECT_ROLES = ['owner','strategist','staff'];
const CONNECT_UNITS = ['hotel','restaurant'];
function doGet() {
  try { member_(); } catch(e) { return HtmlService.createHtmlOutput('<h2>접근 제한</h2><p>승인된 Google 계정으로 접속해 주세요. 설정 담당자에게 문의하세요.</p>').setTitle('CONNECT · 접근 제한'); }
  return HtmlService.createHtmlOutputFromFile('Index').setTitle('ARVO & MAJANG — CONNECT').addMetaTag('viewport','width=device-width, initial-scale=1');
}
function member_() {
  const email = String(Session.getActiveUser().getEmail() || '').trim().toLowerCase();
  let members;
  try { members = JSON.parse(PropertiesService.getScriptProperties().getProperty('CONNECT_MEMBERS_JSON') || '{}'); } catch(e) { throw Error('멤버 설정을 확인하세요.'); }
  if (!email || !Object.prototype.hasOwnProperty.call(members,email)) throw Error('승인된 Google 계정이 필요합니다.');
  const m = members[email];
  if (!m || !CONNECT_ROLES.includes(m.role) || !Array.isArray(m.units) || !m.units.length || m.units.some(x=>!CONNECT_UNITS.includes(x))) throw Error('멤버 역할·업장 설정 오류');
  return { email:email, role:m.role, units:Array.from(new Set(m.units)) };
}
function openSheet_() {
  const sid = PropertiesService.getScriptProperties().getProperty('CONNECT_SHEET_ID');
  if (!sid) throw Error('CONNECT_SHEET_ID 설정이 필요합니다.');
  return SpreadsheetApp.openById(sid);
}
function eventSheet_() {
  const sh = openSheet_().getSheetByName(CONNECT_TAB);
  if (!sh || sh.getLastColumn() !== CONNECT_HEADERS.length || JSON.stringify(sh.getRange(1,1,1,CONNECT_HEADERS.length).getDisplayValues()[0]) !== JSON.stringify(CONNECT_HEADERS)) throw Error('원장 초기화 또는 헤더 확인이 필요합니다.');
  return sh;
}
/** Run from the editor, after configuring properties. Creates a new tab only. */
function initializeWorkspace_() {
  const m=member_(); if(m.role!=='owner')throw Error('owner만 초기화할 수 있습니다.');
  const lock=LockService.getScriptLock();lock.waitLock(10000);
  try{
    const ss=openSheet_();let sh=ss.getSheetByName(CONNECT_TAB);
    if(sh){eventSheet_();return '기존 CONNECT_EVENTS 보존';}
    sh=ss.insertSheet(CONNECT_TAB);sh.getRange(1,1,1,CONNECT_HEADERS.length).setValues([CONNECT_HEADERS]).setFontWeight('bold').setBackground('#28352b').setFontColor('#ffffff');sh.setFrozenRows(1);sh.setColumnWidth(1,230);sh.setColumnWidth(5,450);sh.getRange('C:C').setNumberFormat('@');sh.getRange('G:G').setNumberFormat('@');SpreadsheetApp.flush();return '원장 생성 완료';
  }finally{lock.releaseLock();}
}
function readRows_(sh) {
  const n=sh.getLastRow()-1;if(n<=0)return [];
  // Fail explicitly rather than silently return a truncated history.
  if(n>10000)throw Error('원장 규모가 파일럿 범위(10,000 이벤트)를 초과했습니다. 기간별 조회 구조가 필요합니다.');
  return sh.getRange(2,1,n,CONNECT_HEADERS.length).getValues().map(r=>({id:String(r[0]),unit:String(r[1]),date:r[2] instanceof Date?Utilities.formatDate(r[2],CONNECT_TZ,'yyyy-MM-dd'):String(r[2]),type:String(r[3]),payload:JSON.parse(String(r[4])),actor:String(r[5]),at:r[6] instanceof Date?r[6].toISOString():String(r[6])}));
}
function viewRecord_(r,m) {
  if(!m.units.includes(r.unit))return null;
  if(m.role!=='staff')return r;
  if(['ad_stat','sales'].includes(r.type))return null;
  const p=Object.assign({},r.payload);delete p.budget;delete p.cost;delete p.amount;
  return Object.assign({},r,{payload:p});
}
function getWorkspace() {
  const m=member_();const rows=readRows_(eventSheet_());
  return {ok:true,session:{role:m.role,units:m.units},records:rows.map(r=>viewRecord_(r,m)).filter(Boolean),asOf:Utilities.formatDate(new Date(),CONNECT_TZ,'yyyy-MM-dd HH:mm:ss')};
}
function string_(x,max,required) {if(typeof x!=='string')throw Error('문자열 입력이 필요합니다.');const s=x.trim();if((required&&!s)||s.length>max)throw Error('문자열 길이를 확인하세요.');return s;}
function number_(x,max,integer) {if(typeof x!=='number'||!Number.isFinite(x)||x<0||x>max||(integer&&!Number.isInteger(x)))throw Error('숫자 범위를 확인하세요.');return x;}
function enum_(v,opts){if(!opts.includes(v))throw Error('허용되지 않은 값입니다.');return v;}
function time_(t){if(typeof t!=='string'||!/^([01]\d|2[0-3]):[0-5]\d$/.test(t))throw Error('시간 형식을 확인하세요.');return t;}
function date_(d){if(typeof d!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(d))throw Error('날짜 형식을 확인하세요.');let t=new Date(d+'T00:00:00Z');if(!Number.isFinite(t.getTime())||t.toISOString().slice(0,10)!==d)throw Error('유효하지 않은 날짜입니다.');return d;}
function key_(v){if(typeof v!=='string'||!/^[A-Za-z0-9_-]{1,80}$/.test(v))throw Error('ID 형식을 확인하세요.');return v;}
function validate_(x,m,rows){
  if(!x||typeof x!=='object'||Array.isArray(x)||!m.units.includes(x.unit))throw Error('업장 접근 권한이 없습니다.');
  const e={id:key_(x.id),unit:x.unit,date:date_(x.date),type:enum_(x.type,['operation','ad_plan','ad_stat','feedback','service','sales','decision','reply','decision_state']),payload:{},actor:m.email,at:new Date().toISOString()};
  const p=x.payload;if(!p||typeof p!=='object'||Array.isArray(p))throw Error('입력 항목 확인 필요');
  const scoped=rows.filter(r=>r.unit===e.unit&&r.date===e.date);const strat=m.role==='owner'||m.role==='strategist';
  const n=(v,max=100000000)=>number_(v,max,true);const s=(v,max=120,required=true)=>string_(v,max,required);const ch=v=>enum_(v,['daangn','naver','google','other']);
  const f=(v,opts)=>enum_(v,['',...opts]);
  switch(e.type){
    case 'operation':{
      const k=key_(p.key),st=enum_(p.status,['대기','완료']);let prev=scoped.filter(r=>r.type==='operation'&&r.payload.key===k).pop();
      if(st==='완료'&&(!prev||prev.payload.status!=='대기'))throw Error('이미 완료되었거나 대상이 없습니다. 새로고침 후 확인하세요.');
      if(st==='대기'&&prev)throw Error('이미 등록된 점검입니다.');
      e.payload=st==='완료'?Object.assign({},prev.payload,{status:'완료'}):{key:k,time:time_(p.time),title:s(p.title,100),status:st};break;}
    case 'ad_plan':if(!strat)throw Error('광고 계획 수정 권한이 없습니다.');e.payload={channel:ch(p.channel),campaign:key_(p.campaign),title:s(p.title),start:time_(p.start),end:time_(p.end),budget:n(p.budget),hypothesis:s(p.hypothesis,300,false)};if(e.payload.start>=e.payload.end)throw Error('종료 시각은 시작 이후여야 합니다.');break;
    case 'ad_stat':if(!strat)throw Error('광고 실적 입력 권한이 없습니다.');e.payload={channel:ch(p.channel),campaign:key_(p.campaign),spend:n(p.spend),impressions:n(p.impressions),clicks:n(p.clicks)};if(p.clicks>p.impressions)throw Error('노출·클릭 값을 확인하세요.');break;
    case 'feedback':e.payload={source:f(p.source,['당근','네이버','Google 지도·검색','Instagram·SNS','가족·지인 추천','지나가다가 발견','기타 / 기억나지 않음']),reason:f(p.reason,['사진·시설·분위기','메뉴·가격 또는 요금','다른 손님의 후기','가족·지인 추천','당근 소식·광고·쿠폰','위치·일정','이전 방문 경험','기타 / 기억나지 않음']),feel:f(p.feel,['기억에 남는 좋은 경험이었어요','편안했어요','조금 아쉬운 점이 있었어요','불편한 점이 있었어요','답변하지 않을게요']),note:s(p.note,300,false)};if(!Object.values(e.payload).some(Boolean))throw Error('응답이 비어 있습니다.');break;
    case 'service':e.payload={name:s(p.name,80),qty:n(p.qty,100000),cost:n(p.cost,1000000)};break;
    case 'sales':if(!strat)throw Error('실적 입력 권한이 없습니다.');e.payload={period:enum_(p.period,e.unit==='hotel'?['전체']:['전체','점심','저녁']),count:n(p.count,100000),guests:n(p.guests,100000),revenue:n(p.revenue),margin:number_(p.margin,100,false)};if(p.count===0&&p.revenue>0)throw Error('판매 단위를 확인하세요.');break;
    case 'decision':e.payload={title:s(p.title),reason:s(p.reason,500),amount:n(p.amount)};break;
    case 'reply':case 'decision_state':{
      let target=key_(p.target),d=scoped.find(r=>r.type==='decision'&&r.id===target);if(!d)throw Error('대상 안건을 확인하세요.');
      if(e.type==='reply'){e.payload={target:target,text:s(p.text,400)};break;}
      let status=enum_(p.status,['승인 요청','승인','보류']),old=scoped.filter(r=>r.type==='decision_state'&&r.payload.target===target).pop()?.payload.status||'검토 중';
      if(status==='승인 요청'){if(!strat||!['검토 중','보류'].includes(old))throw Error('승인 요청 상태를 확인하세요.');}else if(m.role!=='owner'||old!=='승인 요청')throw Error('승인 권한 또는 현재 상태를 확인하세요.');
      e.payload={target:target,status:status};break;}
  }
  return e;
}
function appendRecord(input){
  const m=member_();const lock=LockService.getScriptLock();lock.waitLock(10000);
  try{
    const sh=eventSheet_();const rows=readRows_(sh);const existing=rows.find(r=>r.id===input?.id);
    if(existing){if(existing.actor!==m.email||existing.unit!==input.unit||existing.date!==input.date||existing.type!==input.type||!m.units.includes(existing.unit))throw Error('이벤트 ID 충돌');return {ok:true,record:viewRecord_(existing,m),asOf:Utilities.formatDate(new Date(),CONNECT_TZ,'yyyy-MM-dd HH:mm:ss')};}
    const r=validate_(input,m,rows);
    sh.getRange(sh.getLastRow()+1,1,1,CONNECT_HEADERS.length).setValues([[r.id,r.unit,r.date,r.type,JSON.stringify(r.payload),r.actor,r.at]]);SpreadsheetApp.flush();
    return {ok:true,record:viewRecord_(r,m),asOf:Utilities.formatDate(new Date(),CONNECT_TZ,'yyyy-MM-dd HH:mm:ss')};
  }finally{lock.releaseLock();}
}
// External platform integration deliberately omitted until exact official API
// authentication, endpoint, account mapping, permissions and response schema are verified.
// No write-to-ad API, public survey handler, or background triggers in this pilot.
