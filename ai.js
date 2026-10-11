// AI v3: cepat di tikungan landai + berani menyalip + slipstream + bertahan + bikin kesalahan kecil.
function clamp(v,a,b){ return Math.max(a,Math.min(b,v)); }
function angDiff(a,b){ let d=b-a; while(d>Math.PI)d-=Math.PI*2; while(d<-Math.PI)d+=Math.PI*2; return d; }

// --- OTAK TIAP OPPONENT: 6 kepribadian, pace seimbang tapi gaya beda jauh ---
const BRAINS = [
  { id:'taktisi',  label:'Taktisi',   icon:'🧠', aggro:0.45, risk:1.0,  draft:1.0, defend:0.3, mistake:0.5, overDist:110, diveAggro:0.45, steerGain:3.0, laneStyle:0 },
  { id:'madDog',   label:'Mad Dog',   icon:'🤬', aggro:0.85, risk:1.04, draft:0.7, defend:0.8, mistake:1.6, overDist:150, diveAggro:0.35, steerGain:3.4, laneStyle:1 },
  { id:'profesor', label:'Profesor',  icon:'📐', aggro:0.35, risk:0.98, draft:1.2, defend:0.2, mistake:0.3, overDist:90,  diveAggro:0.6,  steerGain:2.7, laneStyle:-1 },
  { id:'tukangBlok',label:'Tukang Blok',icon:'🛡️', aggro:0.6, risk:0.97, draft:0.9, defend:1.0, mistake:0.7, overDist:100, diveAggro:0.55, steerGain:3.1, laneStyle:0 },
  { id:'rookie',   label:'Rookie',    icon:'🍼', aggro:0.5,  risk:0.94, draft:1.0, defend:0.1, mistake:2.2, overDist:95,  diveAggro:0.65, steerGain:2.9, laneStyle:0 },
  { id:'pemburu',  label:'Pemburu Draft',icon:'🌪️', aggro:0.55, risk:1.01, draft:1.8, defend:0.4, mistake:0.8, overDist:140, diveAggro:0.4, steerGain:3.2, laneStyle:1 },
];
function brainByIndex(i){ return BRAINS[i % BRAINS.length]; }

// Faktor grip kompon vs kebasahan (0 kering — 1 banjir). Salah ban = melambat, harus pit.
function compoundGrip(compound, wet){
  if(compound==='wet') return 1-(1-wet)*0.10; // ban hujan di kering: -10% + cepat aus
  return 1-wet*0.45;                          // slick di hujan: s/d -45%, wajib ganti
}

// Geometri pit (dipakai ai.js + game.js; evolve.js ikut gratis via ai.js)
const PIT_RANGE = 1300;      // zona box/servis di dekat garis start (px)
const PIT_LANE_LEN = 2100;   // panjang jalur pit: entry jauh sebelum box
const PIT_EXIT = 700;        // titik merge kembali ke trek (px setelah garis start)
const PIT_LANE_EXTRA = 70;   // offset tengah jalur pit (di luar tembok +15)
const PIT_BOX_EXTRA = 130;   // offset box (lebih ke dalam, tidak menghalangi jalur lewat)
const PIT_SLOT_GAP = 100;    // jarak antar box
const PIT_STOP_TIME = 2.5;   // detik ganti ban
const PIT_APPROACH = 2200;   // jarak mulai ancang ke entry pit
const PIT_SPEED = 140;       // batas kecepatan jalur pit (limiter, semua mobil)
function pitSlotS(track, slot){ return track.length - 300 - slot*PIT_SLOT_GAP; }

// Terapkan hasil evolusi (kalau ada): file brains-tuned.js atau localStorage.
// Label/ikon 6 otak dipertahankan, yang diganti angka-angkanya.
try {
  let tuned = (typeof EVOLVED_BRAINS !== 'undefined' && EVOLVED_BRAINS && EVOLVED_BRAINS.length >= 6) ? EVOLVED_BRAINS : null;
  try {
    const ls = (typeof localStorage !== 'undefined') && localStorage.getItem('evoBrains');
    if (ls) { const p = JSON.parse(ls); if (p && p.length >= 6) tuned = p; }
  } catch (e) {}
  if (tuned) {
    for (let i = 0; i < 6; i++) {
      const keep = { id: BRAINS[i].id, label: BRAINS[i].label, icon: BRAINS[i].icon };
      BRAINS[i] = Object.assign(keep, tuned[i]);
    }
    if (typeof window !== 'undefined') window.EVO_ACTIVE = true;
  }
} catch (e) {}

