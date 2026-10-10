// Engine top-down arcade.zet
const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
const mini = document.getElementById('mini');
const mctx = mini ? mini.getContext('2d') : null;

function resize(){
  canvas.width = canvas.clientWidth * (window.devicePixelRatio||1);
  canvas.height = canvas.clientHeight * (window.devicePixelRatio||1);
}
window.addEventListener('resize', resize); resize();

const keys = {};
addEventListener('keydown', e => { keys[e.key.toLowerCase()] = true; if(['arrowup','arrowdown','arrowleft','arrowright',' '].includes(e.key.toLowerCase())) e.preventDefault(); });
addEventListener('keyup', e => { keys[e.key.toLowerCase()] = false; });
// audio: init saat interaksi pertama (syarat autoplay browser)
addEventListener('pointerdown', ()=>{ try{AudioSys.init();}catch(e){} }, { once:false });

// touch
const touch = { up:false, down:false, left:false, right:false };
document.querySelectorAll('[data-t]').forEach(b=>{
  const k=b.dataset.t;
  const on=e=>{e.preventDefault();touch[k]=true;}, off=e=>{e.preventDefault();touch[k]=false;};
  b.addEventListener('pointerdown',on); b.addEventListener('pointerup',off); b.addEventListener('pointerleave',off);
});

const COLORS = ['#e74c3c','#3498db','#2ecc71','#f1c40f','#9b59b6','#e67e22','#1abc9c','#fd79a8','#00cec9','#6c5ce7'];
const NAMES = ['Raka','Sinta','Bimo','Ayu','Joko','Nala','Bagas','Kiko','Ciko','Dito'];

let state = {
  screen:'menu', mode:'race', trackIdx:0, diff:0.85, aiCount:6,
  cars:[], cam:{x:0,y:0,zoom:1}, time:0, laps:3,
  traffic:{ score:0, near:0, crash:0, best:+(localStorage.getItem('trafficBest')||0) },
  specIdx:0, specTimer:0, countdown:0, finished:false, results:[],
  particles:[], shake:0, overtakes:0, lastOrder:[], skids:[],
  events:[], bestLap:null, countdown:0, flash:0,
  wx:{ cond:'cerah', wet:0, timer:20 },
};

function newCar(x,y,angle,color,name,isPlayer,topSpeed){
  return { x,y,angle,speed:0,input:{throttle:0,brake:0,steer:0},
    color,name,isPlayer,topSpeed:topSpeed||420, w:38,h:20, spin:0,
    lap:0,lastS:0,totalS:0,offroad:false,ai:null,missCd:0,crashCd:0,hitCd:0 };
}

function gridSlot(track, i){
  const row=Math.floor(i/2), side=(i%2===0?-1:1);
  const s=track.length - 250 - row*130;
  const p=trackPointAt(track,s);
  const nx=-p.dirY, ny=p.dirX;
  const p0=trackPointAt(track,0);
  return { x:p.x+nx*side*50, y:p.y+ny*side*50, angle:Math.atan2(p0.dirY,p0.dirX), s };
}
// Susun ulang mobil yang SUDAH ADA ke grid sesuai urutan (untuk start balap dari hasil kualifikasi).
function placeOnGrid(track, ordered){
  ordered.forEach((c,i)=>{
    const g=gridSlot(track,i);
    c.x=g.x; c.y=g.y; c.angle=g.angle;
    c.speed=0; c.vx=Math.cos(g.angle)*0; c.vy=Math.sin(g.angle)*0;
    c.spin=0; c.drifting=false;
    c.lastS=g.s; c.s=g.s; c.totalS=0; c.lap=0;
    c.input={throttle:0,brake:0,steer:0};
    c.pitStops=0; c.pitTimer=0; c.pitDone=false; c.inPit=false;
    // parc fermé championship: ban + damage bawaan quali ronde ini (+ warisan ronde lalu) KEBawa ke balap.
    // Single race: mobil fresh.
    const keepWear = (typeof state!=='undefined') && state.afterQuali==='champ';
    if(c.ai){
      if(!keepWear) c.ai.tire=0;
      c.ai.learn={ brake:new Array(16).fill(0), exit:new Array(16).fill(0), cur:-1, incident:false };
      c.ai.overtakeT=0; c.ai.followT=0; c.ai.stuckT=0; c.ai.reverseT=0; c.ai.willPit=false; c.ai.exiting=false;
    } else if(!keepWear){ c.tire=0; c.damage=0; }
    c.prevLap=0; c.lapStart=0; c.lastLapTime=null;
  });
}

function placeGrid(track, nAI, withPlayer, mode){
  const cars=[]; const total=nAI+(withPlayer?1:0);
  const p0=trackPointAt(track,0);
  const startAng=Math.atan2(p0.dirY,p0.dirX);
  for(let i=0;i<total;i++){
    const row=Math.floor(i/2), side=(i%2===0?-1:1);
    const s=track.length - 250 - row*130;
    const p=trackPointAt(track,s);
    const nx=-p.dirY, ny=p.dirX;
    const x=p.x+nx*side*50, y=p.y+ny*side*50;
    const isP = withPlayer && i===0;
    // BoP: semua mobil balap/AIvAI speed HAMPIR sama (selisih <3%) biar tidak jomplang
    let top;
    if(mode==='traffic') top = 175+Math.random()*65;
    else top = 432 + (Math.random()-0.5)*14 + (isP?4:0);
    const c=newCar(x,y,startAng,COLORS[i%COLORS.length],isP?'KAMU':NAMES[i%NAMES.length],isP,top);
    c.lastS=s; c.totalS=0; c.lap=0;
    c.pitSlot=i; c.pitStops=0; c.pitTimer=0; c.pitDone=false;
    if(!isP){
      // tiap lawan dapat OTAK beda (acak urutan biar tiap balapan beda campuran)
      const brain = brainByIndex((i + Math.floor(Math.random()*BRAINS.length)) % BRAINS.length);
      c.ai=createAI({lane:side*0.4, brain});
      c.brain = brain;
    }
    cars.push(c);
  }
  return cars;
}

function startGame(mode){
  const track=TRACKS[state.trackIdx];
  state.champ=null;
  state.mode=mode; state.time=0; state.finished=false; state.results=[];
  state.laps=track.laps;
  state.traffic={score:0,near:0,crash:0,best:+(localStorage.getItem('trafficBest')||0)};
  if(mode==='race') state.cars=placeGrid(track,5,true,'race');
  else if(mode==='traffic') state.cars=placeGrid(track,11,true,'traffic');
  else state.cars=placeGrid(track,state.aiCount||6,false,'aivai');
  const f=state.cars[0]; state.cam.x=f.x; state.cam.y=f.y;
  state.particles=[]; state.shake=0; state.flash=0; state.overtakes=0; state.lastOrder=[]; state.skids=[];
  state.events=[]; state.bestLap=null; state.countdown=3.6;
  for(const c of state.cars){ c.prevLap=0; c.lapStart=0; c.lastLapTime=null; }
  resetWeather();
  state.screen='play';
  document.getElementById('menu').style.display='none';
  document.getElementById('hud').style.display='flex';
  document.getElementById('over').style.display='none';
  updateHudLabels();
}

