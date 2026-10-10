// evolve.js — Genetic Algorithm untuk parameter otak AI (jalan cepat).
// Fisika + AI di bawah ini mirror dari game.js stepCar/collisions & ai.js updateAI.
// Kalau tuning fisika di game.js, samakan juga fungsi stepV/simColl di sini.
//
// Node (cepat, disarankan):
//   node evolve.js [generasi=10] [populasi=14] [detik=40]
//   → tulis brains-evolved.json + brains-tuned.js
// Browser:
//   Evolution.run({generations:5, popSize:10, seconds:25, onProgress}) → Promise<[6 brain]>

(function (root) {
'use strict';

// ---- ruang genom: 9 parameter controller (sama key-nya dengan BRAINS di ai.js) ----
const GENES = [
  { key: 'aggro',     min: 0.30, max: 0.90 },
  { key: 'risk',      min: 0.94, max: 1.05 },
  { key: 'overDist',  min: 70,   max: 160  },
  { key: 'diveAggro', min: 0.30, max: 0.70 },
  { key: 'steerGain', min: 2.50, max: 3.50 },
  { key: 'defend',    min: 0.00, max: 1.00 },
  { key: 'mistake',   min: 0.20, max: 2.50 },
  { key: 'draft',     min: 0.50, max: 2.00 },
  { key: 'laneStyle', min: -1.0, max: 1.00 },
];
const NAMES6 = [
  { id: 'taktisi',   label: 'Taktisi',       icon: '🧠' },
  { id: 'madDog',    label: 'Mad Dog',       icon: '🤬' },
  { id: 'profesor',  label: 'Profesor',      icon: '📐' },
  { id: 'tukangBlok',label: 'Tukang Blok',   icon: '🛡️' },
  { id: 'rookie',    label: 'Rookie',        icon: '🍼' },
  { id: 'pemburu',   label: 'Pemburu Draft', icon: '🌪️' },
];
// Gen yang dievolusi: racecraft saja. `mistake` DIKUNCI per peran (kepribadian) —
 // kalau ikut dievolusi, GA mengeksploitasi weaving untuk farm salip + semua juara jadi kembar.
const EVO_GENES = GENES.filter(g => g.key !== 'mistake');
const MISTAKE_LADDER = [0.5, 1.6, 0.3, 0.7, 2.2, 0.8]; // peran Taktisi..Pemburu, seperti desain awal
// Lawan baseline tetap (nilai asli sebelum evolusi) biar fitness stabil antar generasi.
const BASE_BRAINS = [
  { aggro: 0.45, risk: 1.00, overDist: 110, diveAggro: 0.45, steerGain: 3.0, defend: 0.3, mistake: 0.5, draft: 1.0, laneStyle: 0 },
  { aggro: 0.85, risk: 1.04, overDist: 150, diveAggro: 0.35, steerGain: 3.4, defend: 0.8, mistake: 1.6, draft: 0.7, laneStyle: 1 },
  { aggro: 0.35, risk: 0.98, overDist: 90,  diveAggro: 0.60, steerGain: 2.7, defend: 0.2, mistake: 0.3, draft: 1.2, laneStyle: -1 },
  { aggro: 0.60, risk: 0.97, overDist: 100, diveAggro: 0.55, steerGain: 3.1, defend: 1.0, mistake: 0.7, draft: 0.9, laneStyle: 0 },
  { aggro: 0.50, risk: 0.94, overDist: 95,  diveAggro: 0.65, steerGain: 2.9, defend: 0.1, mistake: 2.2, draft: 1.0, laneStyle: 0 },
  { aggro: 0.55, risk: 1.01, overDist: 140, diveAggro: 0.40, steerGain: 3.2, defend: 0.4, mistake: 0.8, draft: 1.8, laneStyle: 1 },
];

function rnd(a, b) { return a + Math.random() * (b - a); }
function randomGenome() { return EVO_GENES.map(g => rnd(g.min, g.max)); }
function genomeToBrain(g, identity) {
  const b = { id: identity.id, label: identity.label, icon: identity.icon };
  EVO_GENES.forEach((def, i) => { b[def.key] = g[i]; });
  const role = NAMES6.indexOf(identity);
  b.mistake = MISTAKE_LADDER[role >= 0 ? role : 0];
  return b;
}
function dist2(a, b) {
  let s = 0;
  for (let i = 0; i < EVO_GENES.length; i++) {
    const r = EVO_GENES[i].max - EVO_GENES[i].min;
    const d = (a[i] - b[i]) / r;
    s += d * d;
  }
  return Math.sqrt(s / EVO_GENES.length);
}

// ---- fisika mirror (dari game.js stepCar, tanpa DOM) ----
function stepV(car, track, dt, stats) {
  const inp = car.input;
  if (car.vx === undefined) { car.vx = Math.cos(car.angle) * car.speed; car.vy = Math.sin(car.angle) * car.speed; car.damage = 0; }
  if (inp.reverse) {
    car.speed += (-190 - car.speed) * Math.min(1, dt * 3);
    car.angle += (inp.steer || 1) * 1.8 * dt;
    car.vx = Math.cos(car.angle) * car.speed; car.vy = Math.sin(car.angle) * car.speed;
    car.x += car.vx * dt; car.y += car.vy * dt;
    car.lastS = trackClosest(track, car.x, car.y).s;
    stats.reverses++;
    return;
  }
  const info = trackClosest(track, car.x, car.y);
  const off = info.dist > track.roadHalf;
  const onKerb = !off && info.dist > track.roadHalf * 0.82;
  if (off) stats.off++;
  const fx = Math.cos(car.angle), fy = Math.sin(car.angle), rx = -fy, ry = fx;
  let vF = car.vx * fx + car.vy * fy, vL = car.vx * rx + car.vy * ry;
  const spd = Math.abs(vF);
  const dmg = car.damage || 0;
  vF += (inp.throttle * 360 * (1 - dmg * 0.7) - Math.sign(vF) * inp.brake * 780 * (spd > 5 ? 1 : 0) - vF * (0.32 + ((car.ai && car.ai.tire) || 0) * 0.25 + (off ? 1.2 : 0) + (onKerb ? 0.15 : 0))) * dt;
  let grip = (off ? 3.1 : (onKerb ? 4.6 : 7.3)) * (1 + Math.min(0.35, spd / 1500));
  const throt = inp.throttle || 0;
  if (throt > 0.3) grip *= (1 - throt * 0.20 * Math.max(0, 1 - spd / 420));
  if ((inp.brake || 0) > 0.7 && spd > 300) grip *= 0.85;
  if (car.ai) grip *= 1.06 * (car.ai.tire ? (1 - car.ai.tire * 0.12) : 1);
  if (typeof compoundGrip === 'function') grip *= compoundGrip(car.compound || 'slick', car.wet || 0);
  vL *= Math.exp(-grip * dt);
  const dir = vF >= 0 ? 1 : -1;
  const under = 1 / (1 + Math.pow(spd / 560, 2) * 1.6);
  car.angle += inp.steer * 2.6 * under * Math.max(0.5, Math.min(1, spd / 150)) * (1 + (inp.brake || 0) * 0.28 - (inp.throttle || 0) * 0.12) * dir * dt;
  if (car.spin) { car.angle += car.spin * dt; car.spin *= Math.max(0, 1 - 3.5 * dt); if (Math.abs(car.spin) < 0.05) car.spin = 0; }
  const nfx = Math.cos(car.angle), nfy = Math.sin(car.angle), nrx = -nfy, nry = nfx;
  car.vx = nfx * vF + nrx * vL; car.vy = nfy * vF + nry * vL;
  const topEff = car.topSpeed * (1 - dmg * 0.5) * (off ? 0.62 : (onKerb ? 0.92 : 1));
  const fN = car.vx * nfx + car.vy * nfy;
  if (fN > topEff) { const ex = fN - topEff; car.vx -= nfx * ex; car.vy -= nfy * ex; }
  car.x += car.vx * dt; car.y += car.vy * dt;
  car.speed = car.vx * nfx + car.vy * nfy;
  const s2 = trackClosest(track, car.x, car.y).s;
  let ds = s2 - car.lastS;
  if (ds < -track.length / 2) ds += track.length;
  if (ds > track.length / 2) ds -= track.length;
  car.totalS += Math.max(0, ds);
  if (ds > 0 && car.lastS > track.length - 650 && s2 < 650) car.lap++;
  car.lastS = s2;
  if (car.hitCd > 0) car.hitCd -= dt;
}

function simColl(cars, stats) {
  for (let i = 0; i < cars.length; i++) for (let j = i + 1; j < cars.length; j++) {
    const a = cars[i], b = cars[j];
    const dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy);
    if (d < 34 && d > 0.1) {
      const nx = dx / d, ny = dy / d, ov = (34 - d) / 2 + 0.5;
      a.x -= nx * ov; a.y -= ny * ov; b.x += nx * ov; b.y += ny * ov;
      if ((a.hitCd || 0) > 0 || (b.hitCd || 0) > 0) continue;
      a.hitCd = 0.25; b.hitCd = 0.25;
      const rvx = b.vx - a.vx, rvy = b.vy - a.vy;
      const vn = rvx * nx + rvy * ny;
      const impact = Math.abs(Math.min(0, vn));
      if (vn < 0) {
        const jj = -(1 + 0.55) * vn / 2;
        a.vx -= jj * nx; a.vy -= jj * ny; b.vx += jj * nx; b.vy += jj * ny;
        a.vx *= 0.985; a.vy *= 0.985; b.vx *= 0.985; b.vy *= 0.985;
        const offC = Math.max(-1, Math.min(1, ((b.x - a.x) * -ny + (b.y - a.y) * nx) / 34));
        a.spin = (a.spin || 0) - offC * impact / 160; b.spin = (b.spin || 0) + offC * impact / 160;
        for (const c of [a, b]) c.speed = c.vx * Math.cos(c.angle) + c.vy * Math.sin(c.angle);
      }
      if (impact > 140) stats.bigHits++;
    }
  }
}

// ---- evaluasi: 1 genom start paling belakang vs 5 baseline ----
function evaluate(genome, track, seconds, difficulty) {
  const evoBrain = genomeToBrain(genome, NAMES6[0]);
  const cars = [];
  for (let i = 0; i < 6; i++) {
    const row = Math.floor(i / 2), side = (i % 2 === 0 ? -1 : 1);
    const s = track.length - 200 - row * 105;
    const p = trackPointAt(track, s);
    const nx = -p.dirY, ny = p.dirX;
    const isEvo = (i === 5); // grid paling belakang → harus menyalip
    const brain = isEvo ? evoBrain : Object.assign({ id: 'base' + i }, BASE_BRAINS[i % BASE_BRAINS.length]);
    cars.push({
      x: p.x + nx * side * 40, y: p.y + ny * side * 40,
      angle: Math.atan2(p.dirY, p.dirX), speed: 0, vx: 0, vy: 0,
      topSpeed: 432, input: {}, ai: createAI({ brain, lane: side * 0.4 }), wet: 0, compound: 'slick',
      lap: 0, lastS: s, totalS: 0, hitCd: 0, spin: 0, isEvo,
    });
  }
  const stats = { bigHits: 0, off: 0, reverses: 0 };
  const dt = 1 / 60, steps = Math.floor(seconds / dt);
  let passes = 0, lastRank = 6;
  const evo = cars[5];
  for (let f = 0; f < steps; f++) {
    let best = -1e18;
    for (const c of cars) best = Math.max(best, c.lap * track.length + c.totalS);
    for (const car of cars) {
      updateAI(car, track, cars, difficulty, dt, 'race', best - (car.lap * track.length + car.totalS));
      stepV(car, track, dt, car.isEvo ? stats : { bigHits: 0, off: 0, reverses: 0 });
    }
    simColl(cars, stats);
    if (f % 30 === 0) {
      const order = cars.slice().sort((a, b) => (b.lap * track.length + b.totalS) - (a.lap * track.length + a.totalS));
      const rank = order.indexOf(evo) + 1;
      if (rank < lastRank) passes += (lastRank - rank);
      lastRank = rank;
    }
  }
  if (!isFinite(evo.totalS)) return { fitness: -1e9, stats, progress: 0 };
  const fitness = evo.totalS + passes * 400 - stats.bigHits * 300 - stats.off * 0.3 - stats.reverses * 150;
  return { fitness, stats, progress: Math.round(evo.totalS), passes };
}

// ---- GA ----
function tournament(pop, k) {
  let best = null;
  for (let i = 0; i < (k || 2); i++) {
    const c = pop[Math.floor(Math.random() * pop.length)];
    if (!best || c.fitness > best.fitness) best = c;
  }
  return best.genome.slice();
}
function crossover(a, b) {
  return a.map((v, i) => (Math.random() < 0.5 ? v : b[i]));
}
function mutate(g) {
  return g.map((v, i) => {
    if (Math.random() < 0.35) {
      const r = EVO_GENES[i].max - EVO_GENES[i].min;
      v += (Math.random() + Math.random() + Math.random() - 1.5) / 1.5 * r * 0.15;
      v = Math.max(EVO_GENES[i].min, Math.min(EVO_GENES[i].max, v));
    }
    return v;
  });
}

const tick = () => new Promise(r => setTimeout(r, 0));

async function run(opts) {
  const generations = opts.generations || 10;
  const popSize = opts.popSize || 14;
  const seconds = opts.seconds || 40;
  const difficulty = opts.difficulty || 0.85;
  const onProgress = opts.onProgress || (() => {});
  const tracks = opts.tracks; // butuh TRACKS global (browser) / dilewatkan (node)
  let pop = [];
  for (let i = 0; i < popSize; i++) pop.push({ genome: randomGenome(), fitness: -1e18 });
  let history = [];
  for (let gen = 0; gen < generations; gen++) {
    const track = tracks[gen % tracks.length];
    for (let i = 0; i < pop.length; i++) {
      const r = evaluate(pop[i].genome, track, seconds, difficulty);
      pop[i].fitness = r.fitness; pop[i].detail = r;
      if (opts.chunked) await tick();
    }
    pop.sort((a, b) => b.fitness - a.fitness);
    history.push({ gen, track: track.name, best: Math.round(pop[0].fitness), progress: pop[0].detail.progress, passes: pop[0].detail.passes });
    onProgress({ gen, generations, best: pop[0], history });
    const next = [pop[0], pop[1]]; // elit 2
    while (next.length < popSize) {
      const child = mutate(crossover(tournament(pop, 2), tournament(pop, 2)));
      next.push({ genome: child, fitness: -1e18 });
    }
    pop = next;
  }
  pop.sort((a, b) => b.fitness - a.fitness);
  return { best: pop[0], pop, history };
}

// pilih 6 genom juara yang saling beda (biar 6 otak tidak kembar)
function pickTop6(pop) {
  const sorted = pop.slice().sort((a, b) => b.fitness - a.fitness);
  const picked = [sorted[0]];
  for (const c of sorted) {
    if (picked.length >= 6) break;
    if (picked.every(p => dist2(p.genome, c.genome) > 0.20)) picked.push(c);
  }
  let i = 1;
  while (picked.length < 6) { picked.push(sorted[i % sorted.length]); i++; }
  return picked.slice(0, 6).map((p, k) => genomeToBrain(p.genome, NAMES6[k]));
}

root.Evolution = { run, evaluate, pickTop6, randomGenome, genomeToBrain, GENES, BASE_BRAINS };

// ---- CLI node ----
if (typeof module !== 'undefined' && typeof require !== 'undefined' && require.main === module) {
  const fs = require('fs');
  const path = require('path');
  const dir = __dirname;
  const load = f => fs.readFileSync(path.join(dir, f), 'utf8');
  const api = new Function(load('tracks.js') + '\n' + load('ai.js') +
    '\nreturn {TRACKS,trackClosest,trackPointAt,trackCurvature,trackAheadAngle,createAI,updateAI,BRAINS,brainByIndex};')();
  Object.assign(globalThis, api);
  const gens = parseInt(process.argv[2] || '10', 10);
  const popN = parseInt(process.argv[3] || '14', 10);
  const secs = parseInt(process.argv[4] || '40', 10);
  console.log(`Evolusi: ${gens} generasi x ${popN} genom x ${secs}s, track rotasi.`);
  const t0 = Date.now();
  run({ generations: gens, popSize: popN, seconds: secs, tracks: TRACKS }).then(({ best, pop, history }) => {
    for (const h of history) console.log(`gen ${h.gen} [${h.track}] best=${h.best} prog=${h.progress} passes=${h.passes}`);
    const top6 = pickTop6(pop);
    // validasi juara di semua track
    console.log('--- validasi top6 di semua track (40s) ---');
    top6.forEach((b, k) => {
      const g = EVO_GENES.map(def => b[def.key]);
      const line = TRACKS.map(t => {
        const r = evaluate(g, t, 40, 0.85);
        return `${t.name.split(' ')[0]}:${r.progress}/${r.passes}`;
      }).join(' ');
      console.log(`${b.icon} ${b.label}: ${line}`);
    });
    fs.writeFileSync(path.join(dir, 'brains-evolved.json'), JSON.stringify({ meta: { gens, popN, secs, ms: Date.now() - t0 }, brains: top6 }, null, 2));
    fs.writeFileSync(path.join(dir, 'brains-tuned.js'),
      `// OTOMATIS oleh evolve.js — parameter otak hasil evolusi. Hapus file ini untuk kembali ke default.\n` +
      `var EVOLVED_BRAINS = ${JSON.stringify(top6.map(b => { const o = {}; GENES.forEach(def => { o[def.key] = +b[def.key].toFixed(4); }); return o; }))};\n`);
    console.log(`OK ${(Date.now() - t0) / 1000}s → brains-evolved.json + brains-tuned.js`);
  });
}
})(typeof window !== 'undefined' ? window : globalThis);
