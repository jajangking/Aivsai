// Audio sampel rekaman (WebAudio):
// - Mesin: racing motorcycle engine (Mixkit, high-RPM mirip F1) + V8 idle (freesound Lumamorph),
//   SATU timbre, teriakan dari rate lebar 0.65→1.55 per gigi.
// - Decit ban: loop skid asli (CC0 freesound craigsmith "S04-14 Crazy distorted car skids").
// - Tabrakan: metal hit + kaca (Mixkit), kunci pit: pneumatic wrench (Mixkit), starter: ignition (Mixkit).
// - Angin/hujan/bel: synth ringan. Fallback prosedural penuh bila file tak termuat (offline/file://).
const AudioSys = {
  ctx: null, master: null, muted: false,
  eng: null, skidGain: null, windGain: null,
  // --- sampel ---
  buf: null, sampReady: false, _loading: false,
  gearBus: null, gearFilter: null, gearSrc: null, lastGear: -1, _shiftT: 0,
  skidSrc: null, skidSampGain: null,
  FILES: {
    // racing motorcycle engine (Mixkit) = teriakan high-RPM mirip F1, semua gigi + trim gap mp3
    gears: ['audio/moto_race.mp3','audio/moto_race.mp3','audio/moto_race.mp3','audio/moto_race.mp3','audio/moto_race.mp3'],
    idle: 'audio/v8_idle.ogg',
    skid: 'audio/skid_loop.mp3',
    crash: 'audio/crash_metal.mp3',
    glass: 'audio/crash_glass.mp3',
    pit: 'audio/pit_wrench.mp3',
    ignition: 'audio/ignition.mp3',
  },
  init() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.muted ? 0 : 1.0;
      // kompresor: lem saat tabrakan + mesin meraung bareng
      const comp = this.ctx.createDynamicsCompressor();
      comp.threshold.value = -9; comp.ratio.value = 3;
      this.master.connect(comp); comp.connect(this.ctx.destination);
      // noise buffer bersama (fallback + angin/hujan)
      const len = this.ctx.sampleRate * 1;
      const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      this.noiseBuf = buf;
      // MESIN fallback (dipakai hanya bila loop tak termuat): 2 osc gergaji + lowpass
      const o1 = this.ctx.createOscillator(); o1.type = 'sawtooth';
      const o2 = this.ctx.createOscillator(); o2.type = 'square';
      const f = this.ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 900;
      const g = this.ctx.createGain(); g.gain.value = 0;
      o1.connect(f); o2.connect(f); f.connect(g); g.connect(this.master);
      o1.start(); o2.start();
      this.eng = { o1, o2, f, g };
      // BODY KNALPOT (selalu ada, sampel maupun fallback): sub osc ngikut RPM
      // knalpot: gerung oktaf atas (bukan sub) + pelan — body tanpa ngebass
      const oEx = this.ctx.createOscillator(); oEx.type = 'sawtooth'; oEx.frequency.value = 96;
      const lpEx = this.ctx.createBiquadFilter(); lpEx.type = 'lowpass'; lpEx.frequency.value = 240;
      const gEx = this.ctx.createGain(); gEx.gain.value = 0;
      oEx.connect(lpEx); lpEx.connect(gEx); gEx.connect(this.master);
      oEx.start();
      this.exh = { oEx, gEx }; this._popT = 0; this._blipT = -9; this._shiftDir = 0;
      // DECIT fallback: noise → bandpass 900Hz
      const ns = this.ctx.createBufferSource(); ns.buffer = buf; ns.loop = true;
      const bp = this.ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 950; bp.Q.value = 6;
      const ng = this.ctx.createGain(); ng.gain.value = 0;
      ns.connect(bp); bp.connect(ng); ng.connect(this.master); ns.start();
      this.skidGain = ng;
      // ANGIN: noise → lowpass 350Hz
      const ws = this.ctx.createBufferSource(); ws.buffer = buf; ws.loop = true; ws.playbackRate.value = 0.7;
      const lp = this.ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 350;
      const wg = this.ctx.createGain(); wg.gain.value = 0;
      ws.connect(lp); lp.connect(wg); wg.connect(this.master); ws.start();
      this.windGain = wg;
      // HUJAN: noise → highpass (desis), gain diatur via setRain()
      const rs = this.ctx.createBufferSource(); rs.buffer = buf; rs.loop = true; rs.playbackRate.value = 1.3;
      const hp = this.ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 3500;
      const rg = this.ctx.createGain(); rg.gain.value = 0;
      rs.connect(hp); hp.connect(rg); rg.connect(this.master); rs.start();
      this.rainGain = rg;
      this.loadSamples();
    } catch (e) {}
  },
  async loadSamples() {
    if (this._loading || !this.ctx) return;
    this._loading = true;
    this.buf = { gears: [] };
    const get = async (url) => {
      const r = await fetch(url);
      if (!r.ok) throw new Error(url);
      return await this.ctx.decodeAudioData(await r.arrayBuffer());
    };
    try {
      const uniq = [...new Set(this.FILES.gears)];
      const got = await Promise.allSettled(uniq.map(get));
      const pool = {};
      uniq.forEach((u, i) => { if (got[i].status === 'fulfilled') pool[u] = got[i].value; });
      const have = Object.keys(pool);
      if (!have.length) throw new Error('no gears');
      // file hilang → pakai tetangga terdekat yang ada (timbre tetap konsisten)
      this.buf.gears = this.FILES.gears.map(u => pool[u] || pool[have[0]]);
      this.startGearLoops();
    } catch (e) { /* tetap fallback osc */ }
    for (const k of ['skid','crash','glass','pit','ignition','idle']) {
      try { this.buf[k] = await get(this.FILES[k]); }
      catch (e) { /* one-shot opsional: fallback di tiap fungsi */ }
    }
    if (this.buf.skid) this.startSkidLoop();
    this.startIdleLoop();
  },
  startGearLoops() {
    if (!this.buf.gears.length || this.gearBus) return;
    const c = this.ctx;
    this.gearBus = c.createGain(); this.gearBus.gain.value = 0;
    this.gearFilter = c.createBiquadFilter(); this.gearFilter.type = 'lowpass'; this.gearFilter.frequency.value = 1200;
    // buang dengung bawah (<90Hz) biar tak ngebass — scream balap di mid-high
    const hpEx = c.createBiquadFilter(); hpEx.type = 'highpass'; hpEx.frequency.value = 90;
    // grit knalpot: saturasi ringan biar loop bersih terdengar garang
    try {
      const ws = c.createWaveShaper();
      const curve = new Float32Array(256);
      for (let i = 0; i < 256; i++) { const x = i / 128 - 1; curve[i] = Math.tanh(1.4 * x); }
      ws.curve = curve;
      this.gearFilter.connect(hpEx); hpEx.connect(ws); ws.connect(this.gearBus);
    } catch (e) { this.gearFilter.connect(this.gearBus); }
    this.gearBus.connect(this.master);
    // SATU source: posisi rekaman tak pernah lompat → pindah gigi = rate meluncur + sentakan, selalu nyambung
    const b0 = this.buf.gears[0];
    const src = c.createBufferSource(); src.buffer = b0; src.loop = true;
    // pangkas ujung (gap encoder mp3 + fade) biar putaran mulus
    try {
      const trim = 0.06;
      if (b0.duration > trim * 2 + 0.2) { src.loopStart = trim; src.loopEnd = b0.duration - trim; }
    } catch (e) {}
    src.connect(this.gearFilter); src.start();
    this.gearSrc = src;
    this.sampReady = true;
  },
  // idle V8: menggerung saat diam, pudar begitu jalan
  startIdleLoop() {
    if (!this.buf.idle || this.idleSrc || !this.ctx) return;
    const c = this.ctx;
    const isrc = c.createBufferSource(); isrc.buffer = this.buf.idle; isrc.loop = true;
    const ign = c.createGain(); ign.gain.value = 0;
    isrc.connect(ign); ign.connect(this.master); isrc.start();
    this.idleSrc = isrc; this.idleGain = ign;
  },
  startSkidLoop() {
    if (this.skidSrc || !this.buf.skid) return;
    const c = this.ctx;
    const src = c.createBufferSource(); src.buffer = this.buf.skid; src.loop = true;
    const hp = c.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 350;
    const gn = c.createGain(); gn.gain.value = 0;
    src.connect(hp); hp.connect(gn); gn.connect(this.master); src.start();
    this.skidSrc = src; this.skidSampGain = gn;
  },
  setMuted(m) {
    this.muted = m;
    try { localStorage.setItem('audioMute', m ? '1' : '0'); } catch (e) {}
    if (this.master) this.master.gain.value = m ? 0 : 1.0;
  },
  // dipanggil tiap frame: car = mobil fokus, throttle 0..1
  update(car) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const spd = Math.abs(car.speed || 0), top = car.topSpeed || 432;
    const frac = Math.max(0, Math.min(0.999, spd / top));
    const gear = Math.min(4, Math.floor(frac * 5));       // 5 gigi
    const inGear = frac * 5 - gear;                        // 0..1 per gigi
    const rpm = 0.25 + inGear * 0.75;
    const load = (car.input && car.input.throttle) || 0;
    if (this.sampReady) {
      // pindah gigi = rate MELUNCUR (0.15s) + sentakan halus — tanpa crossfade, tak ada lompatan
      if (gear !== this.lastGear) { this.lastGear = gear; this._shiftT = t; }
      const dip = Math.exp(-(t - this._shiftT) * 12);      // sentakan punchy tapi singkat
      const gearBase = [0.62, 0.85, 1.08, 1.31, 1.54][gear] || 1;
      const rate = Math.min(1.6, gearBase + inGear * 0.33);
      if (this.gearSrc) this.gearSrc.playbackRate.setTargetAtTime(rate, t, 0.06);
      this.gearFilter.frequency.setTargetAtTime(1200 + rpm * 3000 + load * 1200, t, 0.08);
      const base = 0.8 + load * 1.1 + Math.min(0.25, spd / 2000);
      this.gearBus.gain.setTargetAtTime(base * (1 - 0.5 * dip), t, 0.03);
      if (this.idleGain) this.idleGain.gain.setTargetAtTime(spd < 60 ? 0.5 * (1 - spd / 60) : 0, t, 0.1);
      if (this.eng) this.eng.g.gain.setTargetAtTime(0, t, 0.05); // fallback sunyi
      if (this.exh) { // knalpot: body gerung ngikut gigi, gain kecil
        this.exh.oEx.frequency.setTargetAtTime((70 + gear * 12) * (0.9 + inGear * 0.2), t, 0.05);
        this.exh.gEx.gain.setTargetAtTime(0.08 + load * 0.12, t, 0.05);
      }
    } else if (this.eng) {
      const base = 65 + rpm * 165 + load * 25;
      this.eng.o1.frequency.setTargetAtTime(base, t, 0.03);
      this.eng.o2.frequency.setTargetAtTime(base * 1.5 + 4, t, 0.03);
      this.eng.f.frequency.setTargetAtTime(500 + rpm * 1400 + load * 600, t, 0.05);
      this.eng.g.gain.setTargetAtTime(0.3 + load * 0.6 + Math.min(0.2, spd / 9000), t, 0.05);
    }
    // knalpot fallback: ikut osc synth, gain kecil
    if (this.exh && !this.sampReady && this.eng) {
      this.exh.oEx.frequency.setTargetAtTime(80 + rpm * 120, t, 0.05);
      this.exh.gEx.gain.setTargetAtTime(0.06 + load * 0.10, t, 0.05);
    }
    // letupan overrun: HANYA sesaat setelah angkat gas dari beban tinggi (jarang, pelan, dalam)
    if (load < 0.1 && (this._lastLoad || 0) > 0.6) this._liftT = t;
    this._lastLoad = load;
    if (this.noiseBuf && t - (this._popT || 0) > 0.14 + Math.random() * 0.22
        && t - (this._liftT === undefined ? -9 : this._liftT) < 0.9 && spd > 250) {
      this._popT = t;
      try {
        const ps = this.ctx.createBufferSource(); ps.buffer = this.noiseBuf;
        ps.playbackRate.value = 0.4 + Math.random() * 0.3;
        const pb = this.ctx.createBiquadFilter(); pb.type = 'bandpass';
        pb.frequency.value = 180 + Math.random() * 300; pb.Q.value = 1.5;
        const pg = this.ctx.createGain();
        const inten = Math.min(1, spd / 432);
        pg.gain.setValueAtTime(0.03 + Math.random() * 0.04 * inten, t);
        pg.gain.exponentialRampToValueAtTime(0.001, t + 0.06 + Math.random() * 0.05);
        ps.connect(pb); pb.connect(pg); pg.connect(this.master);
        ps.start(t); ps.stop(t + 0.15);
      } catch (e) {}
    }
    // decit ban: drift / lockup / slide keras
    const slip = car.drifting ? 1 : (car.lockup ? 0.9 : (Math.abs(car.slipAngle || 0) > 0.12 && spd > 220 ? 0.6 : 0));
    if (this.skidSampGain) {
      this.skidSrc.playbackRate.setTargetAtTime(0.9 + slip * 0.25, t, 0.05);
      this.skidSampGain.gain.setTargetAtTime(slip * Math.min(0.4, 0.08 + spd / 2200), t, 0.05);
      if (this.skidGain) this.skidGain.gain.setTargetAtTime(0, t, 0.05);
    } else if (this.skidGain) {
      this.skidGain.gain.setTargetAtTime(slip * Math.min(0.22, 0.05 + spd / 2500), t, 0.05);
    }
    if (this.windGain) this.windGain.gain.setTargetAtTime(Math.min(0.12, spd / 4200), t, 0.1);
  },
  setRain(x) {
    if (!this.ctx || !this.rainGain) return;
    this.rainGain.gain.setTargetAtTime(Math.max(0, Math.min(0.16, x)), this.ctx.currentTime, 0.4);
  },
  beep(freq, dur, vol) {
    if (!this.ctx) return;
    try {
      const o = this.ctx.createOscillator(); o.type = 'sine'; o.frequency.value = freq;
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(vol || 0.3, this.ctx.currentTime);
      g.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + dur);
      o.connect(g); g.connect(this.master);
      o.start(); o.stop(this.ctx.currentTime + dur);
    } catch (e) {}
  },
  // starter dikocok pas lampu merah terakhir → GO!
  start() {
    if (!this.ctx || !this.buf || !this.buf.ignition) return;
    try {
      const s = this.ctx.createBufferSource(); s.buffer = this.buf.ignition;
      const g = this.ctx.createGain(); g.gain.value = 0.55;
      s.connect(g); g.connect(this.master); s.start();
    } catch (e) {}
  },
  // kunci roda pit: rekaman pneumatic wrench (±2.8s ≈ durasi servis), fallback synth
  pitGun() {
    if (!this.ctx) return;
    if (this.buf && this.buf.pit) {
      try {
        const s = this.ctx.createBufferSource(); s.buffer = this.buf.pit;
        const g = this.ctx.createGain(); g.gain.value = 0.5;
        s.connect(g); g.connect(this.master); s.start();
        s.stop(this.ctx.currentTime + 2.7);
        return;
      } catch (e) {}
    }
    try {
      for (let k = 0; k < 4; k++) {
        const s = this.ctx.createBufferSource(); s.buffer = this.noiseBuf;
        const hp = this.ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 2500;
        const g = this.ctx.createGain();
        const t0 = this.ctx.currentTime + k * 0.18;
        g.gain.setValueAtTime(0.25, t0);
        g.gain.exponentialRampToValueAtTime(0.001, t0 + 0.15);
        s.connect(hp); hp.connect(g); g.connect(this.master);
        s.start(t0); s.stop(t0 + 0.16);
      }
    } catch (e) {}
  },
  // crash diarahkan lewat master (mute ikut berlaku)
  crash(rel) {
    if (!this.ctx) return false;
    if (!this.buf || !this.buf.crash) return false;
    try {
      const s = this.ctx.createBufferSource(); s.buffer = this.buf.crash;
      s.playbackRate.value = 0.9 + Math.random() * 0.25;
      const g = this.ctx.createGain(); g.gain.value = Math.min(0.65, 0.18 + rel / 700);
      s.connect(g); g.connect(this.master); s.start();
      if (rel > 220 && this.buf.glass) { // hantaman keras: + suara kaca
        const gs = this.ctx.createBufferSource(); gs.buffer = this.buf.glass;
        gs.playbackRate.value = 1.0 + Math.random() * 0.2;
        const gg = this.ctx.createGain(); gg.gain.value = Math.min(0.4, 0.1 + rel / 1200);
        gs.connect(gg); gg.connect(this.master); gs.start(this.ctx.currentTime + 0.03);
      }
      // bobot bawah (bodi): semburan noise lowpass singkat
      const dur = 0.15;
      const buf = this.ctx.createBuffer(1, this.ctx.sampleRate * dur, this.ctx.sampleRate);
      const dd = buf.getChannelData(0);
      for (let i = 0; i < dd.length; i++) dd[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / dd.length, 2);
      const ns = this.ctx.createBufferSource(); ns.buffer = buf;
      const f = this.ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 300;
      const ng = this.ctx.createGain(); ng.gain.value = Math.min(0.4, 0.1 + rel / 1000);
      ns.connect(f); f.connect(ng); ng.connect(this.master); ns.start();
      return true;
    } catch (e) { return false; }
  },
};
try { AudioSys.muted = localStorage.getItem('audioMute') === '1'; } catch (e) {}
