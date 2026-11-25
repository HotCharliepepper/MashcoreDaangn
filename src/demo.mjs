import { site, shiftDay, seoulDay } from './config.mjs';
import { prepare, verifyJournal } from './ledger.mjs';
import { nextMidnight } from './flow.mjs';

export const demoKey = 'mashcore.localflow.r05.demo.events.v1';
export function demoActor(role) {
  return {id: role === 'owner' ? 'demo-owner' : 'demo-mashcore', role, mode:'demo', businessId:site.demo};
}
export function demoSeed(today = seoulDay()) {
  const events = [], actor = demoActor('mashcore');
  function add(day,id,type,data) {
    const cmd={id,businessId:site.demo,mode:'demo',day,expected:events.filter(e=>e.day===day).length,type,data};
    events.push(prepare(events,cmd,actor,day+'T09:00:00.000Z').event);
  }
  const close={lunchTeams:8,lunchRevenue:560000,dinnerTeams:10,dinnerRevenue:700000,minutes:14,margin:40,extraCost:1000};
  add(shiftDay(today,-7),'sample-base','close',close);
  add(today,'sample-plan','plan',{channel:'daangn',creative:'저녁 식사 전 한우 메뉴 소개',hypothesis:'저녁 메뉴를 미리 본 손님의 방문이 늘어나는지 확인한다.',start:'15:00',end:'18:00',budget:10000});
  add(today,'sample-run','run',{planId:'sample-plan',start:'15:10',end:'17:55'});
  add(today,'sample-report','report',{runId:'sample-run',channel:'daangn',from:today+'T00:00',to:nextMidnight(today),spend:9600,impressions:3300,clicks:44});
  add(today,'sample-close','close',{...close,dinnerTeams:13,dinnerRevenue:910000,minutes:12});
  return events;
}
function readEvents() {
  const text=localStorage.getItem(demoKey);
  if (text===null) return null;
  let journal;
  try { journal=JSON.parse(text); } catch { throw Error('[CORRUPT] 데모 원장을 읽을 수 없습니다.'); }
  if (journal?.mode!=='demo' || journal.schema!==1) throw Error('[CORRUPT] 데모 저장 형식을 확인하세요.');
  verifyJournal(journal.events,'demo',site.demo);
  return journal.events;
}
export function demoGateway(role='mashcore') {
  const actor=demoActor(role);
  async function transaction(command) {
    if (!navigator.locks) throw Error('[STORE] 데모 저장에는 localhost 또는 HTTPS와 Web Locks 지원 브라우저가 필요합니다.');
    return navigator.locks.request(demoKey,()=>{
      const saved=readEvents(), events=saved ?? demoSeed();
      let write=saved===null;
      if (command) {
        const prepared=prepare(events,command,actor,new Date().toISOString());
        if (!prepared.replay) { events.push(prepared.event); write=true; }
      }
      if (write) localStorage.setItem(demoKey,JSON.stringify({schema:1,mode:'demo',events}));
      return {ok:true,mode:'demo',businessId:site.demo,actor,events,syncedAt:new Date().toISOString(),acceptedId:command?.id ?? null};
    });
  }
  return {load:()=>transaction(null),save:transaction};
}