const QUALI_LAPS = 3; // 1 out-lap + 2 flying lap, best lap menentukan grid
// KUALIFIKASI: 2 lap, best lap menentukan urutan start. after = 'race' | 'champ'
function startQuali(after){
  const track=TRACKS[state.trackIdx];
  if(after!=='champ') state.champ=null;
  state.afterQuali=after;
  state.mode='quali'; state.time=0; state.finished=false; state.results=[];
  state.laps=QUALI_LAPS;
  state.traffic={score:0,near:0,crash:0,best:+(localStorage.getItem('trafficBest')||0)};
  const withPlayer = !(state.champ && state.champ.aiOnly);
  state.cars = withPlayer ? placeGrid(track,5,true,'race') : placeGrid(track,state.aiCount||6,false,'aivai');
  const f=state.cars[0]; state.cam.x=f.x; state.cam.y=f.y;
  state.particles=[]; state.shake=0; state.flash=0; state.overtakes=0; state.lastOrder=[]; state.skids=[];
  state.events=[]; state.bestLap=null; state.countdown=3.6;
  for(const c of state.cars){ c.prevLap=0; c.lapStart=0; c.lastLapTime=null; c.qualiBest=null; }
  resetWeather();
  pushEvent('⏱️ Kualifikasi: out-lap + 2 flying lap, best lap menentukan grid');
  state.screen='play';
  document.getElementById('menu').style.display='none';
  document.getElementById('hud').style.display='flex';
  document.getElementById('over').style.display='none';
  updateHudLabels();
}
function endQuali(){
  state.finished=true;
  const st=[...state.cars].sort((a,b)=>(a.qualiBest||9999)-(b.qualiBest||9999));
  const best=st[0].qualiBest||0;
  const ov=document.getElementById('over');
  ov.style.display='flex';
  let html='<h2>⏱️ Hasil Kualifikasi — '+TRACKS[state.trackIdx].name+'</h2><ol>'+
    st.map((c,i)=>`<li>P${i+1}. ${c.name} ${c.isPlayer?'(kamu)':(c.brain?c.brain.icon:'')} — <b>${c.qualiBest?c.qualiBest.toFixed(2)+'s':'-'}${i>0&&c.qualiBest&&best?' (+'+(c.qualiBest-best).toFixed(2)+')':''}</b></li>`).join('')+'</ol>';
  const nextLabel = state.afterQuali==='champ' ? ('Start Ronde '+(state.champ.round+1)+' 🏁') : 'Start Balap 🏁';
  html+=`<div class="row"><button onclick="backToMenu()">Menu</button><button onclick="startQuali(state.afterQuali)">Ulangi Q</button><button onclick="startRaceFromQuali()">`+nextLabel+`</button></div>`;
  ov.innerHTML=html;
  state.qualiOrder=st.map(c=>c.name);
}
window.startRaceFromQuali=()=>{
  const track=TRACKS[state.trackIdx];
  const order=(state.qualiOrder||[]).map(n=>state.cars.find(c=>c.name===n)).filter(Boolean);
  state.cars.forEach(c=>{ if(!order.includes(c)) order.push(c); });
  placeOnGrid(track,order);
  state.time=0; state.finished=false;
  state.laps = state.afterQuali==='champ' ? CHAMP_LAPS : track.laps;
  state.mode = state.afterQuali==='champ' ? 'champ' : 'race';
  state.particles=[]; state.shake=0; state.flash=0; state.overtakes=0; state.lastOrder=[]; state.skids=[];
  state.events=[]; state.bestLap=null; state.countdown=3.6; state.pitWarned=false;
  pushEvent('🏁 Start! Grid sesuai hasil kualifikasi');
  document.getElementById('over').style.display='none';
  updateHudLabels();
};
// MODE TES PIT: 6 AI ban botak, wajib pit. Otomatis dinilai: stops, kontak, macet.
function startPitTest(){
  const track=TRACKS[state.trackIdx];
  state.champ=null;
  state.mode='pittest'; state.time=0; state.finished=false; state.results=[];
  state.laps=99;
  state.traffic={score:0,near:0,crash:0,best:0};
  state.cars=placeGrid(track,6,false,'aivai');
  // Tes langsung dari depan ENTRY pit: berderet rolling 300px/s, ban botak semua.
  // Set lap=1 agar strategi pit langsung aktif (tidak perlu nunggu 1 lap).
  state.cars.forEach((c,i)=>{
    const s=track.length-PIT_LANE_LEN-500-i*140;
    const p=trackPointAt(track,s);
    c.x=p.x; c.y=p.y; c.angle=Math.atan2(p.dirY,p.dirX);
    c.speed=300; c.vx=Math.cos(c.angle)*300; c.vy=Math.sin(c.angle)*300;
    c.lastS=s; c.s=s; c.totalS=0; c.lap=1;
    if(c.ai)c.ai.tire=0.8; c.raceLaps=99;
  });
  const f=state.cars[0]; state.cam.x=f.x; state.cam.y=f.y;
  state.particles=[]; state.shake=0; state.flash=0; state.overtakes=0; state.lastOrder=[]; state.skids=[];
  state.events=[]; state.bestLap=null; state.countdown=0; state.pitWarned=false;
  state.pitTest={contacts:0};
  for(const c of state.cars){ c.prevLap=0; c.lapStart=0; c.lastLapTime=null; }
  pushEvent('🔧 TES PIT: semua ban botak — wajib masuk box!');
  state.screen='play';
  document.getElementById('menu').style.display='none';
  document.getElementById('hud').style.display='flex';
  document.getElementById('over').style.display='none';
  updateHudLabels();
}
function endPitTest(){
  state.finished=true;
  const t=state.pitTest;
  const ov=document.getElementById('over');
  ov.style.display='flex';
  const rows=state.cars.map(c=>({name:c.name,stops:c.pitStops||0,tire:c.ai?(c.ai.tire||0):0}));
  const okAll=rows.every(r=>r.stops>=1);
  let html='<h2>🔧 Hasil Tes Pit — '+TRACKS[state.trackIdx].name+'</h2><ol>'+
    rows.map(r=>`<li>${r.name}: ${r.stops}x pit, ban ${Math.round(r.tire*100)}% ${r.stops>=1?'✅':'❌'}</li>`).join('')+'</ol>';
  html+=`<p>Kontak di pit: <b>${t.contacts}</b> ${t.contacts===0?'(bersih ✅)':'(masih senggolan ⚠️)'}</p>`;
  html+=`<h3>${okAll&&t.contacts===0?'✅ LULUS SEMPURNA':(okAll?'⚠️ LULUS (ada senggolan)':'❌ GAGAL — ada yang tidak pit')}</h3>`;
  html+=`<div class="row"><button onclick="backToMenu()">Menu</button><button onclick="startPitTest()">Tes Lagi</button></div>`;
  ov.innerHTML=html;
}
window.startPitTest=startPitTest;
// POIN MUSIM: semua balapan (single + ronde champ) menabung poin F1 permanen
function seasonGet(){ try{ return JSON.parse(localStorage.getItem('seasonPts')||'{}'); }catch(e){ return {}; } }
function seasonAdd(map){
  const s=seasonGet();
  for(const k in map) s[k]=(s[k]||0)+map[k];
  try{ localStorage.setItem('seasonPts',JSON.stringify(s)); }catch(e){}
  updateSeasonBadge();
}
function updateSeasonBadge(){
  const el=document.getElementById('seasonBadge');
  if(!el) return;
  const s=seasonGet(), keys=Object.keys(s);
  if(!keys.length){ el.textContent='Musim: belum ada poin — gas!'; return; }
  const lead=keys.sort((a,b)=>s[b]-s[a])[0];
  el.textContent='🏆 Musim: '+lead+' '+s[lead]+' pts'+(s['KAMU']!==undefined&&lead!=='KAMU'?' (kamu '+s['KAMU']+')':'');
}
window.resetSeason=()=>{ try{localStorage.removeItem('seasonPts');}catch(e){} updateSeasonBadge(); };
window.toggleMute=()=>{
  try{AudioSys.init();}catch(e){}
  AudioSys.setMuted(!AudioSys.muted);
  const t=AudioSys.muted?'🔇':'🔊';
  const b1=document.getElementById('muteBtn'), b2=document.getElementById('muteBtn2');
  if(b1)b1.textContent=t; if(b2)b2.textContent=t+' Audio';
};

function playerInput(car){
  const up=keys['w']||keys['arrowup']||touch.up, dn=keys['s']||keys['arrowdown']||touch.down;
  const lf=keys['a']||keys['arrowleft']||touch.left, rt=keys['d']||keys['arrowright']||touch.right;
  car.input.throttle=up?1:0;
  car.input.brake=dn?0.9:0;
  car.input.steer=(lf?-1:0)+(rt?1:0);
  // rem tangan (spasi): kunci belakang → drift
  car.input.handbrake=!!keys[' '];
  if(keys[' ']) car.input.brake=0.35;
}

function stepCar(car,track,dt){
  const inp=car.input;
  if(car.vx===undefined){ car.vx=Math.cos(car.angle)*car.speed; car.vy=Math.sin(car.angle)*car.speed; car.damage=0; car.drifting=false; car.gForce=0; }
  // mode mundur darurat (anti-stuck AI)
  if(inp.reverse){
    car.speed += (-190 - car.speed)*Math.min(1,dt*3);
    car.angle += (inp.steer||1)*1.8*dt;
    car.vx=Math.cos(car.angle)*car.speed; car.vy=Math.sin(car.angle)*car.speed;
    car.x += car.vx*dt; car.y += car.vy*dt;
    const s2=trackClosest(track,car.x,car.y).s;
    car.lastS=s2; car.s=s2;
    return;
  }
  const info=trackClosest(track,car.x,car.y);
  const offRaw=info.dist>track.roadHalf;
  car.pitZone = (info.s>track.length-PIT_LANE_LEN||info.s<PIT_EXIT);
  const onKerb=!offRaw && info.dist>track.roadHalf*0.82;
  // apron pit (kanan garis start) = aspal, bukan gravel
  const pitSide = (info.nx*(-info.dirY)+info.ny*(info.dirX))<0;
  const inPitApron = pitSide && (info.s>track.length-PIT_LANE_LEN||info.s<PIT_EXIT) && info.dist<track.roadHalf+PIT_BOX_EXTRA+40;
  car.boxRow = pitSide && (info.s>track.length-PIT_RANGE||info.s<150) && info.dist>track.roadHalf+95;
  car.inPitLane = pitSide && (info.s>track.length-PIT_LANE_LEN||info.s<PIT_EXIT) && info.dist>track.roadHalf*0.4;
  // TEMBOK PIT: flag zona pembatas di offset roadHalf+15 (length-800 s/d merge-350).
  // Entry + corong (gerbang → length-800) memang bolong — manuver masuk selesai di sana.
  car._wallZone = (info.s>track.length-800||info.s<PIT_EXIT-350)
    && Math.abs(info.dist-(track.roadHalf+15))<13;
  car.inPitLane = pitSide && (info.s>track.length-PIT_LANE_LEN||info.s<PIT_EXIT) && info.dist>track.roadHalf*0.4;
  car.inPitLane = pitSide && (info.s>track.length-PIT_RANGE||info.s<150) && info.dist>track.roadHalf*0.4;
  const off=offRaw && !inPitApron;
  car.offroad=off;
  car.surface = off?'GRAVEL':(onKerb?'KERB':'ASPHALT');

  // --- SIFAT FISIKA ---
  const fx=Math.cos(car.angle), fy=Math.sin(car.angle);   // arah moncong
  const rx=-fy, ry=fx;                                     // normal kiri
  let vF=car.vx*fx+car.vy*fy;                              // kecepatan maju (bisa negatif)
  let vL=car.vx*rx+car.vy*ry;                              // kecepatan lateral (slide)
  const spd=Math.abs(vF);
  const handbrake = !!inp.handbrake;

  // mesin + rem + hambatan (damage menurunkan power, ban botak menambah drag)
  const dmg = car.damage||0;
  const tireW = car.ai ? (car.ai.tire||0) : (car.tire||0);
  const accel=(360)*(1-dmg*0.7), brakeP=780;
  const drag=0.32 + tireW*0.25 + (off?1.2:0) + (onKerb?0.15:0);
  vF += (inp.throttle*accel - Math.sign(vF)*inp.brake*brakeP*(spd>5?1:0) - vF*drag)*dt;
  if(inp.brake>0.2 && spd<8 && !inp.throttle) vF*=Math.max(0,1-6*dt); // berhenti total
  // serempet tembok pit: drag + bunga api + getar setir
  car.wallScrape = car._wallZone && spd>100;
  if(car.wallScrape){
    vF *= Math.max(0,1-1.5*dt);
    car.spin = (car.spin||0) + (Math.random()-0.5)*0.8;
    if(Math.random()<0.4) state.particles.push({x:car.x,y:car.y,vx:(Math.random()-0.5)*120,vy:(Math.random()-0.5)*120,life:0.4,t:0,color:'#ffdd44',r:2+Math.random()*2});
  }

  // grip lateral per permukaan + downforce + handbrake + power-slide + lock-up + kompon ban
  const wetNow = state.wx ? state.wx.wet : 0;
  let grip = off?3.1 : (onKerb?4.6 : 7.3);
  grip *= (1+Math.min(0.35, spd/1500));                    // downforce: makin cepat makin nempel
  grip *= compoundGrip(car.compound||'slick', wetNow);     // salah ban = melambat
  if(handbrake) grip*=0.32;                                // rem tangan = buang belakang
  const throt = inp.throttle||0;
  if(throt>0.3) grip *= (1 - throt*0.20*Math.max(0,1-spd/420)); // bejek gas di speed rendah = power-slide
  car.lockup = (inp.brake||0)>0.7 && spd>300 && !handbrake; // ban ngunci: selip + asap
  if(car.lockup){
    grip*=0.85;
    if(Math.random()<0.5) state.particles.push({x:car.x-Math.cos(car.angle)*10+(Math.random()-0.5)*16,y:car.y-Math.sin(car.angle)*10+(Math.random()-0.5)*16,vx:(Math.random()-0.5)*30,vy:(Math.random()-0.5)*30,life:0.5,t:0,color:'rgba(200,200,200,.5)',r:3+Math.random()*4,smoke:true});
  }
  if(car.ai) grip*=1.06*(car.ai.tire?(1-car.ai.tire*0.12):1);
  else {
    // ban player juga aus (rate sama dengan AI agar adil). Wet di kering = overheat 3x.
    if(state.mode==='race'||state.mode==='champ')
      car.tire=Math.min(1,(car.tire||0)+dt*(0.0055+Math.abs(inp.steer||0)*0.003+(car.drifting?0.022:0)+(car.lockup?0.020:0)+(off?0.015:0)+((car.compound==='wet'&&wetNow<0.3)?0.020:0))*1.0);
    if(car.tire) grip*=(1-car.tire*0.12);
    if(car.drifting) grip*=0.97;
  }
  vL *= Math.exp(-grip*dt);                                // gesekan ban: bunuh slide

  // yaw: understeer natural di kecepatan tinggi + weight transfer
  const dir = vF>=0?1:-1;
  const under = 1/(1+Math.pow(spd/560,2)*1.6);              // >~400 mulai understeer
  const authority = Math.max(0.5,Math.min(1,spd/150));
  const transfer = 1 + (inp.brake||0)*0.28 - (inp.throttle||0)*0.12 + (handbrake?0.35:0);
  const maxYaw = (off?1.7:2.6)*under*authority*transfer;
  car.angle += inp.steer*maxYaw*dir*dt;
  // ban botak >50% + kencang = setir bergetar (kerasa + kelihatan)
  if(tireW>0.5 && spd>200) car.angle += (Math.random()-0.5)*tireW*0.035;
  if(onKerb && spd>250 && Math.random()<0.10) car.spin=(car.spin||0)+(Math.random()-0.5)*1.4; // kerb menendang setir
  if(car.spin){ car.angle += car.spin*dt; car.spin*=Math.max(0,1-3.5*dt); if(Math.abs(car.spin)<0.05)car.spin=0; }

  // susun ulang velocity dari heading BARU (ini yang bikin drift kelihatan: mobil meluncur tidak searah moncong)
  const nfx=Math.cos(car.angle), nfy=Math.sin(car.angle);
  const nrx=-nfy, nry=nfx;
  // pertahankan sebagian lateral lama (diproyeksikan) → slide natural
  const keepL = vL;
  car.vx = nfx*vF + nrx*keepL;
  car.vy = nfy*vF + nry*keepL;

  // batas top speed efektif (ban botak -16%)
  const topEff = car.topSpeed*(1-dmg*0.5)*(car.isPlayer&&car.tire?(1-car.tire*0.16):1)*(off?0.62:(onKerb?0.92:1));
  const fNow = car.vx*nfx+car.vy*nfy;
  if(fNow>topEff){ const ex=fNow-topEff; car.vx-=nfx*ex; car.vy-=nfy*ex; vF=topEff; }
  // LIMITER pit: semua mobil di jalur pit dibatasi 140 (termasuk player)
  if(car.inPitLane && fNow>PIT_SPEED){ const exP=fNow-PIT_SPEED; car.vx-=nfx*exP; car.vy-=nfy*exP; }
  if(fNow<-120){ const ex=fNow+120; car.vx-=nfx*ex; car.vy-=nfy*ex; vF=-120; }

  car.x += car.vx*dt; car.y += car.vy*dt;
  car.speed = car.vx*nfx+car.vy*nfy; // kompatibel AI/HUD (forward speed)
  car.drifting = Math.abs(keepL)>70 && Math.abs(vF)>200;
  car.gForce = Math.abs((inp.steer||0)*vF*maxYaw)/290;
  car.slipAngle = Math.atan2(keepL, Math.abs(vF)+1);

  // jejak selip
  if(car.drifting && state.skids && state.skids.length<600){
    state.skids.push({x:car.x,y:car.y,a:car.angle,t:0});
  }
  // lap / progress
  const s2=trackClosest(track,car.x,car.y).s;
  let ds=s2-car.lastS;
  if(ds<-track.length/2) ds+=track.length; // lewat garis start
  if(ds>track.length/2) ds-=track.length;  // mundur lewat garis
  if(car.speed>-5){ car.totalS+=Math.max(0,ds); }
  if(ds>0 && car.lastS>track.length-830 && s2<830){
    car.lap++;
  }
  car.lastS=s2; car.s=s2;
  if(car.missCd>0)car.missCd-=dt;
  if(car.crashCd>0)car.crashCd-=dt;
  if(car.hitCd>0)car.hitCd-=dt;
}

