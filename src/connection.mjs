import { site } from './config.mjs';
import { demoGateway } from './demo.mjs';
import { prepare, verifyJournal } from './ledger.mjs';

function rpc(method, arg) {
  return new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>reject(Error('[STORE] 응답 지연 · 같은 요청을 다시 확인하세요.')),30000);
    const run=google.script.run.withSuccessHandler(result=>{clearTimeout(timer);resolve(result);})
      .withFailureHandler(error=>{clearTimeout(timer);reject(Error(error.message || '원장 응답 오류'));});
    run[method](arg);
  });
}
export async function connect(demoRole) {
  if (typeof google === 'undefined' || !google.script?.run) {
    const gateway=demoGateway(demoRole);
    return {gateway, initial:await gateway.load()};
  }
  const gateway={load:()=>rpc('loadPilot',site.pilot),save:cmd=>rpc('savePilot',cmd)};
  const initial=await gateway.load();
  if (initial?.ok===true && initial.mode==='demo') {
    const demo=demoGateway(demoRole);
    return {gateway:demo,initial:await demo.load()};
  }
  return {gateway,initial};
}
export function acknowledge(reply, actor, request=null) {
  if (reply?.ok!==true || !actor || reply.mode!==actor.mode || reply.businessId!==actor.businessId ||
    reply.actor?.id!==actor.id || reply.actor.role!==actor.role || reply.actor.mode!==actor.mode ||
    reply.actor.businessId!==actor.businessId || !Array.isArray(reply.events) ||
    !Number.isFinite(Date.parse(reply.syncedAt)) || (request && (reply.acceptedId!==request.id ||
      !reply.events.some(e=>e.id===request.id && e.actorId===actor.id && e.type===request.type && e.day===request.day)))) {
    throw Error('[STORE] 저장소의 확인 응답이 올바르지 않습니다.');
  }
  verifyJournal(reply.events,actor.mode,actor.businessId);
  if (request) {
    try { if (!prepare(reply.events,request,actor,reply.syncedAt).replay) throw Error(); }
    catch { throw Error('[STORE] 원장의 확인 응답과 보낸 기록이 다릅니다. 동기화 후 재확인하세요.'); }
  }
  return reply;
}
