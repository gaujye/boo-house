const fs=require('fs'),vm=require('vm');const els={};const grad=()=>({addColorStop(){}});const ctx=new Proxy({createLinearGradient:grad,createRadialGradient:grad},{get:(o,k)=>k in o?o[k]:()=>{}});const canvas={getContext:()=>ctx,getBoundingClientRect:()=>({width:900,height:650,left:0,top:0}),addEventListener:(k,f)=>canvas[k]=f};const el=s=>els[s]??=(s==='#game'?canvas:{textContent:'',hidden:true});const param={setValueAtTime(){},exponentialRampToValueAtTime(){},setTargetAtTime(){}};class Audio{constructor(){this.sampleRate=100;this.currentTime=0}resume(){}createGain(){return{gain:{...param},connect(){}}}createOscillator(){return{frequency:{...param},connect(){},start(){},stop(){}}}createBuffer(){return{getChannelData:()=>new Float32Array(300)}}createBufferSource(){return{connect(){},start(){}}}createBiquadFilter(){return{frequency:{},connect(){}}}}
const s={Image:class {constructor(){this.complete=false}},document:{querySelector:el},window:{addEventListener(){},AudioContext:Audio},devicePixelRatio:1,localStorage:{getItem:()=>0,setItem(){}},performance:{now:()=>0},requestAnimationFrame(){},Math};vm.createContext(s);vm.runInContext(fs.readFileSync('dist/game.js','utf8'),s);vm.runInContext(`frame(0);start();ghosts[0].type=0;frame(16);canvas.pointerdown({clientX:ghosts[0].cx,clientY:ghosts[0].cy});if(score<=0||hits!==1)throw Error('hit');canvas.pointerdown({clientX:0,clientY:0});if(combo!==0)throw Error('miss');frame(60001);if(playing||document.querySelector('#result').hidden)throw Error('finish');start();if(score!==0||!playing)throw Error('restart');`,s);console.log('PASS: render, hit score, miss, timer, results, restart');


vm.runInContext(`
start();ghosts=[];score=100;combo=12;
function target(type){ghosts=[{x:.5,y:.5,size:1,type,phase:0,born:0,life:10000,vx:0}];ghost(ghosts[0],0);canvas.pointerdown({clientX:ghosts[0].cx,clientY:ghosts[0].cy})}
target(4);
if(score!==-100||combo!==0||hits!==0||penalties!==1||document.querySelector('#score').textContent!=='-100')throw Error('penalty scoring');
if(labels.at(-1).text!=='-200 ♥ 別打我')throw Error('penalty feedback');
target(0);if(score!==0||hits!==1)throw Error('score recovery');
score=1000;combo=14;target(4);if(score!==800)throw Error('penalty must not multiply');
combo=7;ghosts=[{type:4,born:0,life:1}];frame(100);if(combo!==7)throw Error('friendly escape must preserve combo');
ghosts=[{type:0,born:0,life:1}];frame(101);if(combo!==0)throw Error('enemy escape must reset combo');
finish();if(!document.querySelector('#stats').textContent.includes('誤擊 2 隻'))throw Error('penalty stats');
start();if(penalties!==0||score!==0)throw Error('penalty restart');
`,s);
console.log('PASS: friendly penalty, negative score, combo reset, fixed penalty, safe escape, result stats, restart');