// PIT STOP: berhenti di box sendiri 2.5s → ban fresh + damage dipulihkan 75%
function pitUpdate(car, track, dt){
  if(state.mode!=='race'&&state.mode!=='champ'&&state.mode!=='pittest') return;
  if(car.pitSlot===undefined) return;
  const info=trackClosest(track,car.x,car.y);
  const onRight=(info.nx*(-info.dirY)+info.ny*(info.dirX))<0;
  const inZone=(info.s>track.length-PIT_RANGE||info.s<150);
  car.inPit = onRight && inZone && info.dist>track.roadHalf*0.4;
  let dsBox=pitSlotS(track,car.pitSlot)-info.s;
  if(dsBox<-track.length/2)dsBox+=track.length;
  if(dsBox>track.length/2)dsBox-=track.length;
  const atBox = car.inPit && Math.abs(dsBox)<80;
  if(!car.pitDone && atBox && Math.abs(car.speed)<35){
    car.pitTimer=(car.pitTimer||0)+dt;
    if(car.pitTimer>=PIT_STOP_TIME){
      if(car.ai)car.ai.tire=0; else car.tire=0;
      car.damage=(car.damage||0)*0.25;
      // ganti kompon sesuai cuaca saat ini (hujan→wet, kering→slick)
      const wetNow = state.wx ? state.wx.wet : 0;
      const newComp = wetNow>0.45 ? 'wet' : 'slick';
      const changed = car.compound!==newComp;
      car.compound=newComp;
      car.pitStops=(car.pitStops||0)+1;
      car.pitTimer=0; car.pitDone=true;
      if(car.ai){car.ai.willPit=false; car.ai.exiting=true;}
      try{AudioSys.pitGun();}catch(e){}
      pushEvent('🔧 '+car.name+' pit stop — ban '+(newComp==='wet'?'HUJAN 🔵':'kering 🟡')+(changed?' (ganti kompon!)':'')+' fresh!');
    }
  } else if(!car.pitDone) car.pitTimer=0;
}

function collisions(cars){  for(let i=0;i<cars.length;i++)for(let j=i+1;j<cars.length;j++){
    const a=cars[i],b=cars[j];
    const dx=b.x-a.x,dy=b.y-a.y,d=Math.hypot(dx,dy);
    if(d<34&&d>0.1){
      if(state.mode==='pittest'&&state.pitTest) state.pitTest.contacts++;
      // JANGKAR PIT: yang lagi servis / pelan di baris box tidak bisa didorong —
      // yang menabrak mental sendiri. (Anti gagal pit gara-gara diseruduk.)
      const anchA = a.pitTimer>0 || (a.ai&&(a.ai.willPit||a.ai.pitBlockT>0) && Math.abs(a.speed)<60 && a.boxRow);
      const anchB = b.pitTimer>0 || (b.ai&&(b.ai.willPit||b.ai.pitBlockT>0) && Math.abs(b.speed)<60 && b.boxRow);
      const nx=dx/d,ny=dy/d;
      if(anchA&&!anchB){ b.x+=nx*(34-d+1); b.y+=ny*(34-d+1); }
      else if(anchB&&!anchA){ a.x-=nx*(34-d+1); a.y-=ny*(34-d+1); }
      else { const ov=(34-d)/2+0.5; a.x-=nx*ov;a.y-=ny*ov;b.x+=nx*ov;b.y+=ny*ov; }
      // ZONA PIT = wilayah hati-hati, TAPI hanya jika salah satunya memang urusan pit
      // (mau masuk/servis). Duel murni di trek lurus tetap fisika penuh.
      const pitBusy = (a.ai&&a.ai.willPit)||a.pitTimer>0||(b.ai&&b.ai.willPit)||b.pitTimer>0;
      if(a.pitZone&&b.pitZone&&pitBusy){
        if((a.hitCd||0)<=0&&(b.hitCd||0)<=0){ a.hitCd=0.25; b.hitCd=0.25; }
        if(a.isPlayer)a.missCd=0.5; if(b.isPlayer)b.missCd=0.5;
        continue;
      }
      // kecepatan HANYA dihitung ulang saat cooldown habis — ini fix bug berhenti tiba-tiba
      // (dulu: speed *= 0.78 TIAP FRAME selama nempel → 10 frame = speed tinggal 8%)
      if((a.hitCd||0)>0||(b.hitCd||0)>0) continue;
      a.hitCd=0.25; b.hitCd=0.25;
      // fisika impuls 2D: massa sama, restitusi 0.55 (mental, tidak nempel)
      for(const c of [a,b]) if(c.vx===undefined){c.vx=Math.cos(c.angle)*c.speed;c.vy=Math.sin(c.angle)*c.speed;c.damage=c.damage||0;}
      const rvx=b.vx-a.vx, rvy=b.vy-a.vy;
      const vn=rvx*nx+rvy*ny; // <0 = mendekat
      const rel=Math.abs(a.speed-b.speed);
      const impact=Math.abs(Math.min(0,vn));
      if(vn<0){
        const j=-(1+0.55)*vn/2;
        a.vx-=j*nx; a.vy-=j*ny; b.vx+=j*nx; b.vy+=j*ny;
        // gesekan tangensial kecil
        a.vx*=0.985; a.vy*=0.985; b.vx*=0.985; b.vy*=0.985;
        // spin dari tabrakan off-center (lebih kerasa)
        const offC=Math.max(-1,Math.min(1,((b.x-a.x)*(-ny)+(b.y-a.y)*nx)/34));
        a.spin=(a.spin||0)-offC*impact/110; b.spin=(b.spin||0)+offC*impact/110;
        // damage: hantaman >180 mulai merusak (top speed & power turun)
        if(impact>180){
          a.damage=Math.min(0.5,(a.damage||0)+impact/3500);
          b.damage=Math.min(0.5,(b.damage||0)+impact/3500);
        }
        // sinkronkan scalar forward
        for(const c of [a,b]){c.speed=c.vx*Math.cos(c.angle)+c.vy*Math.sin(c.angle);}
      }
      // EFEK TABRAKAN: percikan + debris + goyang + spin + suara (skala dgn kerasnya)
      if(rel>60||impact>120){
        const mx=(a.x+b.x)/2, my=(a.y+b.y)/2;
        const hard=Math.max(rel,impact);
        const n = Math.min(30, 8+Math.floor(hard/20));
        for(let k=0;k<n;k++){
          const an=Math.random()*Math.PI*2, sp=80+Math.random()*hard*1.1;
          const kind=Math.random();
          state.particles.push({x:mx,y:my,vx:Math.cos(an)*sp,vy:Math.sin(an)*sp,life:0.5+Math.random()*0.6,t:0,
            color: kind<0.4?'#ffdd44':(kind<0.7?'#ff6b35':(kind<0.85?'#333':'#e74c3c')), r:2+Math.random()*3.5});
        }
        // asap
        for(let k=0;k<8;k++) state.particles.push({x:mx,y:my,vx:(Math.random()-0.5)*50,vy:(Math.random()-0.5)*50-20,life:1.0,t:0,color:'rgba(200,200,200,.6)',r:5+Math.random()*7,smoke:true});
        state.shake = Math.min(20, 5 + hard/28);
        crashSound(hard);
        if(a.isPlayer||b.isPlayer) state.flash=Math.min(1,0.35+hard/600); // layar merah sekilas
        if(hard>140){
          flashMsg('💥 CRASH! '+a.name+' vs '+b.name);
          pushEvent('💥 '+a.name+' & '+b.name+' bersenggolan!');
        }
      }
      // hitung crash untuk traffic
      if(state.mode==='traffic'&&(a.isPlayer||b.isPlayer)){
        const p=a.isPlayer?a:b;
        if(p.crashCd<=0&&rel>80){ state.traffic.crash++; p.crashCd=1.5; flashMsg('TABRAKAN! '+state.traffic.crash+'/3'); if(state.traffic.crash>=3) endGame(); }
      }
      // near-miss cooldown reset kalau senggolan = bukan near miss
      if(a.isPlayer)a.missCd=0.5; if(b.isPlayer)b.missCd=0.5;
    }
  }
}

