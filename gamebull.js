'use strict';
window.GameBullIntegration=(()=>{
 const config=window.GAMEBULL_CONFIG||{mode:'gamebull'};let busy=false,lives=null;
 const memoryKey='photo-jigsaw-demo-wallet-v1';
 function wallet(){try{return JSON.parse(localStorage.getItem(memoryKey))||{lives:config.initialDemoLives??5,receipts:{}}}catch{throw Error('ブラウザの保存が利用できません。')}}
 function host(){const bridge=window.GameBullBridge;if(!bridge||typeof bridge.getLives!=='function'||typeof bridge.beginGame!=='function')throw Error('GameBull接続が未設定です。運営にお問い合わせください。');return bridge}
 function paint(){document.querySelectorAll('[data-life-balance]').forEach(e=>e.textContent=(config.mode==='demo'?'テスト用ライフ ':'ライフ ')+(lives===null?'—':lives));}
 async function refresh(){try{lives=config.mode==='demo'?wallet().lives:(await host().getLives()).lives;paint()}catch{paint()}}
 async function begin(stage,version,existing){
  if(busy)throw Error('開始処理中です。');busy=true;
  try{
   // Retry the SAME request ID after network failures to avoid duplicate debit.
   const requestKey='photo-jigsaw-request:'+version+':'+stage;
   let requestId=existing?.requestId||localStorage.getItem(requestKey);
   if(!requestId){requestId=crypto.randomUUID();localStorage.setItem(requestKey,requestId)}
   const input={game:'photo-jigsaw',stage,version,requestId,resumeGameId:existing?.gameId||null};let receipt;
   if(config.mode==='demo'){
    const w=wallet();receipt=w.receipts[requestId];
    if(!receipt){if(w.lives<1)throw Error('テスト用ライフがありません。');receipt={gameId:'demo-'+requestId,requestId,lives:w.lives-1,mode:'demo'};w.lives--;w.receipts[requestId]=receipt;localStorage.setItem(memoryKey,JSON.stringify(w))}
    lives=w.lives;
   }else{
    receipt=await host().beginGame(input);
    if(!receipt||typeof receipt.gameId!=='string'||!Number.isFinite(receipt.lives))throw Error('GameBullから正しい開始情報を取得できませんでした。');
    receipt={...receipt,requestId,mode:'gamebull'};lives=receipt.lives;
   }
   paint();return receipt;
  }finally{busy=false}
 }
 function finishRequest(stage,version){localStorage.removeItem('photo-jigsaw-request:'+version+':'+stage)}
 async function cloudSave(payload){if(config.mode==='gamebull'&&typeof host().saveProgress==='function')await host().saveProgress(payload)}
 return {begin,refresh,cloudSave,finishRequest,mode:config.mode};
})();
window.GameBullIntegration.refresh();
