const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const storage=new Map(),records=[];let signedIn=false,offline=false,next=0;
const profile=()=>({id:'player-one',nickname:'南瓜玩家',best_score:Math.max(0,...records.map(r=>r.score)),total_games:records.length,total_hits:records.reduce((n,r)=>n+r.hits,0),runs:records});
const calls=[];
function setup(){
  const els={},listeners={};
  const element=()=>({textContent:'',value:'',disabled:false,hidden:false,classList:{toggle(){}},replaceChildren(){},append(){},showModal(){this.open=true},close(){this.open=false},focus(){}});
  const get=id=>els[id]??=(element());
  const window={addEventListener:(name,fn)=>listeners[name]=fn,dispatchEvent:event=>{window.lastEvent=event}};
  const context={window,document:{getElementById:get,createElement:element},location:{protocol:'https:'},AbortSignal,CustomEvent:class{constructor(type,options){this.type=type;this.detail=options.detail}},localStorage:{getItem:k=>storage.get(k),setItem:(k,v)=>storage.set(k,v)},fetch:async(url,options)=>{
    const body=options.body?JSON.parse(options.body):null;calls.push(body);
    assert.equal(body?.password,undefined,'password is never sent');
    if(offline)throw Error('offline');
    let data;
    if(!body)data={player:signedIn?profile():null};
    else if(body.action==='login'){signedIn=true;data={player:profile()}}
    else if(body.action==='begin')data={ticket:'ticket-'+(++next)};
    else if(body.action==='save'){if(!records.some(r=>r.ticket===body.ticket))records.unshift({...body,id:body.ticket,created_at:new Date().toISOString()});data={player:profile()}}
    else throw Error('unexpected request');
    return{ok:true,json:async()=>data};
  }};
  vm.createContext(context);vm.runInContext(fs.readFileSync('dist/players.js','utf8'),context);
  return{context,els,get,window};
}
(async()=>{
  const app=setup();await app.window.BooPlayers.ready;
  assert.equal(app.get('start').disabled,false);
  app.get('nickname').value='南瓜玩家';app.get('player-password').value='亂打123';
  await app.get('login-form').onsubmit({preventDefault(){}});
  assert.equal(app.get('player-name').textContent,'南瓜玩家');
  assert.equal(app.get('player-password').value,'');
  const ticket=app.window.BooPlayers.begin();await ticket;offline=true;
  await app.window.BooPlayers.finish(ticket,{score:550,hits:5,penalties:1,shots:7});
  assert.equal(JSON.parse(storage.get('boo-pending-player-one')).length,1);
  assert.equal(app.window.BooPlayers.best(),550);
  assert.match(app.get('cloud-status').textContent,/待同步/);
  offline=false;await app.get('retry-sync').onclick();
  assert.equal(records.length,1);
  assert.equal(JSON.parse(storage.get('boo-pending-player-one')).length,0);
  const reload=setup();await reload.window.BooPlayers.ready;
  assert.equal(reload.get('player-name').textContent,'南瓜玩家');
  assert.equal(reload.get('record-best').textContent,550);
  assert.equal(reload.get('record-games').textContent,1);
  console.log('PASS: arbitrary password not transmitted, profile restore, history, offline queue, retry, reload persistence');
})().catch(error=>{console.error(error);process.exitCode=1});