function checkNearMiss(player,cars){
  if(player.missCd>0||player.crashCd>0) return;
  const ca=Math.cos(player.angle),sa=Math.sin(player.angle);
  for(const o of cars){
    if(o===player)continue;
    const dx=o.x-player.x,dy=o.y-player.y,d=Math.hypot(dx,dy);
    if(d<95&&d>36){
      const fwd=(dx*ca+dy*sa);
      if(fwd>10&&Math.abs(-dx*sa+dy*ca)<42&&(player.speed-o.speed)>110){
        state.traffic.near++; state.traffic.score+=150;
        player.missCd=1.2; flashMsg('NEAR MISS +150'); break;
      }
    }
  }
}

let msgT=0;
function flashMsg(t){ const el=document.getElementById('msg'); el.textContent=t; el.style.opacity=1; msgT=1.4; }

// suara crash: lewat master audio (mute berlaku), fallback sintetis lama
let AC=null;
function crashSound(rel){
  try{ if(AudioSys.crash(rel)) return; }catch(e){}
  try{
    AC = AC || new (window.AudioContext||window.webkitAudioContext)();
    if(AC.state==='suspended')AC.resume();
    const dur=0.18+Math.min(0.25,rel/1500);
    const buf=AC.createBuffer(1,AC.sampleRate*dur,AC.sampleRate);
    const d=buf.getChannelData(0);
    for(let i=0;i<d.length;i++) d[i]=(Math.random()*2-1)*Math.pow(1-i/d.length,2);
    const src=AC.createBufferSource(); src.buffer=buf;
    const f=AC.createBiquadFilter(); f.type='lowpass'; f.frequency.value=900+rel*3;
    const g=AC.createGain(); g.gain.value=Math.min(0.5,0.15+rel/900);
    src.connect(f);f.connect(g);g.connect(AC.destination);src.start();
  }catch(e){}
}

function updateParticles(dt){
  for(let i=state.particles.length-1;i>=0;i--){
    const p=state.particles[i]; p.t+=dt;
    if(p.t>=p.life){state.particles.splice(i,1);continue;}
    p.x+=p.vx*dt; p.y+=p.vy*dt; p.vx*=0.96; p.vy*=0.96;
  }
  for(let i=(state.skids||[]).length-1;i>=0;i--){
    state.skids[i].t+=dt;
    if(state.skids[i].t>7) state.skids.splice(i,1);
  }
  if(state.shake>0) state.shake=Math.max(0,state.shake-dt*26);
  if(state.flash>0) state.flash=Math.max(0,state.flash-dt*1.8);
}

// feed komentator: dorong event, tampil 4 terakhir, kedaluwarsa 7 detik
function pushEvent(text){
  state.events.push({text, t:0});
  if(state.events.length>4) state.events.shift();
  renderFeed();
}
function renderFeed(){
  const el=document.getElementById('feed');
  if(!el) return;
  el.innerHTML=state.events.map(e=>`<div>${e.text}</div>`).join('');
}

// hitung salip antar AI (tukar posisi) untuk HUD + rasa balapan hidup
function detectOvertakes(){
  const st=standings();
  const order=st.map(c=>c.name).join('|');
  if(state.lastOrder && state.lastOrder.length){
    for(let i=0;i<st.length;i++){
      const prevIdx=state.lastOrder.indexOf(st[i].name);
      if(prevIdx>i+0 && prevIdx-i>=1 && state.time>3){
        // naik posisi
        if(st[i].isPlayer|| (state.lastOrder[i]!==st[i].name)) {
          state.overtakes++;
          const msg='⚡ '+st[i].name+' salip ke P'+(i+1);
          if(state.mode!=='traffic'){ flashMsg(msg); pushEvent(msg); }
          break;
        }
      }
    }
  }
  state.lastOrder=st.map(c=>c.name);
}

// komentari kesalahan AI saat terjadi (lock-up / melebar) + asap rem
function watchDrama(dt){
  for(const c of state.cars){
    if(c.ai){
    const m = c.ai.mistakeT>0;
    if(m && !c.ai.wasMistake){
      const kind = Math.random();
      if(kind<0.35){
        pushEvent('🔒 '+c.name+' lock-up! Asap keluar di tikungan');
        for(let k=0;k<8;k++) state.particles.push({x:c.x,y:c.y,vx:(Math.random()-0.5)*60,vy:(Math.random()-0.5)*60,life:0.8,t:0,color:'rgba(220,220,220,.55)',r:5+Math.random()*5,smoke:true});
      } else if(kind<0.6){
        pushEvent('〰️ '+c.name+' melebar, keluar jalur ideal');
      } else if(kind<0.75 && c.ai.tire>0.55){
        pushEvent('🛞 Ban '+c.name+' habis ('+Math.round(c.ai.tire*100)+'%) — melambat!');
      }
    }
    c.ai.wasMistake = m;
    }
    // lap timing + fastest lap (semua mobil termasuk player — untuk bonus FL kejuaraan)
    if(c.prevLap===undefined){c.prevLap=c.lap;c.lapStart=state.time;}
    if(c.lap>(c.prevLap||0)){
      const lt=state.time-(c.lapStart||state.time);
      c.lastLapTime=lt; c.lapStart=state.time; c.prevLap=c.lap;
      if(state.mode==='quali'&&lt>5&&(c.qualiBest===null||c.qualiBest===undefined||lt<c.qualiBest)) c.qualiBest=lt;
      if(lt>5 && (!state.bestLap || lt<state.bestLap.t)){
        state.bestLap={t:lt, by:c.name};
        pushEvent('🟣 Fastest lap '+c.name+': '+lt.toFixed(1)+'s');
      }
    }
  }
  for(let i=state.events.length-1;i>=0;i--){
    state.events[i].t+=dt;
    if(state.events[i].t>8){state.events.splice(i,1);renderFeed();}
  }
}

function standings(){
  return [...state.cars].sort((a,b)=>(b.lap*1e7+b.totalS)-(a.lap*1e7+a.totalS));
}

// ===== KEJUARAAN: 5 ronde trek sulit, 3 lap tiap ronde, poin F1 + bonus fastest lap =====
const CHAMP_ROUNDS = [1, 3, 2, 5, 4]; // Naga → Gunung → Kota → Lembah Ular → Endurance (final)
const CHAMP_POINTS = [25, 18, 15, 12, 10, 8];
const CHAMP_LAPS = 3;

function startChamp(){
  state.champ = { round: 0, pts: {}, wins: {}, flBonus: {}, aiOnly: false };
  startChampQuali();
}
// Kualifikasi sebelum tiap ronde championship (player). AI-only langsung balap (grid acak).
function startChampQuali(){
  state.trackIdx = CHAMP_ROUNDS[state.champ.round];
  startQuali('champ');
  applyChampCondition();
  if(state.champ.round>0) pushEvent('🔄 Kondisi mobil ronde lalu kebawa (ban + damage)');
}
// Kejuaraan AI penuh (tanpa player): 5 ronde, otomatis finis saat pemimpin 3 lap.
function startAIChamp(){
  state.champ = { round: 0, pts: {}, wins: {}, flBonus: {}, aiOnly: true };
  startChampRound();
}
function startChampRound(){
  const ch = state.champ;
  const withPlayer = !ch.aiOnly;
  state.trackIdx = CHAMP_ROUNDS[ch.round];
  state.mode = 'champ';
  state.time = 0; state.finished = false; state.results = [];
  state.laps = CHAMP_LAPS;
  state.traffic = { score: 0, near: 0, crash: 0, best: +(localStorage.getItem('trafficBest') || 0) };
  state.cars = withPlayer ? placeGrid(TRACKS[state.trackIdx], 5, true, 'race')
                          : placeGrid(TRACKS[state.trackIdx], state.aiCount || 6, false, 'aivai');
  const f = state.cars[0]; state.cam.x = f.x; state.cam.y = f.y;
  state.specIdx = 0;
  state.particles = []; state.shake = 0; state.flash = 0; state.overtakes = 0; state.lastOrder = []; state.skids = [];
  state.events = []; state.bestLap = null; state.countdown = 3.6; state.pitWarned = false;
  for (const c of state.cars) { c.prevLap = 0; c.lapStart = 0; c.lastLapTime = null; }
  resetWeather();
  applyChampCondition();
  pushEvent('🏆 Ronde ' + (ch.round + 1) + '/5: ' + TRACKS[state.trackIdx].name + ' — 3 lap' + (ch.aiOnly ? ' (AI penuh)' : ''));
  state.screen = 'play';
  document.getElementById('menu').style.display = 'none';
  document.getElementById('hud').style.display = 'flex';
  document.getElementById('over').style.display = 'none';
  updateHudLabels();
}
// CUACA DINAMIS: cerah ↔ gerimis ↔ hujan. wet 0 kering — 1 banjir (naik saat hujan, kering perlahan).
function resetWeather(){
  const r=Math.random();
  state.wx = r<0.62 ? {cond:'cerah',wet:0,timer:40+Math.random()*40}
    : r<0.85 ? {cond:'gerimis',wet:0.25,timer:30+Math.random()*30}
    : {cond:'hujan',wet:0.6,timer:30+Math.random()*30};
  setCompoundByWeather();
  const icon = state.wx.cond==='hujan'?'🌧':(state.wx.cond==='gerimis'?'🌦':'☀️');
  pushEvent(icon+' Cuaca start: '+state.wx.cond+' (basah '+Math.round(state.wx.wet*100)+'%)');
}
function setCompoundByWeather(){
  const wetComp = state.wx.wet>0.5 ? 'wet' : 'slick';
  for(const c of state.cars) c.compound = wetComp;
}
function updateWeather(dt){
  const wx=state.wx;
  wx.timer-=dt;
  if(wx.timer<=0){
    const r=Math.random();
    if(wx.cond==='cerah'){ wx.cond = r<0.7?'cerah':(r<0.9?'gerimis':'hujan'); }
    else if(wx.cond==='gerimis'){ wx.cond = r<0.5?'cerah':(r<0.8?'gerimis':'hujan'); }
    else { wx.cond = r<0.55?'gerimis':(r<0.85?'hujan':'cerah'); }
    wx.timer=45+Math.random()*45; // 45-90 detik per fase — perubahan terasa bertahap
    pushEvent((wx.cond==='hujan'?'🌧':(wx.cond==='gerimis'?'🌦':'☀️'))+' Cuaca berubah: '+wx.cond+'!');
  }
  if(wx.cond==='hujan') wx.wet=Math.min(1,wx.wet+dt*0.012);       // 0→banjir ±80 detik
  else if(wx.cond==='gerimis') wx.wet=Math.min(1,wx.wet+dt*0.004);
  else wx.wet=Math.max(0,wx.wet-dt*0.006);                        // mengering ±2.5 menit
}
function applyChampCondition(){
  const ch = state.champ;
  if(!ch || !ch.condition) return;
  for(const c of state.cars){
    const s = ch.condition[c.name];
    if(!s) continue;
    if(c.ai) c.ai.tire = Math.min(0.85, s.tire);
    else c.tire = Math.min(0.85, s.tire);
    c.damage = Math.min(0.35, s.damage);
  }
}