function createAI(opts={}) {
  const brain = opts.brain || brainByIndex(Math.floor(Math.random()*BRAINS.length));
  const ag = (brain && brain.aggro) || 0.5;
  return {
    brain,
    lane: opts.lane ?? (brain.laneStyle*0.4 + (Math.random()*2-1)*0.4),
    aggro: brain.aggro,
    // ambang pit per mobil (0.38-0.72): yang kalem awal, Mad Dog telat, + acak → masuk pit bergelombang, tidak bareng
    pitThreshold: 0.38 + (1-ag)*0.12 + Math.random()*0.22,
    wobbleT: Math.random()*10,
    targetSpeed: 0, curv: 0,
    stuckT: 0, reverseT: 0, revSteer: 1,
    lastX: 0, lastY: 0, checkT: 0,
    mistakeT: 0, mistakeLane: 0,
    overtakeT: 0, followT: 0, exiting: false,
    brakeBias: (Math.random()-0.5)*90, // ciri titik rem tiap mobil: ±45px biar tidak kompak
    // MEMORI BELAJAR LIVE: tiap sektor ingat titik rem + exit speed. Reset tiap balapan.
    learn: { brake: new Array(16).fill(0), exit: new Array(16).fill(0), cur: -1, incident: false },
    tire: 0, // 0 baru → 1 habis. Aus bikin grip+top speed turun → drama akhir balapan
    formPhase: Math.random()*Math.PI*2,
    formPeriod: 18 + Math.random()*22,
  };
}

