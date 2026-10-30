'use strict';
const $=s=>document.querySelector(s),canvas=$('#board'),ctx=canvas.getContext('2d');
const catalog=window.PUZZLE_PHOTOS;const photoList=catalog.photos;const cats=[...new Set(photoList.map(p=>p.category))];function entries(c){return photoList.filter(p=>p.category===cats[c])}function currentPhoto(){return entries(category)[photo]}function shuffled(a){const out=[...a];for(let i=out.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[out[i],out[j]]=[out[j],out[i]]}return out};let category=0,photo=0,img=new Image(),pieces=[],cols=4,rows=3,selected=null,drag=null,ghost=false,elapsed=0,started=false,theme=1,edgesX=[],edgesY=[],placed=0;
const W=1200,H=1450,B={x:60,y:45,w:1080,h:777.6};canvas.width=W;canvas.height=H;
function read(key,fallback){try{return JSON.parse(localStorage.getItem(key))??fallback}catch{return fallback}}
function key(){if(stage!==null)return 'jigsaw-stage-v1-'+stage+(catalog.version==='original-1'?'':'-'+catalog.version);return 'jigsaw-v1-'+category+'-'+photo+'-'+cols+'x'+rows}
function save(){if(!pieces.length)return true;try{localStorage.setItem(key(),JSON.stringify({pieces,elapsed,edgesX,edgesY,layout:2,session:gameSession,photoId:currentPhoto().id,savedAt:new Date().toISOString()}));$('#saveStatus').textContent='この端末に保存済み';return true}catch{$('#saveStatus').textContent='保存できません。空き容量やブラウザ設定をご確認ください。';return false}}
function gallery(){}
function open(){document.body.classList.remove('at-home');started=false;$('#difficulty').disabled=stage!==null;$('#stagebar').hidden=stage===null;$('#library').hidden=true;$('#game').hidden=false;$('#message').textContent='画像を読み込んでいます…';img=new Image();img.onload=()=>{init(false);started=true};img.onerror=()=>{$('#message').textContent='画像を読み込めませんでした。写真一覧から選び直してください。'};img.src=currentPhoto().image}
function init(fresh){[cols,rows]=$('#difficulty').value.split(',').map(Number);selected=null;drag=null;elapsed=0;ghost=false;edgesX=Array.from({length:rows},()=>Array.from({length:cols-1},()=>Math.random()<.5?-1:1));edgesY=Array.from({length:rows-1},()=>Array.from({length:cols},()=>Math.random()<.5?-1:1));const cw=B.w/cols,ch=B.h/rows;
pieces=Array.from({length:cols*rows},(_,i)=>({id:i,x:90+Math.random()*(W-cw-180),y:970+Math.random()*Math.max(0,H-ch-1040),done:false}));const old=read(key(),null);if(!fresh&&old&&old.pieces?.length===pieces.length){pieces=old.pieces; if(!old.layout){pieces.forEach(p=>{if(p.done)Object.assign(p,target(p));else {p.x=90+Math.random()*(W-cw-180);p.y=970+Math.random()*Math.max(0,H-ch-1040)}})} elapsed=old.elapsed||0;edgesX=old.edgesX;edgesY=old.edgesY}draw();save()}
function edge(path,x,y,dx,dy,sign){const nx=dy,ny=-dx;path.lineTo(x+dx*.34,y+dy*.34);path.bezierCurveTo(x+dx*.44-nx*.18*sign,y+dy*.44-ny*.18*sign,x+dx*.28-nx*.27*sign,y+dy*.28-ny*.27*sign,x+dx*.5-nx*.27*sign,y+dy*.5-ny*.27*sign);path.bezierCurveTo(x+dx*.72-nx*.27*sign,y+dy*.72-ny*.27*sign,x+dx*.56-nx*.18*sign,y+dy*.56-ny*.18*sign,x+dx*.66,y+dy*.66);path.lineTo(x+dx,y+dy)}
function path(p){const r=Math.floor(p.id/cols),c=p.id%cols,w=B.w/cols,h=B.h/rows,a=new Path2D();a.moveTo(0,0);if(r)edge(a,0,0,w,0,-edgesY[r-1][c]);else a.lineTo(w,0);if(c<cols-1)edge(a,w,0,0,h,edgesX[r][c]);else a.lineTo(w,h);if(r<rows-1)edge(a,w,h,-w,0,edgesY[r][c]);else a.lineTo(0,h);if(c)edge(a,0,h,0,-h,-edgesX[r][c-1]);else a.lineTo(0,0);a.closePath();return a}
function piece(p){const w=B.w/cols,h=B.h/rows;ctx.save();ctx.translate(p.x,p.y);const a=path(p);ctx.save();ctx.shadowColor='#23334740';ctx.shadowBlur=p.done?0:7;ctx.shadowOffsetY=3;ctx.fillStyle='#e8edf2';ctx.fill(a);ctx.restore();ctx.save();ctx.clip(a);ctx.drawImage(img,-p.id%cols*w,-Math.floor(p.id/cols)*h,B.w,B.h);ctx.restore();ctx.strokeStyle=p===selected?'#526c85':p.done?'#fff5':'#fff9';ctx.lineWidth=p===selected?3:1;ctx.stroke(a);ctx.restore()}
function renderBoard(){$('#timer').textContent=String(Math.floor(elapsed/60)).padStart(2,'0')+':'+String(elapsed%60).padStart(2,'0');ctx.clearRect(0,0,W,H);ctx.fillStyle='#f5f7f9';ctx.fillRect(0,0,W,H);ctx.fillStyle='#ffffff';ctx.fillRect(B.x-8,B.y-8,B.w+16,B.h+16);ctx.fillStyle='#e1e7ed';ctx.fillRect(B.x,B.y,B.w,B.h);if(ghost){ctx.save();ctx.globalAlpha=.36;ctx.drawImage(img,B.x,B.y,B.w,B.h);ctx.restore()}ctx.fillStyle='#667583';ctx.font='28px system-ui';ctx.fillText('ピースを選んで、上の枠へ',60,904);pieces.filter(p=>p.done).forEach(piece);pieces.filter(p=>!p.done&&p!==selected).forEach(piece);if(selected)piece(selected);placed=pieces.filter(p=>p.done).length;$('#progress').textContent=`${placed} / ${pieces.length} ピース　${Math.round(placed/pieces.length*100)}%`;$('#message').textContent=placed===pieces.length?'完成！ おめでとうございます ✨':'';}
function point(e){const r=canvas.getBoundingClientRect();return{x:(e.clientX-r.left)*W/r.width,y:(e.clientY-r.top)*H/r.height}}
function target(p){return{x:B.x+p.id%cols*B.w/cols,y:B.y+Math.floor(p.id/cols)*B.h/rows}}
function snap(p){const t=target(p),tolerance=Math.min(B.w/cols,B.h/rows)*.48;if(Math.hypot(p.x-t.x,p.y-t.y)<tolerance){Object.assign(p,t,{done:true});selected=null}save();draw()}
canvas.onpointerdown=e=>{e.preventDefault();const q=point(e);const hit=[...pieces.filter(p=>!p.done&&p!==selected),...(selected?[selected]:[])].reverse().find(p=>ctx.isPointInPath(path(p),q.x-p.x,q.y-p.y));if(hit){selected=hit;drag={dx:q.x-hit.x,dy:q.y-hit.y};canvas.setPointerCapture(e.pointerId)}else if(selected&&q.x>=B.x&&q.x<=B.x+B.w&&q.y>=B.y&&q.y<=B.y+B.h){selected.x=q.x-B.w/cols/2;selected.y=q.y-B.h/rows/2;snap(selected)}draw()};
canvas.onpointermove=e=>{if(drag&&selected){const q=point(e);selected.x=Math.max(0,Math.min(W-B.w/cols,q.x-drag.dx));selected.y=Math.max(0,Math.min(H-B.h/rows,q.y-drag.dy));draw()}};
canvas.onpointerup=()=>{if(drag&&selected)snap(selected);drag=null};canvas.onpointercancel=()=>{drag=null;save()};
$('#back').onclick=()=>{if(!save())return;started=false;$('#game').hidden=true;$('#library').hidden=false;gallery()};$('#difficulty').onchange=()=>{save();init(false)};$('#restart').onclick=async()=>{if(!confirm('1ライフを使用して最初からやり直しますか？'))return;await startStage(stage,true)};setInterval(()=>{if(started&&placed<pieces.length){elapsed++;$('#timer').textContent=String(Math.floor(elapsed/60)).padStart(2,'0')+':'+String(elapsed%60).padStart(2,'0');if(elapsed%5===0)save()}},1000);window.addEventListener('pagehide',()=>{if(started)save()});
// 30 increasing difficulty tiers, 20 photographs per tier = 600 stages.
const tiers=[[4,3],[5,3],[5,4],[6,4],[7,4],[7,5],[8,5],[8,6],[9,6],[10,6],[10,7],[11,7],[12,7],[12,8],[13,8],[14,8],[14,9],[14,10],[15,10],[16,10],[17,11],[18,12],[19,13],[20,14],[21,14],[22,15],[24,16],[26,18],[28,19],[30,20]];
let stage=null;let gameSession=null;let startBusy=false;
let campaign=read('jigsaw-campaign-v1',{unlocked:1,current:1,completed:[]});
campaign.unlocked=Math.max(1,Math.min(600,Number(campaign.unlocked)||1));
campaign.completed=Array.isArray(campaign.completed)?campaign.completed.filter(n=>Number.isInteger(n)&&n>=1&&n<=600):[];
function persistCampaign(){try{localStorage.setItem('jigsaw-campaign-v1',JSON.stringify(campaign))}catch{}}
function renderCampaign(){$('#homeStage').textContent='ステージ '+campaign.current+' / 600';$('#homeProgress').value=campaign.completed.length;
 $('#stageSelect').innerHTML=Array.from({length:600},(_,i)=>{const n=i+1,t=tiers[Math.floor(i/20)];return '<option value="'+n+'" '+(n===campaign.current?'selected ':'')+(n>campaign.unlocked?'disabled':'')+'>ステージ '+n+' · '+(t[0]*t[1])+'ピース'+(campaign.completed.includes(n)?' ✓':n>campaign.unlocked?' 🔒':'')+'</option>'}).join('');
 $('#campaignProgress').textContent=campaign.completed.length+' / 600 ステージクリア · 到達 '+campaign.unlocked;
}
function startStageCore(n){
 n=Math.max(1,Math.min(campaign.unlocked,600,Number(n)||1));
 if(started&&!save())throw Error("現在のゲームを保存できませんでした。");stage=n;campaign.current=n;persistCampaign();
 campaign.photos??={};
 const assignmentKey=catalog.version+':'+n;
 let chosen=photoList.find(p=>p.id===campaign.photos[assignmentKey]);
 if(!chosen){
   const legacy=read('jigsaw-stage-v1-'+n,null);
   if(catalog.version==='original-1'&&legacy){chosen=photoList[(n-1)%20]}
   if(!chosen){const previous=campaign.photos[catalog.version+':'+(n-1)];const pool=photoList.filter(p=>p.id!==previous);chosen=(pool.length?pool:photoList)[Math.floor(Math.random()*(pool.length||photoList.length))]}
   campaign.photos[assignmentKey]=chosen.id;persistCampaign();
 }
 category=cats.indexOf(chosen.category);photo=entries(category).indexOf(chosen);
 const t=tiers[Math.floor((n-1)/20)];
 $('#difficulty').innerHTML='<option value="'+t.join(',')+'">'+t[0]*t[1]+'</option>';
 $('#difficulty').value=t.join(',');
 $('#stageTitle').textContent='STAGE '+n+' / 600';
 $('#stageBand').textContent=t[0]*t[1]+'ピース · 難易度 '+(Math.floor((n-1)/20)+1)+' / 30';
 open();
}
function draw(){renderBoard();
 $('#nextStage').hidden=true;
 if(stage!==null&&pieces.length&&placed===pieces.length){
   if(!campaign.completed.includes(stage)){campaign.completed.push(stage);campaign.unlocked=Math.max(campaign.unlocked,Math.min(600,stage+1));campaign.current=Math.min(600,stage+1);persistCampaign();renderCampaign()}
   $('#nextStage').hidden=stage===600;
   if(stage===600)$('#message').textContent='600ステージ完全クリア！ おめでとうございます！';
 }
}
$('#campaignStart').onclick=()=>startStage(campaign.current);
$('#chooseStage').onclick=()=>$('#stageDialog').showModal();
$('#howTo').onclick=()=>$('#helpDialog').showModal();
$('#playSelected').onclick=()=>{$('#stageDialog').close();startStage($('#stageSelect').value)};
$('#nextStage').onclick=()=>{if(stage!==null&&placed===pieces.length&&stage<600)startStage(stage+1)};
const originalBack=$('#back').onclick;
$('#back').onclick=()=>{if(!save())return;document.body.classList.add('at-home');originalBack();stage=null;$('#nextStage').hidden=true;$('#difficulty').disabled=false;$('#difficulty').innerHTML='<option value="4,3">12</option><option value="7,5">35</option><option value="10,7" selected>70</option><option value="14,10">140</option><option value="20,14">280</option>';renderCampaign()};
renderCampaign();