function champTableHTML(){
  const ch = state.champ;
  const rows = Object.keys(ch.pts).map(name => {
    const car = state.cars.find(c => c.name === name);
    const tag = name === 'KAMU' ? '(kamu)' : (car && car.brain ? car.brain.icon + ' ' + car.brain.label : '');
    const cond = (ch.condition && ch.condition[name]) ? ` <small>🛞${Math.round(ch.condition[name].tire*100)} 🛠${Math.round(ch.condition[name].damage*100)}</small>` : '';
    return { name, pts: ch.pts[name], wins: ch.wins[name] || 0, tag, cond };
  }).sort((a, b) => b.pts - a.pts || b.wins - a.wins);
  return '<table class="ctable"><tr><th>#</th><th>Pembalap</th><th>Menang</th><th>Poin</th></tr>' +
    rows.map((r, i) => `<tr class="${r.name === 'KAMU' ? 'me' : ''}${i === 0 ? ' lead' : ''}"><td>${i + 1}</td><td>${r.name} ${r.tag}${r.cond}</td><td>${r.wins}</td><td><b>${r.pts}</b></td></tr>`).join('') + '</table>';
}
function endChampRound(){
  const ch = state.champ;
  // KONDISI MOBIL DIWARISKAN antar ronde: ban + damage akhir ronde ini = awal ronde depan.
  // (Inilah yang bikin pit stop penting: hemat mobil di ronde 1, enak di ronde 5.)
  ch.condition = {};
  for(const c of state.cars) ch.condition[c.name] = { tire: c.ai ? (c.ai.tire||0) : (c.tire||0), damage: c.damage||0 };
  // WAJIB PIT 1x: yang tidak pit didiskualifikasi ke belakang (urutan tetap di antara sesama DSQ)
  const raw = standings();
  const st = raw.filter(c=>(c.pitStops||0)>0).concat(raw.filter(c=>!(c.pitStops>0)));
  const roundPts = {};
  st.forEach((c, i) => {
    const p = (CHAMP_POINTS[i] || 0);
    ch.pts[c.name] = (ch.pts[c.name] || 0) + p;
    roundPts[c.name] = p;
    if (i === 0) ch.wins[c.name] = (ch.wins[c.name] || 0) + 1;
  });
  // bonus +1 fastest lap ronde ini
  if (state.bestLap) {
    ch.pts[state.bestLap.by] = (ch.pts[state.bestLap.by] || 0) + 1;
    ch.flBonus[state.bestLap.by] = (ch.flBonus[state.bestLap.by] || 0) + 1;
    roundPts[state.bestLap.by] = (roundPts[state.bestLap.by] || 0) + 1;
  }
  // ronde champ juga menabung poin musim (hanya poin ronde ini, bukan kumulatif)
  seasonAdd(roundPts);
  state.finished = true;
  const ov = document.getElementById('over');
  ov.style.display = 'flex';
  const lastRound = ch.round >= CHAMP_ROUNDS.length - 1;
  let html = '<h2>🏁 Ronde ' + (ch.round + 1) + '/5 — ' + TRACKS[state.trackIdx].name + '</h2><p><small>🔧 Wajib pit 1x ' + (st.some(c=>!(c.pitStops>0)) ? '— ⚠️ DSQ: ' + st.filter(c=>!(c.pitStops>0)).map(c=>c.name).join(', ') : '— semua pit ✅') + '</small></p><ol>' +
    st.map((c, i) => `<li>${i + 1}. ${c.name} ${c.isPlayer ? '(kamu)' : ''} <b>+${CHAMP_POINTS[i] || 0}</b>${state.bestLap && state.bestLap.by === c.name ? ' 🟣+1' : ''}${!(c.pitStops>0)?' ⚠️tanpa pit':''} <small>(${c.pitStops||0}x pit)</small></li>`).join('') + '</ol>';
  html += '<h3>Klasemen Kejuaraan</h3>' + champTableHTML();
  if (lastRound) {
    const champ = Object.keys(ch.pts).sort((a, b) => ch.pts[b] - ch.pts[a])[0];
    const meChamp = champ === 'KAMU';
    try {
      const hist = JSON.parse(localStorage.getItem('champHistory') || '[]');
      hist.unshift({ champ, pts: ch.pts[champ], date: new Date().toISOString().slice(0, 10), aiOnly: !!ch.aiOnly });
      localStorage.setItem('champHistory', JSON.stringify(hist.slice(0, 10)));
    } catch (e) {}
    const myPos = ch.aiOnly ? '' : ' — kamu P' + (Object.keys(ch.pts).sort((a, b) => ch.pts[b] - ch.pts[a]).indexOf('KAMU') + 1);
    html += `<h2>${meChamp ? '🏆 KAMU JUARA DUNIA No.1! 🏆' : '🏆 Juara' + (ch.aiOnly ? ' AI' : '') + ': ' + champ + myPos} 🏆</h2>`;
    html += `<div class="row"><button onclick="backToMenu()">Menu</button><button onclick="${ch.aiOnly ? 'startAIChamp' : 'startChamp'}()">Main Lagi</button></div>`;
  } else {
    html += `<div class="row"><button onclick="backToMenu()">Menu</button><button onclick="champNext()">Ronde ${ch.round + 2} →</button></div>`;
  }
  ov.innerHTML = html;
}
window.champNext = () => { state.champ.round++; if(state.champ.aiOnly) startChampRound(); else startChampQuali(); };
window.startChamp = startChamp;
window.startAIChamp = startAIChamp;

function endGame(){
  state.finished=true;
  const ov=document.getElementById('over');
  ov.style.display='flex';
  let html='';
  if(state.mode==='race'){
    const st=standings();
    const pts={};
    st.forEach((c,i)=>{ pts[c.name]=(pts[c.name]||0)+(CHAMP_POINTS[i]||0); });
    seasonAdd(pts);
    const season=seasonGet();
    html='<h2>Hasil Balap — '+TRACKS[state.trackIdx].name+'</h2><ol>'+st.map((c,i)=>`<li>${i+1}. ${c.name} ${c.isPlayer?'(kamu)':(c.brain?c.brain.icon+' '+c.brain.label:'')} — Lap ${Math.min(c.lap+1,state.laps)}/${state.laps} <b>+${CHAMP_POINTS[i]||0}</b></li>`).join('')+'</ol>';
    html+=`<p><small>Poin musim: ${Object.keys(season).sort((a,b)=>season[b]-season[a]).slice(0,3).map(n=>n+' '+season[n]).join(' • ')}</small></p>`;
  } else if(state.mode==='champ'){
    endChampRound(); return;
  } else if(state.mode==='traffic'){
    if(state.traffic.score>state.traffic.best){localStorage.setItem('trafficBest',state.traffic.score);state.traffic.best=state.traffic.score;}
    html=`<h2>Lalu Lintas Selesai</h2><p>Skor: <b>${Math.floor(state.traffic.score)}</b> | Near-miss: ${state.traffic.near} | Best: ${Math.floor(state.traffic.best)}</p>`;
  } else {
    const st=standings();
    html='<h2>AI vs AI — Klasemen</h2><ol>'+st.map((c,i)=>`<li>${i+1}. ${c.brain?c.brain.icon+' ':''}${c.name} <small>(${c.brain?c.brain.label:'?'})</small></li>`).join('')+'</ol><p><small>🧠 Taktisi • 🤬 Mad Dog • 📐 Profesor • 🛡️ Tukang Blok • 🍼 Rookie • 🌪️ Pemburu Draft</small></p>';
  }
  html+=`<div class="row"><button onclick="backToMenu()">Menu</button><button onclick="restart()">Ulangi</button></div>`;
  ov.innerHTML=html;
}
function champPosOf(name){
  if(!state.champ) return '-';
  const order=Object.keys(state.champ.pts).sort((a,b)=>state.champ.pts[b]-state.champ.pts[a]);
  return (order.indexOf(name)+1)||'-';
}
window.backToMenu=()=>{state.champ=null;state.afterQuali=null;state.qualiOrder=null;state.screen='menu';document.getElementById('menu').style.display='flex';document.getElementById('hud').style.display='none';document.getElementById('over').style.display='none';};
window.restart=()=>{ if(state.mode==='champ') startChampRound(); else if(state.mode==='quali') startQuali(state.afterQuali||'race'); else if(state.mode==='pittest') startPitTest(); else startGame(state.mode); };

