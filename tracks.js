// Track: centerline smooth (Catmull-Rom) + tema visual per sirkuit.
function makeTrack(name, desc, points, roadHalf, laps, theme) {
  let cum = [0], total = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i], b = points[(i+1)%points.length];
    total += Math.hypot(b.x-a.x, b.y-a.y);
    cum.push(total);
  }
  return { name, desc, points, roadHalf, laps, length: total, cum, theme };
}

// Catmull-Rom closed spline -> dense smooth points
// SCALE=2.8: lap ~40-65 detik + 1 trek endurance ~85s
const WORLD_SCALE = 2.8;
function smoothClosed(raw, samplesPer=10) {
  const n = raw.length, out = [];
  for (let i = 0; i < n; i++) {
    const p0 = raw[(i-1+n)%n], p1 = raw[i], p2 = raw[(i+1)%n], p3 = raw[(i+2)%n];
    for (let j = 0; j < samplesPer; j++) {
      const t = j/samplesPer, t2=t*t, t3=t2*t;
      out.push({
        x: 0.5*((2*p1.x)+(-p0.x+p2.x)*t+(2*p0.x-5*p1.x+4*p2.x-p3.x)*t2+(-p0.x+3*p1.x-3*p2.x+p3.x)*t3)*WORLD_SCALE,
        y: 0.5*((2*p1.y)+(-p0.y+p2.y)*t+(2*p0.y-5*p1.y+4*p2.y-p3.y)*t2+(-p0.y+3*p1.y-3*p2.y+p3.y)*t3)*WORLD_SCALE,
      });
    }
  }
  return out;
}
function cp(list){ return list.map(p=>({x:p[0],y:p[1]})); }

const TRACKS = [
  makeTrack("Sunset Roval",
    "Roval: chicane depan + esses infield. Slipstream + teknikal.",
    smoothClosed(cp([[-900,350],[-1050,0],[-900,-350],[-400,-560],[-150,-400],[50,-580],[250,-400],[400,-560],[950,-350],[1000,0],[950,350],[400,330],[150,520],[-150,330],[-400,560]]), 10),
    146, 3, { grass:['#3a7d5c','#2f6b4e'], deco:'trees' }),
  makeTrack("Naga Teknikal",
    "S-cepat + hairpin + stadium akhir. Uji late-braking.",
    smoothClosed(cp([[-900,-450],[-350,-550],[-100,-460],[100,-580],[250,-520],[700,-380],[820,-250],[880,-100],[900,-50],[1050,-50],[1100,50],[1050,130],[900,100],[700,250],[350,180],[100,420],[-50,330],[-250,480],[-500,250],[-750,350],[-850,150],[-1050,-100]]), 8),
    138, 3, { grass:['#4a7c59','#3a6b4a'], deco:'tires' }),
  makeTrack("Kota Neon",
    "Street circuit: T90 + chicane + underpass. Trek lurus panjang buat salip.",
    smoothClosed(cp([[-850,-550],[-450,-450],[-150,-600],[150,-450],[450,-600],[850,-550],[950,-450],[880,-250],[950,-50],[450,-50],[450,150],[950,150],[1050,150],[1080,280],[1050,400],[950,380],[950,550],[850,650],[450,550],[150,650],[-150,550],[-450,650],[-850,650],[-950,550],[-950,250],[-450,250],[-450,-50],[-880,-250],[-950,-450]]), 6),
    126, 2, { grass:['#3d3d4d','#34343f'], deco:'city' }),
  makeTrack("Gunung Kabut",
    "Gunung berliku: esses atas, kink kanan, S bawah. Hati-hati di T5.",
    smoothClosed(cp([[-1000,-300],[-600,-600],[-350,-690],[-200,-500],[-50,-550],[150,-350],[350,-600],[500,-600],[700,-550],[850,-450],[1000,-350],[1150,-350],[1200,-250],[1150,-170],[1000,-200],[1080,-100],[920,80],[900,150],[700,180],[600,300],[450,350],[100,200],[-100,350],[-200,500],[-400,420],[-550,560],[-700,550],[-880,620],[-980,400],[-1100,250]]), 8),
    130, 2, { grass:['#5a7d5a','#48684a'], deco:'rocks' }),
  makeTrack("Trans Jawa Endurance",
    "Maraton: esses atas, chicane kanan, hairpin ganda bawah, S-kiri.",
    smoothClosed(cp([
      [-1500,-600],[-1000,-950],[-300,-900],[-150,-690],[0,-920],[150,-690],[320,-920],
      [550,-780],[800,-900],[1100,-850],[1350,-750],[1600,-550],[1750,-400],[1800,-200],[1720,-50],[1650,-50],[1500,150],[1560,400],
      [1620,700],[1450,950],[1250,750],[1050,950],[700,800],[500,750],[100,1000],
      [-150,880],[-400,980],[-650,880],[-900,1000],[-1400,850],[-1550,650],[-1450,400],[-1650,200],[-1600,-100],[-1500,-350]
    ]), 8),
    140, 2, { grass:['#6b7d4a','#57683c'], deco:'trees' }),
  makeTrack("Lembah Ular",
    "Lintasan ular: 14 tikungan beruntun, hampir tanpa lurusan. Uji nyali + ban.",
    smoothClosed(cp([
      [700,-100],[500,-400],[150,-350],[100,-100],[-150,-250],[-450,-350],
      [-700,-150],[-620,0],[-550,100],[-700,350],[-400,400],[-250,150],[0,300],
      [300,400],[550,250],[480,120],[400,50]
    ]), 10),
    118, 3, { grass:['#3f6b4f','#33583f'], deco:'rocks' }),
  makeTrack("Gokart Piranha",
    "Sirkuit gokart padat: 20 tikungan dalam 1 menit. Duel bumper-to-bumper.",
    smoothClosed(cp([
      [500,-50],[350,-300],[100,-250],[50,-50],[-150,-200],[-350,-300],
      [-550,-150],[-450,50],[-600,250],[-350,300],[-200,100],[0,250],
      [250,300],[450,150],[300,0]
    ]), 10),
    112, 3, { grass:['#4a7c59','#3a6b4a'], deco:'tires' }),
];

