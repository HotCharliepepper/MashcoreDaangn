import test from 'node:test';
import assert from 'node:assert/strict';
import { sheetsFixture } from './sheets-fixture.mjs';
import { demoSeed } from '../src/demo.mjs';
const day='2026-11-25';
const cmd=(id,expected=0,note='현장 기록')=>({id,expected,day,businessId:'majang-sacheon',mode:'pilot',type:'opinion',data:{note}});
const clone=value=>JSON.parse(JSON.stringify(value));

test('미설정은 데모, 실제 저장·비어 있는 설정은 차단',()=>{
  const f=sheetsFixture();
  assert.deepEqual(clone(f.context.loadPilot('majang-sacheon')),{ok:true,mode:'demo'});
  assert.throws(()=>f.context.savePilot(cmd('a')),/\[CONFIG\]/);
  assert.equal(f.state.opens,0);
  f.configure();f.props.set('R05_MODE','pilot');
  assert.throws(()=>f.context.loadPilot('majang-sacheon'),/\[CONFIG\]/);
  assert.equal(f.state.opens,0);
});
test('대표가 새 빈 시트에만 초기화하고 재실행해도 원장 보존',()=>{
  const f=sheetsFixture();f.configure();
  f.state.email='ops@example.invalid';
  assert.throws(()=>f.context.initializePilot_(),/\[FORBIDDEN\]/);
  f.state.email='owner@example.invalid';
  f.book.getSheets()[0].rows.push(['기존 업무']);
  assert.throws(()=>f.context.initializePilot_(),/\[CONFIG\]/);
  assert.equal(f.tab(),undefined);
  f.book.getSheets()[0].rows.pop();
  f.context.initializePilot_();
  assert.equal(f.tab().frozen,1);
  assert.equal(f.props.get('R05_BOUND_SHEET_ID'),'test-book');
  f.props.set('R05_MODE','pilot');f.context.savePilot(cmd('one'));
  const count=f.state.writes;f.context.initializePilot_();
  assert.equal(f.state.writes,count);
  f.props.set('R05_SHEET_ID','unexpected');
  assert.throws(()=>f.context.initializePilot_(),/\[CONFIG\]/);
});
test('로그인·사업장·역할 검증, 클라이언트의 역할 위조와 데모 원장 혼입 차단',()=>{
  const f=sheetsFixture();f.ready();
  for(const email of ['','unregistered@example.invalid']) {
    f.state.email=email;
    assert.throws(()=>f.context.loadPilot('majang-sacheon'),/\[AUTH\]/);
    assert.throws(()=>f.context.savePilot(cmd('bad')),/\[AUTH\]/);
  }
  f.state.email=' OPS@example.invalid ';
  assert.throws(()=>f.context.loadPilot('other-site'),/\[AUTH\]/);
  assert.throws(()=>f.context.savePilot({...cmd('bad'),businessId:'other-site'}),/\[AUTH\]/);
  assert.throws(()=>f.context.savePilot({...cmd('bad'),mode:'demo'}),/\[AUTH\]/);
  assert.throws(()=>f.context.savePilot({...cmd('bad'),role:'owner'}),/\[INVALID\]/);
  assert.throws(()=>f.context.savePilot({...cmd('bad'),type:'approval',data:{decisionId:'nonexistent',status:'approved',note:'검토'}}),/\[FORBIDDEN\]/);
  f.members['ops@example.invalid'].role='unknown';
  f.props.set('R05_MEMBERS_JSON',JSON.stringify(f.members));
  assert.throws(()=>f.context.loadPilot('majang-sacheon'),/\[AUTH\]/);
  assert.equal(f.tab().rows.length,1);
});
test('서버 ID·시각 부여, 논리 중복과 ID 충돌 구별',()=>{
  const f=sheetsFixture();f.ready();
  const orig=cmd('one'), ack=f.context.savePilot(orig);
  assert.equal(ack.ok,true);assert.equal(ack.acceptedId,'one');
  assert.equal(ack.events[0].actorId,'test-owner');assert.equal(ack.events[0].role,'owner');
  assert(Number.isFinite(Date.parse(ack.events[0].updatedAt)));
  f.context.savePilot(cmd('two',1,'두 번째'));
  const replay=f.context.savePilot(orig);
  assert.equal(replay.acceptedId,'one');assert.equal(replay.events.length,2);
  assert.equal(replay.events[0].updatedAt,ack.events[0].updatedAt);
  assert.throws(()=>f.context.savePilot({...orig,data:{note:'변경'}}),/\[ID_CONFLICT\]/);
  f.state.email='ops@example.invalid';
  assert.throws(()=>f.context.savePilot(orig),/\[ID_CONFLICT\]/);
  assert.equal(f.tab().rows.length,3);
});
test('같은 버전을 연 두 사용자의 경합, 잠금 실패, 날짜별 독립 저장',()=>{
  const f=sheetsFixture();f.ready();
  assert.equal(f.context.loadPilot('majang-sacheon').events.length,0);
  f.context.savePilot(cmd('owner-edit'));
  f.state.email='ops@example.invalid';
  assert.throws(()=>f.context.savePilot(cmd('other-edit')),/\[CONFLICT\]/);
  f.state.locked=true;
  assert.throws(()=>f.context.savePilot(cmd('other-edit',1)),/\[STORE\]/);
  f.state.locked=false;
  const ack=f.context.savePilot({...cmd('day-two'),day:'2026-11-26'});
  assert.deepEqual(clone(ack.events.map(e=>[e.day,e.version])),[[day,1],['2026-11-26',1]]);
  assert.equal(ack.events[1].actorId,'test-ops');
});
test('쓰기 전 오류 시 실패 반환, 동일 ID로 복구',()=>{
  const f=sheetsFixture();f.ready();f.state.failure='before';
  assert.throws(()=>f.context.savePilot(cmd('retry')),/\[STORE\]/);
  assert.equal(f.tab().rows.length,1);assert.equal(f.state.locked,false);
  assert.equal(f.context.savePilot(cmd('retry')).acceptedId,'retry');
  assert.equal(f.tab().rows.length,2);
});
test('행 저장 후 확인 실패, 새로 열거나 같은 요청 재전송 시 정확히 한 행',()=>{
  const f=sheetsFixture();f.ready();f.state.failure='after';
  assert.throws(()=>f.context.savePilot(cmd('retry')),/\[STORE\]/);
  assert.equal(f.tab().rows.length,2);
  assert.equal(f.context.loadPilot('majang-sacheon').events[0].id,'retry');
  const writes=f.state.writes;
  assert.equal(f.context.savePilot(cmd('retry')).acceptedId,'retry');
  assert.equal(f.state.writes,writes);
});
test('잘못된 필드와 누락된 열·손상 JSON·바뀐 헤더에 저장 차단',()=>{
  const f=sheetsFixture();f.ready();
  assert.throws(()=>f.context.savePilot({...cmd('bad'),data:{}}),/\[INVALID\]/);
  f.context.savePilot(cmd('ok'));
  const tab=f.tab(),saved=tab.rows[1][9];
  for(const corrupt of ['{}','{broken','null']) {
    tab.rows[1][9]=corrupt;
    assert.throws(()=>f.context.loadPilot('majang-sacheon'),/\[CORRUPT\]/);
    assert.throws(()=>f.context.savePilot(cmd('next',1)),/\[CORRUPT\]/);
  }
  tab.rows[1][9]=saved;tab.rows[0][1]='changed';
  assert.throws(()=>f.context.loadPilot('majang-sacheon'),/\[CONFIG\]/);
  assert.equal(tab.rows.length,2);
});