// ---- loop ----
let last=performance.now();
function loop(t){
  requestAnimationFrame(loop);
  const rawDt=Math.min(0.05,(t-last)/1000); last=t;
  let dt=Math.min(0.033,rawDt);
  if(state.screen!=='play'||state.finished){ render(dt); return; }
  const track=TRACKS[state.trackIdx];
  state.time+=dt;
  if(state.mode!=='traffic') updateWeather(dt);
  for(const c of state.cars) c.wet = state.wx.wet;
  // speed multiplier utk mode spectate (tombol + / -)
  let mult=1;
  if(keys['+']||keys['='])mult=2; if(keys['-']||keys['_'])mult=0.5;
  dt*=mult;
  // START LIGHTS: tahan semua mobil + bel per detik → GO!
  if(state.countdown>0){
    const c=Math.ceil(state.countdown);
    if(state.cdLast!==c){ state.cdLast=c; try{AudioSys.beep(440,0.15);}catch(e){} }
    state.countdown-=rawDt;
    if(state.countdown<=0){ try{AudioSys.beep(880,0.5);}catch(e){} flashMsg('GO! 🟢'); }
  }

  for(const car of state.cars){
    if(car.isPlayer) playerInput(car);
    else {
      // hitung gap ke pemimpin untuk rubber-band (anti-jomplang)
      const prog = car.lap*track.length+(car.totalS||0);
      let best=-1e18;
      for(const o of state.cars){ const p=o.lap*track.length+(o.totalS||0); if(p>best)best=p; }
      const gap = best-prog;
      const m = state.mode==='traffic'?'traffic':(state.mode==='quali'?'quali':'race');
      car.raceLaps = state.laps;
      updateAI(car,track,state.cars,state.diff+(state.mode==='quali'?0.05:0),dt,m,gap);
    }
    if(state.countdown>0){ car.input.throttle=0; car.input.brake=0.7; car.input.steer=0; }
    stepCar(car,track,dt);
    pitUpdate(car,track,dt);
  }
  collisions(state.cars);
  updateParticles(dt);
  // hujan: tetes di sekitar kamera + semprotan di belakang mobil kencang saat basah
  const wetNow2 = state.wx.wet;
  if(state.mode!=='traffic'&&(state.wx.cond==='gerimis'||state.wx.cond==='hujan')){
    const nD = state.wx.cond==='hujan'?7:3;
    for(let k=0;k<nD;k++) state.particles.push({x:state.cam.x+(Math.random()-0.5)*1800,y:state.cam.y+(Math.random()-0.5)*1200,vx:60,vy:1400,life:0.5,t:0,color:'rgba(170,200,255,.45)',r:2,rain:true});
  }
  // asap drift saat belok tajam kecepatan tinggi
  for(const c of state.cars){
    if(Math.abs(c.input.steer)>0.7 && Math.abs(c.speed)>300 && Math.random()<0.35)
      state.particles.push({x:c.x-Math.cos(c.angle)*16,y:c.y-Math.sin(c.angle)*16,vx:(Math.random()-0.5)*30,vy:(Math.random()-0.5)*30,life:0.6,t:0,color:'rgba(220,220,220,.45)',r:4+Math.random()*4,smoke:true});
    if(wetNow2>0.4 && Math.abs(c.speed)>280 && Math.random()<0.3)
      state.particles.push({x:c.x-Math.cos(c.angle)*20,y:c.y-Math.sin(c.angle)*20,vx:(Math.random()-0.5)*60-40,vy:(Math.random()-0.5)*60,life:0.8,t:0,color:'rgba(200,215,230,.4)',r:3+Math.random()*5,smoke:true});
  }
  if(state.mode!=='traffic' && Math.floor(state.time*2)!==Math.floor((state.time-dt)*2)) detectOvertakes();
  if(state.mode!=='traffic') watchDrama(dt);
  const player=state.cars.find(c=>c.isPlayer);
  if(state.mode==='traffic'&&player){ state.traffic.score+=Math.max(0,player.speed)*dt*0.12; checkNearMiss(player,state.cars); }
  // peringatan pit untuk player: ban/damage ambang batas → suruh pit duluan
  if(player&&(state.mode==='race'||state.mode==='champ')&&!state.pitWarned&&!player.pitDone){
    const wrongComp = (player.compound!=='wet'&&state.wx.wet>0.55);
    if((player.tire||0)>0.6||(player.damage||0)>0.3||wrongComp){
      state.pitWarned=true;
      flashMsg(wrongComp?'🌧 BUTUH BAN HUJAN — PIT! 🔵':'⚠️ KRITIS — PIT SEKARANG! 🔧');
      pushEvent(wrongComp?'🌧 Slick di hujan = lambat — ganti ban hujan di pit!':'⚠️ Kondisi kritis — masuk pit!');
      try{AudioSys.beep(660,0.3,0.35);}catch(e){}
    }
  }
  // finish balap: player selesaikan laps (race & championship)
  if((state.mode==='race'||state.mode==='champ')&&player&&player.lap>=state.laps) endGame();
  // kualifikasi: finis saat player selesaikan 2 lap
  if(state.mode==='quali'&&player&&player.lap>=state.laps) endQuali();
  // AI vs AI & championship AI: finis otomatis saat pemimpin selesaikan laps
  if(state.mode==='aivai'||(state.mode==='champ'&&!player)){
    const lead=standings()[0];
    if(lead&&lead.lap>=state.laps) endGame();
  }
  // Tes pit: selesai saat semua sudah pit 1x ATAU pemimpin 2 lap
  if(state.mode==='pittest'){
    const lead=standings()[0];
    if(state.cars.every(c=>(c.pitStops||0)>=1)||(lead&&lead.lap>=2)) endPitTest();
  }
  // AI vs AI: tidak auto-end, tombol Akhiri manual. C ganti kamera
  if(state.mode==='aivai'){
    state.specTimer-=dt;
    if(keys['c']&&state.specTimer<=0){state.specIdx=(state.specIdx+1)%state.cars.length;state.specTimer=0.3;keys['c']=false;}
  }
  // kamera
  let focus=player||standings()[0]||state.cars[0];
  if(state.mode==='aivai') focus=state.cars[state.specIdx%state.cars.length];
  const zTarget=(window.innerWidth<700?0.55:0.8);
  state.cam.zoom+=(zTarget-state.cam.zoom)*dt*2;
  state.cam.x+=(focus.x-state.cam.x)*Math.min(1,dt*4);
  state.cam.y+=(focus.y-state.cam.y)*Math.min(1,dt*4);

  if(msgT>0){msgT-=dt;if(msgT<=0)document.getElementById('msg').style.opacity=0;}
  updateHud();
  try{
    const fcous = state.cars.find(c=>c.isPlayer) || standings()[0] || state.cars[0] || {speed:0};
    AudioSys.update(fcous);
    AudioSys.setRain(state.wx.cond==='hujan'?0.14:(state.wx.cond==='gerimis'?0.05:0));
  }catch(e){}
  render(dt);
}

function updateHudLabels(){
  document.getElementById('hTrack').textContent=TRACKS[state.trackIdx].name;
  document.getElementById('hMode').textContent=state.mode==='race'?'Balap':state.mode==='traffic'?'Lalu Lintas':state.mode==='quali'?'⏱️ Kualifikasi':state.mode==='pittest'?'🔧 Tes Pit':state.mode==='champ'?('🏆 R'+(state.champ.round+1)+'/5'):'AI vs AI';
  const wb=document.getElementById('wxBadge');
  if(wb) wb.textContent=(state.wx.cond==='hujan'?'🌧':(state.wx.cond==='gerimis'?'🌦':'☀️'))+' '+Math.round(state.wx.wet*100)+'%';
}
function updateHud(){
  const track=TRACKS[state.trackIdx];
  const player=state.cars.find(c=>c.isPlayer);
  const focus=state.mode==='aivai'?state.cars[state.specIdx%state.cars.length]:player;
  const fcar = focus||{speed:0};
  document.getElementById('hSpeed').textContent=Math.round(Math.abs(fcar.speed||0)*0.28)+' km/h'
    + (fcar.drifting?' 🔥DRIFT':'')
    + (fcar.lockup?' 🔒':'')
    + (fcar.gForce>1.2?(' '+fcar.gForce.toFixed(1)+'G'):'')
    + (fcar.surface&&fcar.surface!=='ASPHALT'?(' '+fcar.surface):'')
    + ((fcar.damage||0)>0.02?(' 🛠'+Math.round(fcar.damage*100)+'%'):'');
  // bar kekuatan (HP) + ban mobil fokus
  const tireV = fcar.ai ? (fcar.ai.tire||0) : (fcar.tire||0);
  const hpV = 1-((fcar.damage||0)*2);
  const bh=document.getElementById('barHp'), bt=document.getElementById('barTire');
  if(bh){ bh.style.width=Math.max(0,Math.min(100,hpV*100))+'%'; bh.style.background=hpV>0.6?'#2ecc71':(hpV>0.3?'#f1c40f':'#e74c3c'); }
  if(bt){ bt.style.width=Math.max(0,Math.min(100,(1-tireV)*100))+'%'; bt.style.background=tireV<0.45?'#3498db':(tireV<0.7?'#f1c40f':'#e74c3c'); }
  const wb=document.getElementById('wxBadge');
  if(wb){
    const wtxt=(state.wx.cond==='hujan'?'🌧':(state.wx.cond==='gerimis'?'🌦':'☀️'))+' '+Math.round(state.wx.wet*100)+'%';
    if(wb.textContent!==wtxt) wb.textContent=wtxt;
  }
  if((state.mode==='race'||state.mode==='champ')&&player){
    const st=standings(); const pos=st.indexOf(player)+1;
    const chTag = state.mode==='champ' ? (' • 🏆P'+(champPosOf('KAMU'))) : '';
    const wear = Math.round(((player.ai?player.ai.tire:player.tire)||0)*100);
    const comp = player.compound==='wet' ? '🔵WET' : '🟡SLICK';
    const pitTag = (player.pitStops>0) ? (' • 🔧x'+player.pitStops) : (state.mode==='champ' ? ' • ⚠️BELUM PIT' : '');
    const boxTag = (player.pitTimer>0) ? (' • 🔧 '+player.pitTimer.toFixed(1)+'s') : '';
    document.getElementById('hInfo').textContent=`Pos ${pos}/${st.length} • Lap ${Math.min(player.lap+1,state.laps)}/${state.laps} • ${comp} 🛞${wear}%${pitTag}${boxTag} • ⚡${state.overtakes}${chTag} • ${state.time.toFixed(1)}s`;
  } else if(state.mode==='traffic'){
  } else if(state.mode==='traffic'){
    document.getElementById('hInfo').textContent=`Skor ${Math.floor(state.traffic.score)} • Near ${state.traffic.near} • Crash ${state.traffic.crash}/3 • Best ${Math.floor(state.traffic.best)}`;
  } else if(state.mode==='quali'&&player){
    const myBest=player.qualiBest?player.qualiBest.toFixed(2)+'s':'-';
    document.getElementById('hInfo').textContent=`Best: ${myBest} • Lap ${Math.min(player.lap+1,state.laps)}/${state.laps} • ${state.time.toFixed(1)}s`;
  } else {
    const st=standings(); const f=state.cars[state.specIdx%state.cars.length];
    const gaps = st.slice(0,3).map((c,i)=>`P${i+1} ${c.name}`).join(' • ');
    document.getElementById('hInfo').textContent=`${gaps} • ⚡${state.overtakes} salip • Fokus: ${f.name} (C=ganti) • ${state.time.toFixed(0)}s`;
    if(keys['enter']){keys['enter']=false;endGame();}
  }
}

