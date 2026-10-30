/* Original, softly synthesized ambient music. No external audio or downloads. */
(()=>{
 'use strict';
 const button=document.querySelector('#bgmToggle');let context,master,timer,bar=0,next=0,enabled=true,active=false;
 try{enabled=localStorage.getItem('photo-jigsaw-bgm')!=='off'}catch{}
 const chords=[[48,55,60,64,67],[45,52,57,60,64],[41,48,53,57,60],[43,50,55,59,62]];
 function label(){button.textContent=enabled?(active?'♫ BGM ON':'♫ BGM 待機'):'♫ BGM OFF';button.setAttribute('aria-pressed',String(enabled));button.setAttribute('aria-label',enabled?'BGMをオフにする':'静かなBGMを再生する')}
 function note(midi,at,duration,level){
  const hz=440*Math.pow(2,(midi-69)/12),envelope=context.createGain();
  envelope.gain.setValueAtTime(0,at);envelope.gain.linearRampToValueAtTime(level,at+.08);envelope.gain.exponentialRampToValueAtTime(.0001,at+duration);envelope.connect(master);
  for(const [multiple,weight] of [[1,1],[2,.18],[3,.035]]){
   const oscillator=context.createOscillator(),gain=context.createGain();oscillator.type='sine';oscillator.frequency.value=hz*multiple;gain.gain.value=weight;oscillator.connect(gain);gain.connect(envelope);oscillator.start(at);oscillator.stop(at+duration+.05);oscillator.onended=()=>{oscillator.disconnect();gain.disconnect()};
  }
  setTimeout(()=>envelope.disconnect(),Math.max(0,(at+duration-context.currentTime+1)*1000));
 }
 function schedule(){if(!enabled||context.state!=='running')return;while(next<context.currentTime+1){const chord=chords[bar%chords.length];note(chord[0],next,7,.12);const pattern=[2,3,4,3,2,4];pattern.forEach((index,i)=>note(chord[index]+(bar%4===3&&i===5?12:0),next+i*1.25,4.5,.13));next+=7.5;bar++}}
 async function start(){
  if(!enabled||document.hidden)return;
  try{
   if(!context){const AudioContext=window.AudioContext||window.webkitAudioContext;if(!AudioContext){button.textContent='BGM非対応';button.disabled=true;return}context=new AudioContext();master=context.createGain();master.gain.value=0;const filter=context.createBiquadFilter();filter.type='lowpass';filter.frequency.value=1800;master.connect(filter);filter.connect(context.destination)}
   await context.resume();if(!enabled)return;master.gain.cancelScheduledValues(context.currentTime);master.gain.setTargetAtTime(.17,context.currentTime,.7);if(!active){next=context.currentTime+.15;schedule();timer=setInterval(schedule,500)}active=true;label();
  }catch{active=false;button.textContent='♫ タップしてBGM';}
 }
 function stop(){if(timer)clearInterval(timer);timer=null;active=false;if(context){master.gain.cancelScheduledValues(context.currentTime);master.gain.setTargetAtTime(0,context.currentTime,.25)}label()}
 button.onclick=()=>{if(enabled&&active){enabled=false;stop()}else{enabled=true;start()}try{localStorage.setItem('photo-jigsaw-bgm',enabled?'on':'off')}catch{}label()};
 for(const id of ['campaignStart','playSelected','nextStage'])document.querySelector('#'+id)?.addEventListener('click',start,{capture:true});
 document.addEventListener('visibilitychange',()=>{if(document.hidden){stop();context?.suspend()}else if(enabled&&context)start()});
 window.addEventListener('pagehide',()=>{stop();context?.suspend()});label();
})();
