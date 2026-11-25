// Start dev.mjs first. The browser uses a fresh, isolated profile for each test.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { mkdir } = require('node:fs/promises');
const path = require('node:path');
const { chromium } = require('playwright-core');
const base='http://127.0.0.1:'+Number(process.env.R05_TEST_PORT || 4305);
const demoKey='mashcore.localflow.r05.demo.events.v1';
let browser;
before(async()=>{browser=await chromium.launch({headless:true});});
after(async()=>{if(browser) await browser.close();});

async function profile(t,width=1440,height=1000) {
  const mobile=width<630;
  const c=await browser.newContext({viewport:{width,height},isMobile:mobile,hasTouch:mobile,deviceScaleFactor:1,locale:'ko-KR',timezoneId:'Asia/Seoul'});
  t.after(()=>c.close());
  const page=await c.newPage(), errors=[], external=[];
  c.on('request',request=>{
    if (/^https?:/.test(request.url()) && new URL(request.url()).origin!==base) external.push(request.url());
  });
  page.setDefaultTimeout(6500);
  page.on('pageerror',e=>errors.push(e.message));
  t.after(()=>assert.deepEqual(errors,[]));
  t.after(()=>assert.deepEqual(external,[]));
  return {c,page};
}
async function open(page,url='/') {
  await page.goto(base+url);
  await page.waitForFunction(()=>document.querySelector('#mode').textContent.includes('데모'));
}
async function tab(page,id) {
  await page.locator('#nav [data-tab="'+id+'"]').click();
  await page.locator('#page-'+id).waitFor({state:'visible'});
}
const input=(p,f,n)=>p.locator('#'+f+' [name="'+n+'"]');
async function submit(p,f,label) {
  await p.locator('#'+f+' button').click();
  await p.waitForFunction(label=>document.querySelector('#feedback').textContent.includes(label+' 저장 완료'),label);
  assert.equal(await p.locator('#problem').isVisible(),false);
}
async function entries(p){return p.evaluate(k=>JSON.parse(localStorage.getItem(k)).events,demoKey);}
async function setDay(p,day) {
  const picker=p.locator('#day');
  await picker.fill(day);await picker.dispatchEvent('change');
}
function offset(day,n){const d=new Date(day+'T00:00:00Z');d.setUTCDate(d.getUTCDate()+n);return d.toISOString().slice(0,10);}
async function screenshot(p,name) {
  if(process.env.R05_SCREENSHOTS!=='1')return;
  const dir=path.join(__dirname,'..','qa');
  await mkdir(dir,{recursive:true});
  await p.screenshot({path:path.join(dir,name+'.png')});
}
async function draftDecision(page) {
  await tab(page,'review');
  await input(page,'decision','comparable').check();
  assert.equal(await input(page,'decision','choice').inputValue(),'keep');
  await input(page,'decision','choice').selectOption('revise');
  await input(page,'decision','note').fill('대표와 다음 주에 소재를 교체하기로 검토했다.');
}
test('PC · 탭을 오가며 수정한 계획, 수동 판단, 의견 및 대표 승인 이력',async t=>{
  const {page}=await profile(t);
  await open(page,'/built/');
  await screenshot(page,'desktop-today');
  await draftDecision(page);
  await tab(page,'ads');
  await input(page,'plan','creative').fill('저녁 두 번째 안내');
  await submit(page,'plan','계획');
  await tab(page,'review');
  assert.equal(await input(page,'decision','choice').inputValue(),'revise');
  assert.match(await input(page,'decision','note').inputValue(),/소재를 교체/);
  await input(page,'decision','comparable').uncheck();
  assert.equal(await input(page,'decision','choice').inputValue(),'hold');
  await input(page,'decision','comparable').check();
  assert.equal(await input(page,'decision','choice').inputValue(),'revise');
  assert.match(await page.locator('#recommendation').innerText(),/집행 계획 v1/);
  await submit(page,'decision','공동 판단');
  await input(page,'opinion','note').fill('저녁 방문팀 수를 다시 확인했다.');
  await submit(page,'opinion','의견');
  assert.equal(await page.locator('#approval').isVisible(),false);
  await page.locator('#demo-role').selectOption('owner');
  await page.locator('#approval').waitFor({state:'visible'});
  await input(page,'approval','note').fill('다음 영업일부터 의견을 반영한다.');
  await submit(page,'approval','대표 검토');
  await page.reload();
  await page.locator('#decisions summary').click();
  const history=await page.locator('#decisions').innerText();
  assert.match(history,/수정 검토 · 대표 승인/);assert.match(history,/당시 제안 유지 검토/);
  assert.match(history,/majang.flow\/0.5.0/);assert.match(history,/계획 v1/);
  const rows=await entries(page), decision=rows.find(e=>e.type==='decision');
  assert.equal(decision.snapshot.run.id,'sample-run');
  assert.equal(decision.snapshot.plan.id,'sample-plan');
  assert.equal(rows.find(e=>e.type==='approval').data.decisionId,decision.id);
});
test('모바일 · 새 영업일 계획부터 마감·판단까지, 두 날짜와 기간별 조회',async t=>{
  const {page}=await profile(t,390,844);
  await open(page);
  await screenshot(page,'mobile-today');
  const today=await page.locator('#day').inputValue(), other=offset(today,-1);
  await setDay(page,other);await tab(page,'ads');
  await input(page,'plan','creative').fill('점심 안내');
  await input(page,'plan','hypothesis').fill('점심 안내 후 방문 변화를 관찰한다.');
  await input(page,'plan','budget').fill('5000');
  await submit(page,'plan','계획');
  await input(page,'plan','creative').fill('점심 안내 수정');
  await submit(page,'plan','계획');
  const plans=(await entries(page)).filter(e=>e.day===other && e.type==='plan');
  assert.deepEqual(plans.map(p=>p.snapshot.planRevision),[1,2]);
  await input(page,'run','planId').selectOption(plans[0].id);
  await input(page,'run','start').fill('15:20');await input(page,'run','end').fill('17:10');
  await submit(page,'run','집행 기록');
  await input(page,'report','spend').fill('0');
  await input(page,'report','impressions').fill('100');await input(page,'report','clicks').fill('0');
  await submit(page,'report','광고 실적');
  await tab(page,'closing');
  for(const [key,value] of Object.entries({lunchTeams:0,lunchRevenue:0,dinnerTeams:2,dinnerRevenue:80000,minutes:6,margin:40,extraCost:0}))
    await input(page,'close',key).fill(String(value));
  await submit(page,'close','영업 마감');
  await tab(page,'review');
  const baseline=offset(today,-7);
  await input(page,'decision','compareDay').fill(baseline);await input(page,'decision','comparable').check();
  await input(page,'decision','note').fill('지난 영업일과 메뉴 구성을 비교했다.');
  await submit(page,'decision','공동 판단');
  await tab(page,'records');
  for(const unit of ['week','month','day']) {
    await page.locator('#period').selectOption(unit);
    assert.match(await page.locator('#range-days').innerText(),new RegExp(other));
  }
  await page.locator('#range-days button').first().click();
  await page.locator('#page-today').waitFor({state:'visible'});
  assert.match(await page.locator('#today-kpis').innerText(),/2팀/);
  await setDay(page,today);assert.match(await page.locator('#today-kpis').innerText(),/21팀/);
  await page.reload();await open(page);
  await setDay(page,other);await tab(page,'closing');
  assert.equal(await input(page,'close','lunchTeams').inputValue(),'0');
  assert.equal(await input(page,'close','minutes').inputValue(),'6');
  const history=(await entries(page)).filter(e=>e.day===other);
  assert.equal(history.find(e=>e.type==='decision').snapshot.plan.planRevision,1);
  assert.equal(history.find(e=>e.type==='report').snapshot.planId,plans[0].id);
});
test('320·390·768·1440px 화면의 다섯 메뉴와 키보드 접근 및 빌드 HTML',async t=>{
  for(const [width,height] of [[320,740],[390,844],[768,1024],[1440,1000]]) {
    const {page}=await profile(t,width,height);await open(page,'/built/');
    await page.keyboard.press('Tab');
    assert(await page.locator('.skip').evaluate(e=>e===document.activeElement));
    for(const id of ['ads','closing','review','records','today']) {
      await tab(page,id);
      const dim=await page.evaluate(()=>({
        visible:document.documentElement.clientWidth,scroll:document.documentElement.scrollWidth,
        target:Math.min(...Array.from(document.querySelectorAll('#nav a'),a=>a.getBoundingClientRect().height))
      }));
      assert(dim.scroll<=dim.visible,'horizontal overflow '+width+' '+id+' '+JSON.stringify(dim));
      assert(dim.target>=44);
      assert.equal(await page.locator('#nav [aria-current="page"]').getAttribute('data-tab'),id);
    }
  }
});
test('브라우저 저장 실패 · 미완료 표시, 새로고침 뒤 동일 요청 한 번 복구',async t=>{
  const {page}=await profile(t);await open(page);await tab(page,'review');
  await page.evaluate(()=>{
    const set=Storage.prototype.setItem;
    Storage.prototype.setItem=function(k,v){
      if(this===localStorage)throw Error('테스트 저장 공간 부족');
      return set.call(this,k,v);
    };
  });
  await input(page,'opinion','note').fill('실패 후 한 번만 남아야 할 의견');
  await page.locator('#opinion button').click();
  await page.locator('#retry').waitFor({state:'visible'});
  assert.match(await page.locator('#problem').innerText(),/저장 공간 부족/);
  assert.doesNotMatch(await page.locator('#feedback').innerText(),/저장 완료/);
  const id=await page.evaluate(()=>JSON.parse(sessionStorage.getItem(Object.keys(sessionStorage).find(k=>k.includes('r05.pending')))).id);
  assert.equal((await entries(page)).filter(e=>e.id===id).length,0);
  await page.reload();
  await page.locator('#retry').waitFor({state:'visible'});await page.locator('#retry').click();
  await page.waitForFunction(()=>document.querySelector('#feedback').textContent.includes('의견 저장 완료'));
  assert.equal((await entries(page)).filter(e=>e.id===id).length,1);
});
test('두 브라우저 탭에서 충돌한 마감은 최신 기록 확인 전까지 덮어쓸 수 없음',async t=>{
  const {c,page}=await profile(t);const other=await c.newPage();
  await open(page);await open(other);
  await tab(page,'closing');await tab(other,'closing');
  await input(page,'close','minutes').fill('32');await input(other,'close','minutes').fill('45');
  await submit(page,'close','영업 마감');
  await other.locator('#close button').click();await other.locator('#resolve').waitFor({state:'visible'});
  assert.match(await other.locator('#problem').innerText(),/\[CONFLICT\]/);
  const today=await page.locator('#day').inputValue();
  assert.equal((await entries(page)).filter(e=>e.type==='close' && e.day===today).at(-1).data.minutes,32);
  await other.locator('#resolve').click();
  await other.waitForFunction(()=>document.querySelector('#close [name=minutes]').value==='32');
});
test('설치용 HTML과 실제 .gs 함수 사이의 모의 RPC · 확인 전 상태, 시트 저장 후 응답 유실, 계정 해제',async t=>{
  const {page}=await profile(t);
  const {sheetsFixture}=await import('./sheets-fixture.mjs');
  const f=sheetsFixture();f.ready();
  let unlock,started,delay=true;
  const didStart=new Promise(resolve=>{started=resolve;});
  await page.exposeFunction('testRpc',async(method,arg)=>{
    if(method==='savePilot' && delay) {
      started();await new Promise(resolve=>{unlock=resolve;});delay=false;
      f.state.failure='after';
    }
    try{return {value:JSON.parse(JSON.stringify(f.context[method](arg)))};}
    catch(e){return {error:e.message};}
  });
  await page.addInitScript(()=>{
    function bridge(ok,fail) {
      const call=(name,arg)=>window.testRpc(name,arg).then(r=>r.error?fail(Error(r.error)):ok(r.value));
      return {withSuccessHandler:fn=>bridge(fn,fail),withFailureHandler:fn=>bridge(ok,fn),
        loadPilot:arg=>call('loadPilot',arg),savePilot:arg=>call('savePilot',arg)};
    }
    window.google={script:{run:bridge()}};
  });
  await page.goto(base+'/built/');
  await page.waitForFunction(()=>document.querySelector('#mode').textContent.includes('Sheets'));
  assert.equal(await page.locator('#demo-role-label').isVisible(),false);
  await tab(page,'review');await input(page,'opinion','note').fill('검증용 집계 의견');
  await page.locator('#opinion button').click();await didStart;
  assert.match(await page.locator('#feedback').innerText(),/저장 확인 중/);
  assert.equal(await page.locator('#opinion button').isDisabled(),true);
  assert.equal(f.tab().rows.length,1);unlock();
  await page.locator('#retry').waitFor({state:'visible'});
  assert.match(await page.locator('#problem').innerText(),/\[STORE\]/);
  assert.equal(f.tab().rows.length,2);await page.locator('#retry').click();
  await page.waitForFunction(()=>document.querySelector('#feedback').textContent.includes('의견 저장 완료'));
  assert.match(await page.locator('#synced').innerText(),/마지막 동기화/);
  assert.equal(f.tab().rows.length,2);
  assert.equal(await page.evaluate(k=>localStorage.getItem(k),demoKey),null);
  f.state.email='';
  await page.locator('#sync').click();
  await page.waitForFunction(()=>document.querySelector('#mode').textContent==='연결 제한');
  assert.match(await page.locator('#problem').innerText(),/\[AUTH\]/);
  assert.equal(await page.locator('#page-review').isVisible(),false);
});