test('두 날짜, 두 역할의 계획·집행·성과·판단·승인 시트 왕복',()=>{
  const f=sheetsFixture();f.ready();f.state.email='ops@example.invalid';
  const source=demoSeed(day);
  for(const e of source) {
    f.context.savePilot({...cmd(e.id,e.version-1),day:e.day,type:e.type,data:e.data});
  }
  const newPlan={...source.find(e=>e.type==='plan').data,creative:'두 번째 메뉴 소개'};
  f.context.savePilot({...cmd('p2',4),type:'plan',data:newPlan});
  const decision={runId:'sample-run',compareDay:'2026-11-18',baselineId:'sample-base',comparable:true,choice:'revise',note:'다음 주 적용안'};
  f.context.savePilot({...cmd('judgment',5),type:'decision',data:decision});
  f.state.email='owner@example.invalid';
  const approval={decisionId:'judgment',status:'approved',note:'규모를 유지하고 소재만 수정'};
  f.context.savePilot({...cmd('approval',6),type:'approval',data:approval});
  const baseline=source.find(e=>e.id==='sample-base');
  const changed={...baseline.data,dinnerTeams:20};
  f.context.savePilot({...cmd('reclose',1),day:baseline.day,type:'close',data:changed});
  const history=f.context.loadPilot('majang-sacheon').events;
  const saved=history.find(e=>e.id==='judgment');
  assert.equal(saved.snapshot.plan.planRevision,1);
  assert.equal(saved.snapshot.baseline.data.dinnerTeams,10);
  assert.equal(saved.snapshot.metrics.contribution,73400);
  assert.equal(saved.snapshot.suggested,'keep');
  assert.equal(saved.data.choice,'revise');
  assert.equal(history.find(e=>e.id==='approval').role,'owner');
  assert.equal(history.filter(e=>e.day===baseline.day).length,2);
  assert.equal(history.filter(e=>e.day===day).length,7);
});
