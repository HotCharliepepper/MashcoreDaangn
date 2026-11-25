import test from 'node:test';
import assert from 'node:assert/strict';
import { demoActor, demoSeed } from '../src/demo.mjs';
import { closeFields, engineVersion, periodBounds, seoulDay } from '../src/config.mjs';
import { daily, evidence, nextMidnight, rangeReport } from '../src/flow.mjs';
import { prepare, validDay, verifyJournal } from '../src/ledger.mjs';
import { acknowledge } from '../src/connection.mjs';

const day='2026-11-25', before='2026-11-18', now='2026-11-25T10:00:00.000Z';
const operator=demoActor('mashcore'), owner=demoActor('owner');
const select={runId:'sample-run',compareDay:before,comparable:true};
const emptyClose=Object.fromEntries(closeFields.map(k=>[k,null]));
function request(events,type,data,id,when=day,actor=operator) {
  return {id,type,data,mode:actor.mode,businessId:actor.businessId,day:when,expected:events.filter(e=>e.day===when).length};
}
function add(events,type,data,id,when=day,actor=operator) {
  const cmd=request(events,type,data,id,when,actor);
  const result=prepare(events,cmd,actor,now);
  events.push(result.event);
  return result.event;
}
function decide(events,choice='keep') {
  return add(events,'decision',{...select,baselineId:'sample-base',choice,note:'영업 조건과 마감 수치를 확인했다.'},'judgment');
}

