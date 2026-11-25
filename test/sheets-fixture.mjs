// Only local test doubles. The application code under test is the installable .gs pair.
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
const program=['Engine.gs','Code.gs'].map(name=>readFileSync(new URL('../apps-script/'+name,import.meta.url),'utf8')).join('\n');

export function sheetsFixture() {
  const state={email:'owner@example.invalid',opens:0,locked:false,failure:'',writes:0};
  const props=new Map();
  const members={
    'owner@example.invalid':{id:'test-owner',role:'owner',businessId:'majang-sacheon'},
    'ops@example.invalid':{id:'test-ops',role:'mashcore',businessId:'majang-sacheon'}
  };
  const string=v=>v==null?'':String(v);
  const tabs=[];
  function sheet(name) {
    const rows=[];
    let maxRows=1000;
    const tab={rows,getName:()=>name,getLastRow:()=>rows.length,
      getLastColumn:()=>rows.reduce((max,r)=>Math.max(max,r.length),0),getMaxRows:()=>maxRows,
      insertRowsAfter:(_,n)=>{maxRows+=n;},setFrozenRows:n=>{tab.frozen=n;},
      getRange(row,col,height,width) {
        const range={
          setNumberFormat(fmt){if(fmt!=='@')throw Error('text format');return range;},
          setValues(matrix){
            if(!state.locked)throw Error('unlocked write');
            if(state.failure==='before'){state.failure='';throw Error('simulated write failure');}
            if(matrix.length!==height||matrix.some(r=>r.length!==width))throw Error('dimensions');
            matrix.forEach((r,i)=>{rows[row-1+i]??=[];r.forEach((v,j)=>rows[row-1+i][col-1+j]=string(v));});
            state.writes++;
            return range;
          },
          getDisplayValues(){
            return Array.from({length:height},(_,i)=>Array.from({length:width},(_,j)=>string(rows[row-1+i]?.[col-1+j])));
          }
        };
        return range;
      }
    };
    tabs.push(tab);return tab;
  }
  sheet('Sheet1');
  const book={getSheets:()=>tabs,getSheetByName:n=>tabs.find(t=>t.getName()===n),insertSheet:sheet};
  const context=vm.createContext({
    Session:{getActiveUser:()=>({getEmail:()=>state.email})},
    PropertiesService:{getScriptProperties:()=>({getProperty:k=>props.get(k)??null,setProperty:(k,v)=>props.set(k,v)})},
    LockService:{getScriptLock:()=>({
      waitLock(){if(state.locked)throw Error('lock timeout');state.locked=true;},
      releaseLock(){state.locked=false;}
    })},
    SpreadsheetApp:{openById(id){state.opens++;if(id!=='test-book')throw Error('unknown book');return book;},
      flush(){if(state.failure==='after'){state.failure='';throw Error('lost confirmation');}}}
  });
  vm.runInContext(program,context);
  function configure(){
    props.set('R05_MEMBERS_JSON',JSON.stringify(members));props.set('R05_SHEET_ID','test-book');
  }
  function ready(){
    configure();context.initializePilot_();props.set('R05_MODE','pilot');
  }
  return {state,props,book,members,context,configure,ready,tab:()=>book.getSheetByName('R05_FIELD_EVENTS')};
}
