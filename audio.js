// Audio prosedural (WebAudio, tanpa file): mesin + decit ban + angin + bel.
// Start() dipanggil dari gesture user (klik) agar lolos autoplay-policy browser.
const AudioSys = {
  ctx: null, master: null, muted: false,
  eng: null, skidGain: null, windGain: null,
  init() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.muted ? 0 : 0.5;
      this.master.connect(this.ctx.destination);
      // noise buffer bersama
      const len = this.ctx.sampleRate * 1;
      const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      this.noiseBuf = buf;
      // MESIN: 2 osc gergaji + lowpass
      const o1 = this.ctx.createOscillator(); o1.type = 'sawtooth';
      const o2 = this.ctx.createOscillator(); o2.type = 'square';
      const f = this.ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 900;
      const g = this.ctx.createGain(); g.gain.value = 0;
      o1.connect(f); o2.connect(f); f.connect(g); g.connect(this.master);
      o1.start(); o2.start();
      this.eng = { o1, o2, f, g };
      // DECIT BAN: noise → bandpass 900Hz
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
    } catch (e) {}
  },
  setMuted(m) {
    this.muted = m;
    try { localStorage.setItem('audioMute', m ? '1' : '0'); } catch (e) {}
    if (this.master) this.master.gain.value = m ? 0 : 0.5;
  },
  // dipanggil tiap frame: car = mobil fokus, throttle 0..1
  update(car) {
    if (!this.ctx || !this.eng) return;
    const t = this.ctx.currentTime;
    const spd = Math.abs(car.speed || 0), top = car.topSpeed || 432;
    const frac = Math.max(0, Math.min(0.999, spd / top));
    const gear = Math.min(4, Math.floor(frac * 5));       // 5 gigi
    const inGear = frac * 5 - gear;                        // 0..1 per gigi
    const rpm = 0.25 + inGear * 0.75;
    const load = (car.input && car.input.throttle) || 0;
    const base = 65 + rpm * 165 + load * 25;
    this.eng.o1.frequency.setTargetAtTime(base, t, 0.03);
    this.eng.o2.frequency.setTargetAtTime(base * 1.5 + 4, t, 0.03);
    this.eng.f.frequency.setTargetAtTime(500 + rpm * 1400 + load * 600, t, 0.05);
    this.eng.g.gain.setTargetAtTime(0.05 + load * 0.10 + Math.min(0.04, spd / 9000), t, 0.05);
    // decit: drift / lockup / slide keras
    const slip = car.drifting ? 1 : (car.lockup ? 0.9 : 0);
    this.skidGain.gain.setTargetAtTime(slip * Math.min(0.22, 0.05 + spd / 2500), t, 0.05);
    this.windGain.gain.setTargetAtTime(Math.min(0.12, spd / 4200), t, 0.1);
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
  // suara kunci roda pit (impact wrench): noise kasar singkat
  pitGun() {
    if (!this.ctx) return;
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
    try {
      const dur = 0.18 + Math.min(0.25, rel / 1500);
      const buf = this.ctx.createBuffer(1, this.ctx.sampleRate * dur, this.ctx.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / d.length, 2);
      const src = this.ctx.createBufferSource(); src.buffer = buf;
      const f = this.ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 900 + rel * 3;
      const g = this.ctx.createGain(); g.gain.value = Math.min(0.5, 0.15 + rel / 900);
      src.connect(f); f.connect(g); g.connect(this.master); src.start();
      return true;
    } catch (e) { return false; }
  },
};
try { AudioSys.muted = localStorage.getItem('audioMute') === '1'; } catch (e) {}