test('서울 영업일 경계, 월요일 주 시작, 월말과 윤년',()=>{
  assert.equal(seoulDay(new Date('2026-11-24T15:00:00Z')),day);
  assert.deepEqual(periodBounds('2026-01-01','week'),['2025-12-29','2026-01-04']);
  assert.deepEqual(periodBounds('2024-02-12','month'),['2024-02-01','2024-02-29']);
  assert.equal(nextMidnight('2026-12-31'),'2027-01-01T00:00');
  assert.equal(validDay('2026-02-29'),false);
});
test('R0.4 지표와 수기 마감 비교',()=>{
  const rows=demoSeed(day), f=evidence(rows,day,select);
  assert.equal(f.engineVersion,engineVersion);
  assert.equal(f.suggested,'keep');
  assert.equal(f.metrics.cpc,9600/44);
  assert.equal(f.metrics.ctr,44/3300*100);
  assert.deepEqual([f.metrics.difference,f.metrics.breakEven,f.metrics.contribution],[3,1,73400]);
  const close=daily(rows,day).close.data;
  add(rows,'close',{...close,extraCost:100000},'cost');
  assert.equal(evidence(rows,day,select).suggested,'revise');
});
test('집행한 이전 계획과 판단 당시 자료·엔진·사람의 선택을 보존',()=>{
  const rows=demoSeed(day), original=rows.find(e=>e.id==='sample-plan');
  const plan2=add(rows,'plan',{...original.data,creative:'전단 새 문구'},'plan-two');
  assert.equal(plan2.snapshot.planRevision,2);
  const d=decide(rows,'hold'), saved=JSON.stringify(d);
  assert.equal(d.data.choice,'hold');
  assert.equal(d.snapshot.suggested,'keep');
  assert.equal(d.snapshot.plan.id,original.id);
  assert.equal(d.snapshot.plan.planRevision,1);
  assert.equal(d.snapshot.report.data.from,day+'T00:00');
  assert.equal(d.snapshot.run.data.start,'15:10');
  add(rows,'close',{...daily(rows,day).close.data,extraCost:120000},'reclose');
  add(rows,'close',{...daily(rows,before).close.data,lunchTeams:20},'rebase',before);
  assert.equal(evidence(rows,day,select).suggested,'revise');
  assert.equal(JSON.stringify(d),saved);
  assert.equal(d.snapshot.baseline.id,'sample-base');
  verifyJournal(rows,'demo',operator.businessId);
});
test('0과 빈칸이 다른 일·주·월 집계, 수정판 중 최신 마감만 합산',()=>{
  const rows=[];
  add(rows,'close',{...emptyClose,lunchTeams:0,minutes:0},'a',before);
  assert.deepEqual([daily(rows,before).teams,daily(rows,before).minutes],[null,0]);
  add(rows,'close',{...emptyClose,lunchTeams:0,dinnerTeams:0,lunchRevenue:0,dinnerRevenue:0,minutes:0},'b',before);
  add(rows,'close',{...emptyClose,lunchTeams:2,dinnerTeams:3,minutes:7},'c');
  assert.deepEqual(rangeReport(rows,day,'week').totals.teams,{value:5,days:1});
  const month=rangeReport(rows,day,'month');
  assert.deepEqual(month.rows.map(r=>r.day),[day,before]);
  assert.deepEqual(month.totals.teams,{value:5,days:2});
  assert.deepEqual(month.totals.revenue,{value:0,days:1});
  assert.deepEqual(month.totals.minutes,{value:7,days:2});
  assert.deepEqual(month.totals.spend,{value:null,days:0});
});
test('기간 또는 채널 불일치와 다중 집행의 귀속 유보',()=>{
  const rows=demoSeed(day), report=rows.find(e=>e.id==='sample-report').data;
  add(rows,'report',{...report,from:day+'T15:00',to:day+'T18:00'},'part');
  assert.equal(evidence(rows,day,select).reason,'period');
  assert.equal(daily(rows,day).spend,null);
  add(rows,'report',{...report,channel:'naver'},'wrong-source');
  assert.equal(evidence(rows,day,select).reason,'channel');
  add(rows,'report',{...report},'corrected');
  const p=rows.find(e=>e.id==='sample-plan');
  add(rows,'plan',{...p.data,creative:'오후 안내'},'p2');
  add(rows,'run',{planId:'p2',start:'18:00',end:'19:00'},'r2');
  add(rows,'report',{...report,runId:'r2'},'overlap');
  assert.equal(evidence(rows,day,select).reason,'multiple');
  assert.equal(daily(rows,day).spend,null);
});
test('집행·비교일·측정값·조건·노출·단위 기여액 부족 시 유보',()=>{
  const r=demoSeed(day), facts=(rows,s=select)=>evidence(rows,day,s);
  for(const [id,reason] of [['sample-plan','run'],['sample-report','report'],['sample-base','baseline'],['sample-close','closing']])
    assert.equal(facts(r.filter(e=>e.id!==id)).reason,reason);
  assert.equal(facts(r,{...select,comparable:false}).reason,'conditions');
  const rep=r.find(e=>e.id==='sample-report').data;
  add(r,'report',{...rep,clicks:null},'unknown');
  assert.equal(facts(r).reason,'missing');
  assert.throws(()=>decide(r),/\[INVALID\]/);
  add(r,'report',{...rep,clicks:0,impressions:0,spend:0},'zero');
  assert.equal(facts(r).reason,'exposure');
  assert.equal(daily(r,day).spend,0);
  add(r,'report',{...rep,clicks:0},'no-clicks');
  assert.deepEqual([facts(r).metrics.cpc,facts(r).metrics.ctr],[null,0]);
  add(r,'close',{...daily(r,day).close.data,margin:0},'zero-margin');
  assert.equal(facts(r).reason,'unit');
});
test('서버 입력 범위, 필수 관계, 동일한 마감과 역순 시간 검증',()=>{
  const rows=demoSeed(day), p=rows.find(e=>e.type==='plan').data, report=rows.find(e=>e.type==='report').data;
  for(const [type,data] of [
    ['plan',{...p,channel:'unsupported'}],['plan',{...p,start:'18:10'}],['plan',{...p,budget:-100}],
    ['run',{planId:'sample-plan',start:'12:00',end:'13:00'}],['run',{planId:'absent',start:'12:00',end:'13:00'}],
    ['report',{...report,clicks:5000}],['report',{...report,spend:null,impressions:null,clicks:null}],
    ['report',{...report,from:before+'T00:00',to:before+'T23:59'}],
    ['close',emptyClose],['close',{...emptyClose,minutes:1441}],['close',{...emptyClose,lunchTeams:0,lunchRevenue:100}],
    ['opinion',{note:' '}],['opinion',{note:'내용',actorId:'owner'}]
  ]) assert.throws(()=>add(rows,type,data,'invalid'),/\[INVALID\]/);
  assert.throws(()=>add(rows,'close',{...daily(rows,day).close.data},'same'),/\[UNCHANGED\]/);
  assert.throws(()=>add(rows,'opinion',{note:'검토'},'bad-date','2026-02-30'),/\[INVALID\]/);
});
test('비교일의 마감만 바뀌어도 검토 중인 판단은 재검토',()=>{
  const rows=demoSeed(day);
  add(rows,'close',{...daily(rows,before).close.data,minutes:13},'new-base',before);
  assert.throws(()=>decide(rows),/\[CONFLICT\]/);
});
test('같은 작성자의 중복 등록과 손상된 판단 사본은 거절',()=>{
  const rows=demoSeed(day), note={note:'점심 재확인'};
  add(rows,'opinion',note,'first');
  assert.throws(()=>add(rows,'opinion',note,'duplicate'),/\[UNCHANGED\]/);
  add(rows,'opinion',note,'owner-note',day,owner);
  const d=decide(rows);
  assert.throws(()=>add(rows,'decision',d.data,'again'),/\[UNCHANGED\]/);
  verifyJournal(rows,'demo',operator.businessId);
  const corrupt=structuredClone(rows);
  corrupt.at(-1).snapshot.plan.data.creative='교체된 원문';
  assert.throws(()=>verifyJournal(corrupt,'demo',operator.businessId),/\[CORRUPT\]/);
  assert.throws(()=>add(rows,['opinion'],note,'invalid'),/\[INVALID\]/);
});
test('대표 검토 역할, 대상 판단, 승인 또는 보류 한 번 기록',()=>{
  const rows=demoSeed(day), d=decide(rows);
  const data={decisionId:d.id,status:'deferred',note:'행사 종료 후 재검토'};
  assert.throws(()=>add(rows,'approval',data,'approval'),/\[FORBIDDEN\]/);
  assert.equal(add(rows,'approval',data,'approval',day,owner).role,'owner');
  assert.throws(()=>add(rows,'approval',data,'second',day,owner),/\[INVALID\]/);
});
test('응답 ID·내용·모드 일치 검증 및 누락된 원장 필드·관계 검출',()=>{
  const rows=demoSeed(day), cmd=request(rows,'opinion',{note:'현장 확인'},'ack');
  add(rows,'opinion',cmd.data,cmd.id);
  const reply={ok:true,mode:'demo',businessId:operator.businessId,actor:operator,events:rows,acceptedId:cmd.id,syncedAt:now};
  assert.equal(acknowledge(reply,operator,cmd),reply);
  assert.throws(()=>acknowledge({...reply,acceptedId:null},operator,cmd),/\[STORE\]/);
  assert.throws(()=>acknowledge({...reply,mode:'pilot'},operator,cmd),/\[STORE\]/);
  assert.throws(()=>acknowledge(reply,operator,{...cmd,data:{note:'별건'}}),/\[STORE\]/);
  const missing=structuredClone(rows);delete missing[0].data.lunchTeams;
  assert.throws(()=>verifyJournal(missing,'demo',operator.businessId),/\[CORRUPT\]/);
  const broken=structuredClone(rows);broken.find(e=>e.type==='run').data.planId='absent';
  assert.throws(()=>verifyJournal(broken,'demo',operator.businessId),/\[CORRUPT\]/);
});