async function startStage(n,fresh=false){
 if(startBusy)return;startBusy=true;
 try{
  n=Math.max(1,Math.min(campaign.unlocked,600,Number(n)||1));
  if(started&&!save())return;
  const version=catalog.version,k='jigsaw-stage-v1-'+n+(version==='original-1'?'':'-'+version);
  const previous=read(k,null);const incomplete=previous?.pieces?.length&&previous.pieces.some(p=>!p.done);
  // Existing in-progress games from older builds can resume without a demo debit.
  let receipt;
  if(!fresh&&incomplete&&(!previous.session||previous.session.mode===GameBullIntegration.mode)){
   if(GameBullIntegration.mode==='demo')receipt=previous.session||{gameId:'demo-legacy-'+n,mode:'demo'};
   else receipt=await GameBullIntegration.begin(n,version,previous.session);
  }else{
   if((fresh||previous?.pieces?.every(p=>p.done))&&previous?.session?.requestId===localStorage.getItem('photo-jigsaw-request:'+version+':'+n))GameBullIntegration.finishRequest(n,version);
   receipt=await GameBullIntegration.begin(n,version,null);
  }
  // Preserve the old game's receipt until its last save completes.
  if(started&&!save())return;started=false;gameSession=receipt;
  if(fresh||!incomplete){localStorage.removeItem(k)}
  startStageCore(n);
 }catch(e){alert(e.message||'ゲームを開始できませんでした。')}finally{startBusy=false}
}
$('#saveExit').onclick=async()=>{
 if(!save())return;
 try{await GameBullIntegration.cloudSave({game:'photo-jigsaw',version:catalog.version,stage,gameId:gameSession?.gameId,progress:read(key(),null),campaign});$('#back').click()}
 catch{$('#saveStatus').textContent='端末には保存済みです。GameBull同期に失敗しました。再度「保存して終了」を押してください。'}
};
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='hidden'&&started)save()});