function trackPointAt(track, s) {
  s = ((s % track.length) + track.length) % track.length;
  const pts = track.points, cum = track.cum;
  let lo=0, hi=cum.length-1;
  while (lo<hi-1){ const m=(lo+hi)>>1; if(cum[m]<=s) lo=m; else hi=m; }
  const a = pts[lo % pts.length], b = pts[(lo+1)%pts.length];
  const segLen = cum[lo+1]-cum[lo] || 1;
  const t = (s-cum[lo])/segLen;
  return {
    x: a.x+(b.x-a.x)*t, y: a.y+(b.y-a.y)*t,
    dirX: (b.x-a.x)/segLen, dirY: (b.y-a.y)/segLen,
    seg: lo
  };
}

function trackClosest(track, x, y) {
  const pts = track.points;
  let best = { dist: 1e9, s: 0, dirX:1, dirY:0, nx:0, ny:0, px:x, py:y };
  // track kini dense (~120-140 titik): cek semua masih murah
  for (let i=0;i<pts.length;i++){
    const a=pts[i], b=pts[(i+1)%pts.length];
    const abx=b.x-a.x, aby=b.y-a.y;
    const l2=abx*abx+aby*aby || 1;
    let t=((x-a.x)*abx+(y-a.y)*aby)/l2;
    t=Math.max(0,Math.min(1,t));
    const px=a.x+abx*t, py=a.y+aby*t;
    const d=Math.hypot(x-px,y-py);
    if(d<best.dist){
      const len=Math.sqrt(l2);
      best={ dist:d, s:track.cum[i]+len*t, dirX:abx/len, dirY:aby/len, nx:x-px, ny:y-py, px, py };
    }
  }
  return best;
}

// kelengkungan di TITIK s (jendela pendek) — untuk kecepatan saat ini, bukan ramalan jauh
function trackLocalCurv(track, s, win=280) {
  const p0=trackPointAt(track,s), p1=trackPointAt(track,s+win);
  const a0=Math.atan2(p0.dirY,p0.dirX), a1=Math.atan2(p1.dirY,p1.dirX);
  let d=Math.abs(a1-a0);
  if(d>Math.PI) d=Math.PI*2-d;
  return Math.min(1, d/1.1);
}
// tikungan tajam PERTAMA di depan: {dist, curv} — untuk late-braking fisika.
// curv = tersulit SEPANJANG tikungan (scan 450px ke dalam), bukan cuma di pintu masuk.
// (tanpa ini AI ngerem cukup untuk entry lalu melebar di tengah tikungan mengetat)
function cornerAhead(track, s, maxD=1800, step=95) {
  for(let d=190; d<=maxD; d+=step){
    const c=trackLocalCurv(track, s+d, 280);
    if(c>0.30){
      let worst=c;
      for(let dd=d+95; dd<=d+450; dd+=95) worst=Math.max(worst, trackLocalCurv(track, s+dd, 280));
      return { dist:d, curv:worst };
    }
  }
  return null;
}
// kelengkungan multi-sample: sampel DEKAT bobot penuh, sampel JAUH didiskon
// (dulu max mentah → tikungan 4 detik ke depan bikin AI merayap di lurusan = kelihatan tolol)
function trackCurvature(track, s) {
  const samples = [[260,580,1],[580,1050,0.85],[1050,1550,0.65]];
  let mx = 0;
  for (const [l1,l2,w] of samples) {
    const p1=trackPointAt(track,s+l1), p2=trackPointAt(track,s+l2);
    const a1=Math.atan2(p1.dirY,p1.dirX), a2=Math.atan2(p2.dirY,p2.dirX);
    let d=Math.abs(a2-a1);
    if(d>Math.PI) d=Math.PI*2-d;
    mx=Math.max(mx, d/1.1*w);
  }
  return Math.min(1, mx);
}
// sudut tikungan 250px ke depan (untuk papan rem / chevron)
function trackAheadAngle(track, s, look=300) {
  const p0=trackPointAt(track,s), p1=trackPointAt(track,s+look);
  const a0=Math.atan2(p0.dirY,p0.dirX), a1=Math.atan2(p1.dirY,p1.dirX);
  let d=a1-a0;
  while(d>Math.PI)d-=Math.PI*2; while(d<-Math.PI)d+=Math.PI*2;
  return d;
}