// dekorasi per track (dibangkitkan sekali, deterministik)
const decoCache = {};
function getDeco(track, idx){
  const key = idx+'_'+Math.round(track.length);
  if(decoCache[key]) return decoCache[key];
  let seed = idx*999+7;
  const rnd = ()=>{ seed=(seed*16807)%2147483647; return seed/2147483647; };
  const items=[];
  for(let s=0;s<track.length;s+=470){
    const p=trackPointAt(track,s);
    for(const side of [-1,1]){
      if(rnd()<0.55) continue;
      const d=track.roadHalf+60+rnd()*220;
      items.push({ x:p.x+(-p.dirY)*side*d, y:p.y+(p.dirX)*side*d, r:8+rnd()*22, k:rnd(), side });
    }
  }
  decoCache[key]=items; return items;
}

// ---- render ----
function render(){
  const dpr=window.devicePixelRatio||1;
  ctx.setTransform(dpr,0,0,dpr,0,0);
  const vw=canvas.clientWidth,vh=canvas.clientHeight;
  const track=TRACKS[state.trackIdx];
  const th = track.theme||{grass:['#2d6a4f','#2d6a4f'],deco:'trees'};
  if(state.screen==='menu'){ drawTrackPreview(); return; }
  // bg gradasi rumput/asfal kota
  const g=ctx.createLinearGradient(0,0,0,vh);
  g.addColorStop(0,th.grass[0]); g.addColorStop(1,th.grass[1]);
  ctx.fillStyle=g; ctx.fillRect(0,0,vw,vh);
  const z=state.cam.zoom;
  ctx.save();
  // screen shake saat crash
  let shx=0, shy=0;
  if(state.shake>0){ shx=(Math.random()-0.5)*state.shake; shy=(Math.random()-0.5)*state.shake; }
  ctx.translate(vw/2+shx,vh/2+shy);ctx.scale(z,z);ctx.translate(-state.cam.x,-state.cam.y);
  const pts=track.points;
  ctx.lineJoin='round';ctx.lineCap='round';
  const path=()=>{ctx.beginPath();pts.forEach((p,i)=>i?ctx.lineTo(p.x,p.y):ctx.moveTo(p.x,p.y));ctx.closePath();};
  // dekorasi bawah (bayangan run-off di tikungan tajam)
  for(let s=0;s<track.length;s+=330){
    const aa=Math.abs(trackAheadAngle(track,s,710));
    if(aa>0.55){
      const p=trackPointAt(track,s+710);
      ctx.fillStyle='rgba(0,0,0,.12)';
      ctx.beginPath();ctx.arc(p.x,p.y,track.roadHalf+55,0,7);ctx.fill();
    }
  }
  // dekorasi objek (pohon/gedung/batu)
  for(const d of getDeco(track,state.trackIdx)){
    if(th.deco==='city'){
      ctx.fillStyle=d.k>0.5?'#4b4b5e':'#5e5e72';
      ctx.fillRect(d.x-16,d.y-16,32,32);
      ctx.fillStyle='#ffe66d';
      for(let w=0;w<3;w++)for(let h=0;h<3;h++) if((w+h+d.r)%2===0) ctx.fillRect(d.x-12+w*9,d.y-12+h*9,5,5);
    } else if(th.deco==='rocks'){
      ctx.fillStyle='#6b7280';ctx.beginPath();ctx.arc(d.x,d.y,d.r,0,7);ctx.fill();
      ctx.fillStyle='#9ca3af';ctx.beginPath();ctx.arc(d.x-4,d.y-4,d.r*0.6,0,7);ctx.fill();
    } else if(th.deco==='tires'){
      ctx.fillStyle=d.k>0.5?'#c0392b':'#ecf0f1';
      ctx.beginPath();ctx.arc(d.x,d.y,10,0,7);ctx.fill();
      ctx.fillStyle='#222';ctx.beginPath();ctx.arc(d.x,d.y,5,0,7);ctx.fill();
    } else {
      ctx.fillStyle='#1b4332';ctx.beginPath();ctx.arc(d.x,d.y,d.r,0,7);ctx.fill();
      ctx.fillStyle='#2d6a4f';ctx.beginPath();ctx.arc(d.x-3,d.y-3,d.r*0.7,0,7);ctx.fill();
    }
  }
  // kerb merah-putih + aspal + garis tengah
  path();ctx.strokeStyle='#888';ctx.lineWidth=track.roadHalf*2+18;ctx.stroke();
  path();ctx.strokeStyle='#e74c3c';ctx.lineWidth=track.roadHalf*2+10;ctx.setLineDash([40,40]);ctx.stroke();ctx.setLineDash([]);
  path();ctx.strokeStyle='#fff';ctx.lineWidth=track.roadHalf*2+10;ctx.setLineDash([40,40]);ctx.lineDashOffset=40;ctx.stroke();ctx.lineDashOffset=0;ctx.setLineDash([]);
  path();ctx.strokeStyle=th.deco==='city'?'#2b2b35':'#333';ctx.lineWidth=track.roadHalf*2;ctx.stroke();
  // aspal basah: gelap kebiruan + kilap tengah
  if(state.wx.wet>0.05){
    ctx.globalAlpha=Math.min(0.5,state.wx.wet*0.55);
    path();ctx.strokeStyle='#1c2733';ctx.lineWidth=track.roadHalf*2-14;ctx.stroke();
    ctx.globalAlpha=Math.min(0.3,state.wx.wet*0.3);
    path();ctx.strokeStyle='#7fb2d9';ctx.lineWidth=10;ctx.setLineDash([60,90]);ctx.stroke();ctx.setLineDash([]);
    ctx.globalAlpha=1;
  }
  path();ctx.strokeStyle='rgba(255,255,255,.85)';ctx.lineWidth=3;ctx.setLineDash([28,26]);ctx.stroke();ctx.setLineDash([]);
  // papan chevron di tikungan tajam
  ctx.textAlign='center';
  for(let s=0;s<track.length;s+=380){
    const a=trackAheadAngle(track,s,760);
    if(Math.abs(a)>0.6){
      const p=trackPointAt(track,s+760);
      const side=a>0?1:-1;
      const cx=p.x+(-p.dirY)*side*(track.roadHalf+28), cy=p.y+(p.dirX)*side*(track.roadHalf+28);
      ctx.save();ctx.translate(cx,cy);ctx.rotate(Math.atan2(p.dirY,p.dirX));
      ctx.fillStyle='#f1c40f';ctx.fillRect(-22,-12,44,24);
      ctx.fillStyle='#111';ctx.font='bold 16px system-ui';
      ctx.fillText(a>0?'❯❯':'❮❮',0,6);
      ctx.restore();
    }
  }
  // garis start
  const s0=trackPointAt(track,0);
  ctx.save();ctx.translate(s0.x,s0.y);ctx.rotate(Math.atan2(s0.dirY,s0.dirX)+Math.PI/2);
  ctx.fillStyle='#fff';ctx.fillRect(-track.roadHalf,-6,track.roadHalf*2,12);
  ctx.fillStyle='#000';for(let i=0;i<8;i++)for(let j=0;j<2;j++)if((i+j)%2===0)ctx.fillRect(-track.roadHalf+i*(track.roadHalf*2/8),-6+j*6,track.roadHalf*2/8,6);
  ctx.restore();
  // PIT LANE: entry jauh → box → exit lane → merge (tidak motong ke trek)
  if(state.mode==='race'||state.mode==='champ'||state.mode==='pittest'){
    ctx.save();
    ctx.beginPath();
    let first=true;
    for(let s=track.length-PIT_LANE_LEN;s<track.length+PIT_EXIT;s+=80){
      const p=trackPointAt(track,s);
      const cx=p.x+(p.dirY)*(track.roadHalf+PIT_LANE_EXTRA);
      const cy=p.y+(-p.dirX)*(track.roadHalf+PIT_LANE_EXTRA);
      first?ctx.moveTo(cx,cy):ctx.lineTo(cx,cy); first=false;
    }
    ctx.strokeStyle='#555';ctx.lineWidth=100;ctx.stroke();
    ctx.strokeStyle='#fff';ctx.lineWidth=2;ctx.setLineDash([14,14]);ctx.stroke();ctx.setLineDash([]);
    ctx.restore();
    // label entry & exit + gerbang fisik
    // GERBANG ENTRY: tiang + spanduk kotak-kotak melintang jalur pit
    drawPitGate(track, track.length-PIT_LANE_LEN+120, 'PIT ENTRY', '#f1c40f');
    // GERBANG EXIT
    drawPitGate(track, PIT_EXIT-60, 'PIT EXIT', '#2ecc71');
    // PEMBATAS (dinding rendah) antara trek & jalur pit — mulai dekat box, bolong di entry & merge
    ctx.save();
    ctx.beginPath();
    let f2=true;
    for(let s=track.length-800;s<track.length+PIT_EXIT-350;s+=80){
      const p=trackPointAt(track,s);
      const cx=p.x+(p.dirY)*(track.roadHalf+15);
      const cy=p.y+(-p.dirX)*(track.roadHalf+15);
      f2?ctx.moveTo(cx,cy):ctx.lineTo(cx,cy); f2=false;
    }
    ctx.strokeStyle='#aaa';ctx.lineWidth=8;ctx.stroke();
    ctx.strokeStyle='#e74c3c';ctx.lineWidth=8;ctx.setLineDash([24,24]);ctx.stroke();ctx.setLineDash([]);
    ctx.restore();
    ctx.textAlign='center';
    for(const c of state.cars){
      if(c.pitSlot===undefined) continue;
      const bs=pitSlotS(track,c.pitSlot);
      const bp=trackPointAt(track,bs);
      const bx=bp.x+(bp.dirY)*(track.roadHalf+PIT_BOX_EXTRA);
      const by=bp.y+(-bp.dirX)*(track.roadHalf+PIT_BOX_EXTRA);
      ctx.strokeStyle=(c.pitStops>0)?'#2ecc71':'#f1c40f';ctx.lineWidth=3;
      ctx.strokeRect(bx-30,by-18,60,36);
      ctx.fillStyle='#fff';ctx.font='bold 11px system-ui';
      ctx.fillText(c.isPlayer?'PIT':c.name,bx,by-20);
      // progress bar ganti ban
      if(c.pitTimer>0){
        ctx.fillStyle='#000';ctx.fillRect(bx-26,by+20,52,8);
        ctx.fillStyle='#2ecc71';ctx.fillRect(bx-26,by+20,52*Math.min(1,c.pitTimer/PIT_STOP_TIME),8);
      }
    }
  }
  // jejak selip ban (di atas aspal, di bawah mobil)
  if(state.skids) for(const s of state.skids){
    ctx.globalAlpha = Math.max(0, 0.55*(1-s.t/7));
    ctx.fillStyle='#1a1a1a';
    ctx.save(); ctx.translate(s.x,s.y); ctx.rotate(s.a);
    ctx.fillRect(-7,-9,14,3); ctx.fillRect(-7,6,14,3);
    ctx.restore();
  }
  ctx.globalAlpha = 1;
  // mobil
  for(const c of state.cars) drawCar(c);
  // partikel (percikan crash + asap drift)
  for(const p of state.particles){
    const a = 1 - p.t/p.life;
    ctx.globalAlpha = p.smoke ? a*0.6 : a;
    ctx.fillStyle = p.color;
    ctx.beginPath(); ctx.arc(p.x,p.y,p.r*(p.smoke?(1+p.t*2):1),0,7); ctx.fill();
  }
  ctx.globalAlpha = 1;
  ctx.restore();
  // kilat merah saat player tabrakan keras
  if(state.flash>0){
    const fg=ctx.createRadialGradient(vw/2,vh/2,Math.min(vw,vh)/3,vw/2,vh/2,Math.max(vw,vh)/1.2);
    fg.addColorStop(0,'rgba(255,0,0,0)');
    fg.addColorStop(1,'rgba(255,0,0,'+(0.55*state.flash).toFixed(2)+')');
    ctx.fillStyle=fg;ctx.fillRect(0,0,vw,vh);
  }
  // START LIGHTS
  if(state.screen==='play' && !state.finished && state.countdown>0){
    const n=Math.ceil(state.countdown);
    ctx.fillStyle='rgba(0,0,0,.6)';ctx.fillRect(vw/2-90,14,180,44);
    for(let i=0;i<3;i++){
      ctx.beginPath();ctx.arc(vw/2-40+i*40,36,14,0,7);
      ctx.fillStyle=((4-n)>i)?'#ff2222':'#330000';
      ctx.fill();
    }
    if(n<=0){ctx.fillStyle='#00ff66';ctx.font='bold 26px system-ui';ctx.textAlign='center';ctx.fillText('GO!',vw/2,52);}
  }
  drawMini(track);
}