function updateAI(car, track, others, difficulty, dt, mode, leaderGap=0) {
  const ai = car.ai;
  const B = ai.brain || BRAINS[0];
  ai.wobbleT += dt;
  const info = trackClosest(track, car.x, car.y);
  const spd = Math.abs(car.speed);

  // --- 1. BoP SEDANG: spread ~5% total. Pace rapat, yang mecah konvoy = perilaku (frustrasi dive),
  // bukan beda mesin. Risk dikompres 50% biar Mad Dog vs Rookie tidak kabur.
  const riskC = 1 + ((B.risk||1)-1)*0.5;
  // BAN AUS: rate disetel agar 3 lap ≈ 0.7-0.9 → wajib pit. Dulu kekecilan (0.36/3 lap = tidak pernah pit).
  if (mode !== 'traffic' && car.totalS!==undefined && mode !== 'quali')
    ai.tire = Math.min(1, ai.tire + dt*(0.0055 + Math.abs(car.input.steer||0)*0.003 + (car.drifting?0.022:0) + ((car.compound==='wet'&&(car.wet||0)<0.3)?0.020:0))*(0.75+ai.aggro*0.6));
  // FORMA: tiap pembalap punya gelombang performa (periode 18-40s, ±2%) → duel pasang-surut natural.
  const form = 1 + 0.02*Math.sin(ai.wobbleT*2*Math.PI/ai.formPeriod + ai.formPhase);
  // BAN RUSAK = MELAMBAT NYATA: top speed -16%, drag + getar. Ban botak = puluhan detik hilang per lap.
  let baseMax = car.topSpeed * difficulty * (0.96 + ai.aggro*0.06) * riskC * form * (1 - ai.tire*0.16);
  if (mode === 'traffic') baseMax = car.topSpeed * (0.9 + ai.aggro*0.15);
  // rubber-band LEMAH, nonaktif di kualifikasi (murni pace) & traffic
  if (mode !== 'traffic' && mode !== 'quali') {
    if (leaderGap > 900) baseMax *= 1.04;
    else if (leaderGap > 350) baseMax *= 1.02;
    else if (leaderGap < -1100) baseMax *= 0.97;
  }

  // lookahead adaptif: di zona teknikal lihat DEKAT, di lurusan lihat JAUH.
  // (lookahead 500px di chicane = motong tikungan kedua = keluar trek)
  const curvHere = trackLocalCurv(track, info.s, 280);
  const lookSteer = (215 + spd*0.78) * (curvHere > 0.4 ? 0.55 : 1);
  let tp = trackPointAt(track, info.s + lookSteer);
  let nx = -tp.dirY, ny = tp.dirX;

  // --- 2. scan depan & belakang ---
  // DISIPLIN START: 700px pertama dari grid — tahan formasi, tidak duel/salip/blokir/pit.
  // (Grid rapat → scan langsung memicu dive & geser = start berantakan.)
  const settling = (car.totalS || 0) < 700;
  let brakeReq = 0, extraLane = 0, closestAhead = 1e9, aheadSpeed = 0, aheadLat = 0, aheadPitting = false;
  let behindClose = false, behindLat = 0;
  const ca = Math.cos(car.angle), sa = Math.sin(car.angle);
  for (const o of others) {
    if (o === car) continue;
    const dx = o.x-car.x, dy = o.y-car.y;
    const dist = Math.hypot(dx,dy);
    if (dist > 300 || dist < 1) continue;
    const fwd = (dx*ca+dy*sa)/dist;
    const lat = -dx*sa+dy*ca;
    if (fwd > 0.5) {
      if (dist < closestAhead && Math.abs(lat) < 90) { closestAhead = dist; aheadSpeed = o.speed||0; aheadLat = lat; aheadPitting = !!(o.ai && (o.ai.willPit || o.pitTimer > 0)); }
      if (dist < 250 && Math.abs(lat) < 70) {
        const side = lat > 0 ? -1 : 1;
        const closing = car.speed - aheadSpeed;
        // SLIPSTREAM per otak: Pemburu Draft dapat bonus 2x, Mad Dog cuek draft
        const curvNow = ai.curv || 0;
        const inDraft = dist > 45 && dist < 150 && Math.abs(lat) < 32 && curvNow < 0.3;
        if (inDraft) {
          baseMax *= 1.0 + 0.09*(B.draft||1)*(1-dist/150);
          extraLane = side * track.roadHalf*0.5;
          if (dist < 75 && closing > (B.diveAggro*100) && ai.aggro > 0.4) {
            ai.overtakeT = 1.0 + ai.aggro*0.6; // Mad Dog & Pemburu paling berani dive
          }
        } else if (Math.abs(lat) < 40 && dist < (B.overDist||110)) {
          // terhalang: geser jalur (kecuali baru start — tahan formasi).
          // REM DARURAT saja (<55 & mendekat) — sisanya urusan mode serang.
          // Kecuali yang depan lagi pit/servis: hormati, rem lebih awal.
          // + angkat gas lebih dini kalau menutup 60+ (cegah seruduk, termasuk ke mobil pit).
          if(!settling) extraLane = side * (track.roadHalf*0.55) * (0.5+ai.aggro*0.7);
          if (ai.overtakeT <= 0 && dist < 55 && closing > 5) brakeReq = Math.max(brakeReq, 0.9);
          if (aheadPitting && dist < 130 && closing > 20) brakeReq = Math.max(brakeReq, 0.6);
          if (ai.overtakeT <= 0 && dist < 200 && closing > 60) brakeReq = Math.max(brakeReq, 0.5);
        } else {
          // lawan di sisi → cukup beri ruang, jangan rem
          extraLane = side * 18;
        }
      }
    } else if (fwd < -0.5 && dist < 100 && Math.abs(lat) < 60) {
      behindClose = true; behindLat = lat;
    }
  }
  if (ai.overtakeT > 0) { ai.overtakeT -= dt; brakeReq = 0; }

  // bertahan per otak (nonaktif saat start)
  let defendLane = 0;
  if (!settling && behindClose && ai.curv > 0.22 && Math.random() < (B.defend||0)) {
    defendLane = (behindLat > 0 ? 1 : -1) * track.roadHalf * 0.32 * (B.defend||0);
  }

  // kesalahan per otak — hujan + ban salah bikin 2.5x lebih sering ceroboh
  // Yang agresif kadang OVERSTEER beneran (pantat buang + asap) — bukan cuma keluar jalur.
  const wrongTire = (car.compound !== 'wet' && (car.wet||0) > 0.5) ? 1 : 0;
  if (ai.mistakeT > 0) ai.mistakeT -= dt;
  else if (!settling && Math.random() < dt * 0.12 * (1.15 - difficulty) * 2 * (B.mistake||1) * (1 + wrongTire*1.5)) {
    ai.mistakeT = 0.5 + Math.random()*0.7;
    ai.mistakeLane = (Math.random()-0.5) * track.roadHalf * 0.8;
    if (ai.aggro > 0.55 && Math.random() < 0.45 && spd > 240)
      car.spin = (car.spin||0) + (Math.random()-0.5)*4.0;
  }
  const mistake = (ai.mistakeT > 0 && !settling) ? ai.mistakeLane : 0;

  // --- 3. kecepatan: pijakan saat ini + LATE-BRAKING fisika (bukan ramalan jauh) ---
  // Dulu: max 3 sampel s/d 1200px → tikungan 3 detik ke depan bikin semua AI ngerem bareng di lurusan.
  // Sekarang: gaspol sampai titik pengereman = v² ≤ vTikungan² + 2·a·jarak. Titik rem beda per otak.
  const curv = trackLocalCurv(track, info.s, 280);
  const cornerSpeedOf = (c) => c < 0.25 ? baseMax*(1-c*0.32) : baseMax*(0.92-(c-0.25)*0.60);
  let cornerSpeed = cornerSpeedOf(curv);
  if (ai.mistakeT > 0) cornerSpeed *= 0.94; // saat bikin salah, sedikit melebar
  if (info.dist > track.roadHalf*0.95) cornerSpeed = Math.min(cornerSpeed, baseMax*0.78);
  if (info.dist > track.roadHalf + 60) cornerSpeed = baseMax*0.55;

  let desired = Math.min(baseMax, cornerSpeed);
  const floor = mode === 'traffic' ? 0 : 110;
  const BRAKE_A = 620;
  // BELAJAR LIVE per sektor (16 sektor/trek): yang bersih & cepat → rem makin telat lap berikutnya.
  // Yang tercepat (lap bersih) belajar paling laju → makin cabut. Yang macet/sering insiden → stagnan.
  const NB = 16;
  const mySector = Math.floor(info.s / track.length * NB) % NB;
  if (ai.learn.cur === -1) ai.learn.cur = mySector;
  if (car.offroad || Math.abs(car.spin||0) > 1.2 || (car.drifting && spd > 300)) ai.learn.incident = true;
  if (mySector !== ai.learn.cur && mode !== 'traffic') {
    const prev = ai.learn.cur;
    if (ai.learn.incident) {
      ai.learn.brake[prev] = Math.min(120, ai.learn.brake[prev] + 15); // insiden → rem lebih awal
    } else if (spd > (ai.learn.exit[prev]||0) + 5) {
      ai.learn.exit[prev] = spd;
      const before = ai.learn.brake[prev];
      ai.learn.brake[prev] = Math.max(-60, before - 8); // bersih + cepat → rem lebih telat
      if (before > 0 && ai.learn.brake[prev] <= 0 && typeof pushEvent === 'function' && car.brain)
        pushEvent('🧠 ' + (car.name||'AI') + ' hafal S' + (prev+1) + ': rem makin telat');
    }
    ai.learn.cur = mySector;
    ai.learn.incident = false;
  }
  const cornerSector = cAheadSafe => cAheadSafe ? Math.floor(((info.s + cAheadSafe.dist) % track.length) / track.length * NB) % NB : -1;
  const brakeMargin = 120 - ai.aggro*90 + (ai.brakeBias||0); // Mad Dog telat, Rookie awal + ciri tiap mobil
  const cAhead = cornerAhead(track, info.s);
  const learnBonus = cAhead ? ai.learn.brake[cornerSector(cAhead)] : 0; // negatif = sudah hafal = telat
  if (cAhead) {
    const vCornerNext = cornerSpeedOf(cAhead.curv);
    const vAllow = Math.sqrt(vCornerNext*vCornerNext + 2*BRAKE_A*Math.max(0, cAhead.dist - brakeMargin - learnBonus));
    desired = Math.min(desired, vAllow);
  }
  // MODE SERANG: ambil kesempatan kapan pun.
  // a) pintu terbuka (lawan keluar jalur) & dekat → langsung dive, tanpa nunggu timer.
  // b) lawan melambat (salah/aus) & saya datang → langsung dive.
  // c) nempel di belakang melebihi batas sabar → dive (TANPA syarat speed, dulu macet di sini).
  const patience = 3.2 - ai.aggro*2.0;
  const doorOpen = Math.abs(aheadLat) > 32 && Math.abs(aheadLat) < 85 && closestAhead < 130 && curv < 0.35;
  const sittingDuck = closestAhead < 190 && aheadSpeed < car.speed - 40 && curv < 0.45;
  const tailing = Math.abs(aheadLat) < 55 && closestAhead < 160;
  if (ai.overtakeT <= 0 && mode !== 'traffic' && !ai.willPit && !ai.exiting && !settling) {
    if (doorOpen || sittingDuck) {
      ai.overtakeT = 0.9 + ai.aggro*0.6;
      ai.lane = clamp((aheadLat > 0 ? -0.75 : 0.75), -0.85, 0.85);
      ai.followT = 0;
    } else if (tailing) {
      ai.followT = (ai.followT||0) + dt;
      if (ai.followT > patience) {
        ai.followT = 0;
        ai.overtakeT = 1.2 + ai.aggro*0.8;
        ai.lane = clamp((aheadLat > 0 ? -0.7 : 0.7), -0.8, 0.8);
      }
    } else ai.followT = Math.max(0, (ai.followT||0) - dt*2);
  }
  // STRATEGI PIT (race/champ, bukan quali/traffic): ban botak & sudah lap>=1 → masuk pit.
  // TIDAK pit di lap terakhir (tidak ada lap tersisa untuk dinikmati).
  // Threshold per otak: yang kalem (aggro rendah) lebih awal, Mad Dog telat.
  const lapsLeft = (car.raceLaps || 99) - 1 - car.lap;
  if(mode==='race' && !ai.willPit && !car.pitDone && car.lap>=1 && lapsLeft>=1 && ai.tire > ai.pitThreshold && !settling) ai.willPit=true;
  // SALAH BAN = DARURAT: slick kebanjiran atau wet kepanasan → pit segera (kecuali lap terakhir)
  const wetNow = car.wet || 0;
  const needWet = wetNow > 0.5, haveWet = (car.compound === 'wet');
  if(mode==='race' && !ai.willPit && !car.pitDone && lapsLeft>=1 && !settling &&
     ((needWet && !haveWet && wetNow > 0.55) || (!needWet && haveWet && wetNow < 0.25))) ai.willPit=true;
  // ikuti HANYA kalau sudah sangat dekat (<75) dan bukan saat mode serang.
  // Rumus +30 (bukan *0.85) → tidak terseret pelan berantai.
  if (Math.abs(aheadLat) < 38 && closestAhead < 75 && aheadSpeed < desired && ai.overtakeT <= 0 && !ai.willPit)
    desired = Math.min(desired, Math.max(floor, aheadSpeed + 30));
  if (brakeReq > 0.7 && !ai.willPit) desired = Math.min(desired, Math.max(70, aheadSpeed*0.9));
  desired = Math.max(desired, ai.overtakeT > 0 ? baseMax*0.95 : floor*0.7);
  // PENDEKATAN PIT: jalur lewat dulu, 200px sebelum box menepi ke baris box (tidak menghalangi).
  // Rem PENUH hanya kalau sudah sebaris box; kalau masih di jalur → merangkak (jangan berhenti di jalan!).
  const approachingPit = ai.willPit && !settling && (info.s > track.length-PIT_APPROACH || info.s < 200);
  let pitLaneOff = -(track.roadHalf+PIT_LANE_EXTRA);
  const latPit = (info.nx*(-info.dirY)+info.ny*(info.dirX)); // negatif = sisi pit (kanan)
  const inBoxRow = latPit < -(track.roadHalf+95);
  if (approachingPit) {
    let dsBox = pitSlotS(track, car.pitSlot||0) - info.s;
    if (dsBox < -track.length/2) dsBox += track.length;
    if (dsBox > track.length/2) dsBox -= track.length;
    ai._dsBox = dsBox;
    // Tetap gaspol sampai 800px (tidak melambat di jalur balap → tidak diseruduk).
    // Di jalur pit SATU KECEPATAN (140) sampai box — tidak ada merangkak, tidak ada akordeon.
    // Tetap di JALUR KANAN sampai 180px sebelum box, baru mepet (BLEND 180→130px).
    // Keluar box? tetap kanan (lane) sampai merge — dilarang motong kiri.
    const boxBlend = clamp(1 - (dsBox-130)/50, 0, 1);
    pitLaneOff = (-(track.roadHalf+PIT_LANE_EXTRA))*(1-boxBlend) + (-(track.roadHalf+PIT_BOX_EXTRA))*boxBlend;
    if (dsBox < -80) {
      ai._missed = true; // KEBABLASAN: langsung gabung balap full speed, coba lagi lap depan.
    }
    else if (dsBox < 400 && inBoxRow) desired = 0;             // sudah sebaris box → berhenti
    else if (dsBox < 800) desired = Math.min(desired, PIT_SPEED); // jalur & ancang box: sama rata 140
    else desired = Math.min(desired, 200); // ancang entry: pelan agar manuver masuk rapi
    // anti-macet: diam di jalur >1.2s → paksa merangkak ke box
    if (spd < 25 && !inBoxRow && !ai._missed) {
      ai.pitBlockT = (ai.pitBlockT||0) + dt;
      if (ai.pitBlockT > 1.2) desired = Math.max(desired, 40);
    } else if (spd >= 25 || inBoxRow) ai.pitBlockT = 0;
    // antre sopan: ada yang lamban di depan zona pit → tahan
    if (!ai._missed && closestAhead < 100 && aheadSpeed < 120) desired = Math.min(desired, 60);
  } else ai._missed = false;
  // yang kelewat box = mode balap normal (lane + speed), bukan nempel sisi pit
  const pitEngaged = approachingPit && !ai._missed;
  // PIT EXIT: habis servis, LANGSUNG ambil lane pit (bukan baris box) agar tidak seruduk box depan yang ada mobilnya.
  if (ai.exiting) {
    pitLaneOff = -(track.roadHalf+PIT_LANE_EXTRA);
    const stillInBox = latPit < -(track.roadHalf+95);
    ai._exitBox = stillInBox;
    if (stillInBox) {
      // Selama masih di baris box: merangkak + setir tajam keluar ke lane. Jangan langsung tancap.
      desired = Math.min(desired, 60);
      // Ada mobil di box depan (box selisih 100px + kurva ≈ 113px): tahan dulu, jangan maju nabrak.
      if (closestAhead < 140 && Math.abs(aheadLat) < 60) desired = Math.min(desired, 15);
    }
    else if (info.s > track.length-PIT_LANE_LEN || info.s < 500) desired = Math.min(desired, PIT_SPEED);
    else if (info.s < PIT_EXIT) desired = Math.min(desired, 250);
    else if (info.s > PIT_EXIT && info.s < track.length-PIT_LANE_LEN) { ai.exiting = false; ai._exitBox = false; } // merge selesai
  } else ai._exitBox = false;

  let throttle = 0, brake = 0;
  const err = desired - car.speed;
  if (ai.reverseT > 0) {
    ai.reverseT -= dt;
    car.input = { throttle:0, brake:0, steer:ai.revSteer, reverse:true };
    car.reverse = true;
    return;
  }
  car.reverse = false;
  if (err > 12) throttle = 0.95;
  else if (err < -30) brake = clamp(-err/200, 0.35, 1);
  else if (err > -10) throttle = 0.55;
  // titik pengereman keras: kalau kecepatan tak mungkin turun tepat waktu → rem penuh SEKARANG
  if (cAhead && spd*spd > cornerSpeedOf(cAhead.curv)*cornerSpeedOf(cAhead.curv) + 2*BRAKE_A*Math.max(0, cAhead.dist - brakeMargin - learnBonus)) {
    brake = 1; throttle = 0;
  }
  if (brakeReq > 0 && err > -5 && ai.overtakeT <= 0) brake = Math.max(brake, brakeReq*0.7);

  // --- 4. steering ---
  // homing presisi: <400px dari box, lookahead 120px. Di zona pit manuver TEGAS:
  // lookahead 200 + setir 1.25x + jaga jarak 1.2x (belok kiri-kanan jelas, anti serempet).
  // Firm hanya <1200px dari box (biar tidak zigzag di ancang jauh).
  const pitFirm = ((approachingPit && (ai._dsBox ?? 9999) < 1200) || ai.exiting);
  if (ai.exiting && ai._exitBox) {
    tp = trackPointAt(track, info.s + 90);
    nx = -tp.dirY; ny = tp.dirX;
  } else if (pitEngaged && (ai._dsBox ?? 9999) < 400) {
    tp = trackPointAt(track, info.s + 120);
    nx = -tp.dirY; ny = tp.dirX;
  } else if (pitFirm) {
    tp = trackPointAt(track, info.s + 200);
    nx = -tp.dirY; ny = tp.dirX;
  }
  // CORONG ENTRY 2 FASE: sebelum GERBANG tetap di trek (jangan motong tembok),
  // sesudah gerbang baru blend ke jalur/box. Funnel 350px setelah gerbang memang bolong.
  const maxLat = track.roadHalf*0.62;
  const raceLane = clamp(ai.lane*(track.roadHalf*0.5) + extraLane*(pitFirm?1.2:0.7) + (pitEngaged?0:defendLane) + (pitEngaged?0:mistake*0.5), -maxLat, maxLat);
  let wantLane = raceLane;
  if (ai.exiting) wantLane = pitLaneOff;
  else if (pitEngaged) {
    // Belok MASUK tegas 300px sebelum gerbang: target penuh langsung.
    // Selesai jauh sebelum tembok (mulai length-1000).
    let gateDist = info.s - (track.length-PIT_LANE_LEN);
    if(gateDist<-track.length/2)gateDist+=track.length;
    if(gateDist>track.length/2)gateDist-=track.length;
    if(gateDist >= -500) wantLane = pitLaneOff;
  }
  const tx = tp.x + nx*wantLane, ty = tp.y + ny*wantLane;
  const want = Math.atan2(ty-car.y, tx-car.x);
  const diff = angDiff(car.angle, want);
  let steer = clamp(diff*(B.steerGain||3.0)*((ai.exiting&&ai._exitBox)?1.6:(pitFirm?1.25:1)), -1, 1);
  steer *= (spd > 350 ? 0.85 : 1.0);

  // --- 5. anti-stuck ketat ---
  ai.checkT += dt;
  if (ai.checkT > 0.5) {
    const moved = Math.hypot(car.x-ai.lastX, car.y-ai.lastY);
    const trackDir = Math.atan2(info.dirY, info.dirX);
    const wrongWay = Math.abs(angDiff(car.angle, trackDir)) > 1.0;
    const blocked = closestAhead < 55;
    const reallyStuck = spd < 28 && throttle > 0.5 && moved < 14
      && (wrongWay || info.dist > track.roadHalf + 30 || blocked);
    if (reallyStuck) ai.stuckT += 0.5;
    else ai.stuckT = Math.max(0, ai.stuckT - 0.5);
    ai.lastX = car.x; ai.lastY = car.y; ai.checkT = 0;
    if (ai.stuckT > 1.6) { ai.stuckT = 0; ai.reverseT = 0.7; ai.revSteer = (wrongWay ? 1 : (Math.random()<0.5?-1:1)); ai.lane *= -0.3; }
  }

  if (curv < 0.1 && Math.random() < 0.0015) ai.lane = clamp(ai.lane + (Math.random()-0.5)*0.6, -0.8, 0.8);

  car.input = { throttle, brake, steer };
  ai.targetSpeed = desired; ai.curv = curv;
}
