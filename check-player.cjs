const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const handler=require('./api/player.js');
const players=[],runs=[];
const previousFetch=global.fetch,previousNow=Date.now;
let clock=1800000000000;
const originalEnv={...process.env};
process.env.SUPABASE_URL='https://example.supabase.co';
process.env.SUPABASE_SECRET_KEY='sb_secret_test_only';
process.env.BOO_SESSION_SECRET='test-secret-used-only-by-unit-tests';
Date.now=()=>clock;
global.fetch=async(url,options)=>{
  assert.equal(options.headers.apikey,'sb_secret_test_only');
  assert.equal(options.headers.Authorization,undefined);
  const parsed=new URL(url),table=parsed.pathname.split('/').at(-1),query=parsed.searchParams;
  let data;
  if(options.method==='POST'){
    const input=JSON.parse(options.body);
    assert.equal(input.password,undefined);
    if(table==='boo_players'){
      let row=players.find(p=>p.nickname_key===input.nickname_key);
      if(!row){row={id:crypto.randomUUID(),created_at:new Date(clock).toISOString(),...input};players.push(row)}
      data=[row];
    }else if(table==='boo_runs'){
      if(!runs.some(r=>r.id===input.id))runs.push({...input,created_at:new Date(clock).toISOString()});
      data=null;
    }else throw Error('Unexpected table');
  }else if(table==='boo_players')data=players.filter(p=>'eq.'+p.id===query.get('id'));
  else if(table==='boo_runs')data=runs.filter(r=>'eq.'+r.player_id===query.get('player_id')).slice(-8).reverse();
  else if(table==='boo_player_totals'){
    const rows=runs.filter(r=>'eq.'+r.player_id===query.get('player_id'));
    data=[{best_score:Math.max(0,...rows.map(r=>r.score)),total_games:rows.length,total_hits:rows.reduce((n,r)=>n+r.hits,0),total_penalties:rows.reduce((n,r)=>n+r.penalties,0)}];
  }else throw Error('Unexpected query');
  return{ok:true,text:async()=>data===null?'':JSON.stringify(data)};
};
async function call(body,cookie='',extraHeaders={}){
  const response={code:200,headers:{},setHeader(k,v){this.headers[k]=v},status(code){this.code=code;return this},json(data){this.data=data;return this}};
  await handler({method:body?'POST':'GET',body,headers:{host:'boo-house.vercel.app',origin:'https://boo-house.vercel.app','content-type':'application/json',cookie,...extraHeaders}},response);
  return response;
}
(async()=>{
  assert.equal((await call()).data.player,null);
  const first=await call({action:'login',nickname:'  Pumpkin  ',password:'anything'});
  assert.equal(first.code,200);
  const cookie=first.headers['Set-Cookie'].split(';')[0];
  assert.match(first.headers['Set-Cookie'],/HttpOnly; Secure; SameSite=Lax/);
  const id=first.data.player.id;
  assert.equal((await call(null,cookie)).data.player.id,id);
  const ticket=(await call({action:'begin'},cookie)).data.ticket;
  const score={action:'save',ticket,score:700,hits:4,penalties:1,shots:6};
  assert.equal((await call(score,cookie)).code,400,'early result rejected');
  clock+=61000;
  assert.equal((await call({...score,ticket:ticket+'X'},cookie)).code,400);
  assert.equal((await call({...score,score:100000},cookie)).code,400);
  const saved=await call(score,cookie);
  assert.equal(saved.data.player.best_score,700);
  assert.equal(saved.data.player.total_games,1);
  assert.equal(saved.data.player.runs[0].penalties,1);
  assert.equal((await call(score,cookie)).data.player.total_games,1,'retry deduplicated');
  const other=await call({action:'login',nickname:'Other',password:'random'});
  const otherCookie=other.headers['Set-Cookie'].split(';')[0];
  assert.equal((await call(score,otherCookie)).code,400,'cannot submit for another player');
  assert.equal(other.data.player.runs.length,0,'no other player records');
  const returned=await call({action:'login',nickname:'pumpkin',password:'different'});
  assert.equal(returned.data.player.id,id,'arbitrary password and same nickname restore player');
  assert.equal(returned.data.player.best_score,700);
  assert.equal(returned.data.player.total_games,1);
  assert.equal((await call({action:'login',nickname:'x'.repeat(25)})).code,400);
  assert.equal((await call({action:'login',nickname:'X'},cookie,{origin:'https://evil.example'})).code,403);
  assert.equal((await call({action:'begin'})).code,401);
  const negativeTicket=(await call({action:'begin'},cookie)).data.ticket;clock+=61000;
  const negative=await call({action:'save',ticket:negativeTicket,score:-400,hits:0,penalties:2,shots:2},cookie);
  assert.equal(negative.data.player.total_games,2);
  assert.equal(negative.data.player.best_score,700);
  delete process.env.SUPABASE_SECRET_KEY;
  assert.equal((await call()).code,503);
  console.log('PASS: nickname restore with any password, sessions, persistence, player separation, signed runs, duplicate retry, negative scores, input validation, missing config');
})().catch(error=>{console.error(error);process.exitCode=1}).finally(()=>{global.fetch=previousFetch;Date.now=previousNow;for(const key of ['SUPABASE_URL','SUPABASE_SECRET_KEY','BOO_SESSION_SECRET']){if(originalEnv[key]===undefined)delete process.env[key];else process.env[key]=originalEnv[key]}});