function drawCar(c){
  ctx.save();ctx.translate(c.x,c.y);ctx.rotate(c.angle);
  ctx.shadowColor='rgba(0,0,0,.4)';ctx.shadowBlur=8;ctx.shadowOffsetY=3;
  ctx.fillStyle=c.offroad?'#7f8c8d':c.color;
  const w=38,h=20;
  // bodi + moncong
  ctx.fillRect(-w/2,-h/2,w,h);
  ctx.fillStyle='rgba(0,0,0,.25)';ctx.fillRect(w/2-8,-h/2,8,h); // kap depan
  ctx.shadowColor='transparent';
  ctx.fillStyle='rgba(180,230,255,.9)';ctx.fillRect(2,-h/2+3,8,h-6); // kaca
  ctx.fillStyle='#222';ctx.fillRect(-w/2-2,-h/2-3,6,5);ctx.fillRect(-w/2-2,h/2-2,6,5);
  ctx.fillRect(w/2-4,-h/2-3,6,5);ctx.fillRect(w/2-4,h/2-2,6,5);
  // lampu rem menyala saat ngerem + lampu depan
  if(c.input.brake>0.2){ ctx.fillStyle='#ff2222'; ctx.fillRect(-w/2-4,-h/2+2,3,5); ctx.fillRect(-w/2-4,h/2-7,3,5); }
  ctx.fillStyle='#fff9a0'; ctx.fillRect(w/2,-h/2+3,2,4); ctx.fillRect(w/2,h/2-7,2,4);
  if(c.isPlayer){ctx.strokeStyle='#fff';ctx.lineWidth=2;ctx.strokeRect(-w/2-2,-h/2-2,w+4,h+4);}
  ctx.restore();
  // badge posisi (P1..P6) biar jelas urutannya
  ctx.fillStyle='#fff';ctx.font='12px system-ui';ctx.textAlign='center';
  const pos = standings().indexOf(c)+1;
  const tag = c.isPlayer ? ('P'+pos+' KAMU') : ('P'+pos+' '+c.name+' '+(c.brain?c.brain.icon:''));
  const compTag = (state.mode==='race'||state.mode==='champ') ? (c.compound==='wet'?'🔵':'') : '';
  ctx.fillStyle='rgba(0,0,0,.55)';
  const tw = ctx.measureText(tag+compTag).width+10;
  ctx.fillRect(c.x-tw/2,c.y-34,tw,15);
  ctx.fillStyle = pos===1 ? '#ffd700' : '#fff';
  ctx.fillText(tag+compTag,c.x,c.y-22);
  // mini-bar HP (atas) + ban (bawah) — hanya race/champ
  if(state.mode==='race'||state.mode==='champ'){
    const tv = c.ai?(c.ai.tire||0):(c.tire||0);
    const hv = 1-((c.damage||0)*2);
    ctx.fillStyle='rgba(0,0,0,.55)';ctx.fillRect(c.x-19,c.y+32,38,8);
    ctx.fillStyle=hv>0.6?'#2ecc71':(hv>0.3?'#f1c40f':'#e74c3c');
    ctx.fillRect(c.x-18,c.y+33,36*Math.max(0,Math.min(1,hv)),3);
    ctx.fillStyle=tv<0.45?'#3498db':(tv<0.7?'#f1c40f':'#e74c3c');
    ctx.fillRect(c.x-18,c.y+37,36*Math.max(0,Math.min(1,1-tv)),3);
  }
  if(c.brain && state.cam.zoom>0.5){
    ctx.fillStyle='rgba(0,0,0,.55)';
    const label = c.brain.label;
    const w = ctx.measureText(label).width+10;
    ctx.fillRect(c.x-w/2,c.y+14,w,15);
    ctx.fillStyle='#ffd76d';ctx.font='10px system-ui';
    ctx.fillText(label,c.x,c.y+25);
  }
}

// Gerbang pit: 2 tiang + spanduk garis start + label, melintang di atas jalur pit
function drawPitGate(track, s, label, color){
  const p=trackPointAt(track,s);
  const ang=Math.atan2(p.dirY,p.dirX);
  const cx=p.x+(p.dirY)*(track.roadHalf+60), cy=p.y+(-p.dirX)*(track.roadHalf+60);
  ctx.save();ctx.translate(cx,cy);ctx.rotate(ang);
  ctx.fillStyle='#222';
  ctx.fillRect(-6,-54,12,14); ctx.fillRect(-6,40,12,14); // tiang
  ctx.fillStyle=color;ctx.fillRect(-6,-54,12,108);       // spanduk melintang
  ctx.fillStyle='#fff';
  for(let y=-54;y<54;y+=18)ctx.fillRect(-6,y,12,9);      // strip bendera
  ctx.restore();
  if(label==='PIT ENTRY'){ // con oranye di mulut entry
    ctx.fillStyle='#e67e22';
    const ex=cx-Math.cos(ang)*70, ey=cy-Math.sin(ang)*70;
    const nx2=-Math.sin(ang), ny2=Math.cos(ang);
    ctx.beginPath();ctx.arc(ex+nx2*45,ey+ny2*45,8,0,7);ctx.fill();
    ctx.beginPath();ctx.arc(ex-nx2*45,ey-ny2*45,8,0,7);ctx.fill();
  }
  ctx.fillStyle=color;ctx.font='bold 20px system-ui';ctx.textAlign='center';
  ctx.fillText(label==='PIT ENTRY'?'▼ PIT ENTRY ▼':'▲ PIT EXIT ▲',cx,cy-70);
}

function drawMini(track){
  if(!mctx)return;
  mctx.clearRect(0,0,mini.width,mini.height);
  const xs=track.points.map(p=>p.x),ys=track.points.map(p=>p.y);
  const minX=Math.min(...xs),maxX=Math.max(...xs),minY=Math.min(...ys),maxY=Math.max(...ys);
  const sx=(mini.width-16)/(maxX-minX||1),sy=(mini.height-16)/(maxY-minY||1);
  const s=Math.min(sx,sy);
  const X=x=>(x-minX)*s+8, Y=y=>(y-minY)*s+8;
  mctx.beginPath();track.points.forEach((p,i)=>i?mctx.lineTo(X(p.x),Y(p.y)):mctx.moveTo(X(p.x),Y(p.y)));mctx.closePath();
  mctx.strokeStyle='#fff';mctx.lineWidth=4;mctx.stroke();
  for(const c of state.cars){mctx.fillStyle=c.isPlayer?'#ff0':c.color;mctx.beginPath();mctx.arc(X(c.x),Y(c.y),c.isPlayer?4:3,0,7);mctx.fill();}
}

function drawTrackPreview(){
  const vw=canvas.clientWidth,vh=canvas.clientHeight;
  ctx.fillStyle='#2d6a4f';ctx.fillRect(0,0,vw,vh);
  ctx.fillStyle='rgba(0,0,0,.35)';ctx.font='bold 22px system-ui';ctx.textAlign='center';
  ctx.fillText('Pilih track & mode di menu →',vw/2,vh/2);
}

// menu wiring
function refreshMenu(){
  const sel=document.getElementById('trackSel');
  sel.innerHTML=TRACKS.map((t,i)=>`<option value="${i}">${t.name} — ${t.desc}</option>`).join('');
  sel.value=state.trackIdx;
  const eb=document.getElementById('evoBadge');
  if(eb) eb.textContent = (window.EVO_ACTIVE||localStorage.getItem('evoBrains')) ? '🧬 Otak: HASIL EVOLUSI aktif' : 'Otak: default (bawaan)';
  updateSeasonBadge();
}
// Evolusi di browser (chunked biar UI tidak freeze). Hasil disimpan & langsung dipakai.
window.runEvoBrowser=async()=>{
  const btn=document.getElementById('evoBtn'), prog=document.getElementById('evoProg');
  if(btn) btn.disabled=true;
  try{
    const { pop } = await Evolution.run({ generations:4, popSize:8, seconds:20, chunked:true, tracks:TRACKS,
      onProgress:({gen,generations,best})=>{ if(prog) prog.textContent=`gen ${gen+1}/${generations} best=${Math.round(best.fitness)}`; } });
    const top6=Evolution.pickTop6(pop);
    const slim=top6.map(b=>{const o={};Evolution.GENES.forEach(d=>{o[d.key]=+b[d.key].toFixed(4);});return o;});
    localStorage.setItem('evoBrains',JSON.stringify(slim));
    for(let i=0;i<6;i++){const keep={id:BRAINS[i].id,label:BRAINS[i].label,icon:BRAINS[i].icon};BRAINS[i]=Object.assign(keep,slim[i]);}
    window.EVO_ACTIVE=true; refreshMenu();
    if(prog) prog.textContent='OK! Otak evolusi aktif. Mulai balapan.';
  }catch(e){ if(prog) prog.textContent='Gagal: '+e.message; }
  if(btn) btn.disabled=false;
};
document.getElementById('trackSel')?.addEventListener('change',e=>state.trackIdx=+e.target.value);
document.getElementById('diffSel')?.addEventListener('change',e=>state.diff=parseFloat(e.target.value));
document.getElementById('aiCountSel')?.addEventListener('change',e=>{state.aiCount=+e.target.value;state.specIdx=0;});
window.startGame=startGame;
refreshMenu();
requestAnimationFrame(loop);
