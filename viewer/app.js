(function () {
'use strict';
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const cv = $('#cv'), ctx = cv.getContext('2d');
let W = 0, H = 0, DPR = 1;
// 미리보기 모드: 확장 안이나 ?compact 주소에서는 별만 띄우고, 별을 눌렀을 때만 설명을 엽니다
const EMBED = !!window.__EMBED__;
const COMPACT = EMBED || new URLSearchParams(location.search).has('compact');
document.body.classList.toggle('compact', COMPACT);
const editor = EMBED ? acquireVsCodeApi() : null;
let sky = null, started = false;
function resize() { DPR = window.devicePixelRatio || 1; W = innerWidth; H = innerHeight; cv.width = W * DPR; cv.height = H * DPR; cv.style.width = W + 'px'; cv.style.height = H + 'px'; sky = null; if (started && COMPACT) fit(null); }

// 쉬고 있는 점은 차분한 색으로 두어, 불빛만 눈에 띄게 합니다
const PALETTE = ['#7f8fb5', '#8a84b0', '#6f9bad', '#a08aa8', '#7fa39b', '#9aa3bd', '#7a88a0', '#a394a0'];
const GLOW = [141, 255, 176];
const GLOW_HEX = '#8dffb0';
const CALM = matchMedia('(prefers-reduced-motion: reduce)').matches;
const CONCEPT = '#ffc27a';
const hashStr = (s) => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; };
const rnd = (i) => { const x = Math.sin(i * 12.9898 + 78.233) * 43758.5453; return x - Math.floor(x); };

// 우주 배경: 먼 별과 옅은 성운을 한 번만 그려 두고 매 프레임 복사합니다
function drawSky() {
  const c = document.createElement('canvas'); c.width = W * DPR; c.height = H * DPR;
  const g = c.getContext('2d'); g.scale(DPR, DPR);
  const bg = g.createRadialGradient(W / 2, H / 2, 0, W / 2, H / 2, Math.max(W, H) * .75);
  bg.addColorStop(0, '#0d1120'); bg.addColorStop(1, '#05060c');
  g.fillStyle = bg; g.fillRect(0, 0, W, H);
  [[.22, .28, '60,70,150'], [.78, .7, '30,110,110']].forEach(([x, y, c2]) => {
    const n = g.createRadialGradient(W * x, H * y, 0, W * x, H * y, Math.max(W, H) * .4);
    n.addColorStop(0, `rgba(${c2},.13)`); n.addColorStop(1, `rgba(${c2},0)`);
    g.fillStyle = n; g.fillRect(0, 0, W, H);
  });
  const count = Math.min(900, Math.round(W * H / 3200));
  for (let i = 0; i < count; i++) {
    const big = rnd(i + 11) > .96;
    g.fillStyle = `rgba(${rnd(i + 5) > .8 ? '190,210,255' : '235,238,245'},${.15 + rnd(i + 3) * (big ? .6 : .4)})`;
    g.beginPath(); g.arc(rnd(i + 1) * W, rnd(i + 2) * H, big ? 1 + rnd(i) * .5 : .3 + rnd(i) * .5, 0, Math.PI * 2); g.fill();
  }
  return c;
}

// ───────── 상태 ─────────
let D = null, nodes = [], byId = new Map(), edges = [], changes = [], changeById = new Map();
const adj = new Map();           // id -> Set(id)
let pulse = new Set(), heat = new Map(), pulseEdges = [];
const st = { focus: null, sel: null, hover: null, hoverEdge: null, search: '', showOld: true, showCon: true, showLab: false };
const cam = { x: 0, y: 0, k: 1 }, camT = { x: 0, y: 0, k: 1, active: false };
let alpha = 1;
const drag = { node: null, pan: false, sx: 0, sy: 0, moved: 0, lx: 0, ly: 0 };

// ───────── 데이터 적재 ─────────
function load(d) {
  const old = new Map(nodes.map((n) => [n.id, n]));
  D = d; nodes = []; byId.clear(); adj.clear();
  st.hover = null; st.hoverEdge = null; const dragged = drag.node && drag.node.id;
  const groups = [...new Set(d.nodes.map((n) => n.group))].sort();
  d.nodes.forEach((n, i) => {
    const o = old.get(n.id);
    const g = groups.indexOf(n.group), ang = (g / Math.max(1, groups.length)) * Math.PI * 2;
    const R = 160 + 60 * Math.sqrt(groups.length);
    const N = Object.assign({}, n, {
      x: o ? o.x : Math.cos(ang) * R + (rnd(i) - .5) * 120, y: o ? o.y : Math.sin(ang) * R + (rnd(i + 7) - .5) * 120,
      vx: 0, vy: 0, fresh: !o,
      color: n.kind === 'concept' ? CONCEPT : PALETTE[hashStr(n.group || '') % PALETTE.length],
    });
    nodes.push(N); byId.set(N.id, N); adj.set(N.id, new Set());
  });
  drag.node = dragged ? byId.get(dragged) || null : null;
  edges = d.edges.filter((e) => byId.has(e.source) && byId.has(e.target)).map((e) => Object.assign({}, e, { s: byId.get(e.source), t: byId.get(e.target) }));
  edges.forEach((e) => { adj.get(e.s.id).add(e.t.id); adj.get(e.t.id).add(e.s.id); });
  nodes.forEach((n) => {
    n.deg = adj.get(n.id).size;
    n.r = n.kind === 'concept' ? 6 + Math.sqrt(n.deg) * 1.6 : 3.6 + Math.sqrt(n.deg) * 1.8;
    if (n.fresh && old.size) { // 실시간 갱신으로 새로 생긴 노드는 이웃 근처에서 등장
      const nb = [...adj.get(n.id)].map((id) => old.get(id)).filter(Boolean)[0];
      if (nb) { n.x = nb.x + (Math.random() - .5) * 40; n.y = nb.y + (Math.random() - .5) * 40; }
    }
  });
  changes = d.changes.slice().sort((a, b) => b.time - a.time);
  changeById = new Map(changes.map((c) => [c.id, c]));
  changes.forEach((c) => {
    const s = new Set(c.files.map((f) => f.path));
    (c.events || []).forEach((e) => s.add(e.file));
    (c.concepts || []).forEach((x) => s.add('concept:' + x));
    c._ids = [...s].filter((id) => byId.has(id));
  });
  if (st.focus && !changeById.has(st.focus)) st.focus = null;
  $('#pname').textContent = d.project || 'Mycena';
  const files = nodes.filter((n) => n.kind === 'file' && n.exists).length;
  $('#stats').textContent = `파일 ${files} · 연결 ${edges.filter((e) => e.type !== 'concept').length} · Claude 작업 ${changes.length}`;
  computeHeat(); renderTimeline();
  alpha = old.size ? Math.max(alpha, .35) : 1;
}

function focusedChange() { return changeById.get(st.focus) || changes[0] || null; }
function computeHeat() {
  pulse = new Set(); heat = new Map();
  const fc = focusedChange();
  changes.forEach((c, i) => {
    if (fc && c.id === fc.id) { c._ids.forEach((id) => pulse.add(id)); return; }
    if (!st.showOld) return;
    const h = Math.max(.16, .62 * Math.pow(.8, i));
    c._ids.forEach((id) => heat.set(id, Math.max(heat.get(id) || 0, h)));
  });
  pulseEdges = edges.filter((e) => pulse.has(e.s.id) && pulse.has(e.t.id));
}
const visible = (n) => st.showCon || n.kind !== 'concept';

// ───────── 물리 시뮬레이션 (Obsidian 느낌의 force layout) ─────────
function tick() {
  if (alpha < 0.004 && !drag.node) return;
  const vs = nodes.filter(visible), n = vs.length;
  const centers = new Map();
  vs.forEach((a) => { if (a.kind === 'concept') return; const c = centers.get(a.group) || { x: 0, y: 0, n: 0 }; c.x += a.x; c.y += a.y; c.n++; centers.set(a.group, c); });
  for (let i = 0; i < n; i++) {
    const a = vs[i];
    for (let j = i + 1; j < n; j++) {
      const b = vs[j]; let dx = a.x - b.x, dy = a.y - b.y; let d2 = dx * dx + dy * dy;
      if (d2 > 160000) continue;
      if (d2 < 1) { dx = rnd(i + j) - .5; dy = rnd(i * j + 3) - .5; d2 = 1; }
      const f = (1400 * alpha) / d2; const fx = dx * f, fy = dy * f;
      a.vx += fx; a.vy += fy; b.vx -= fx; b.vy -= fy;
    }
  }
  edges.forEach((e) => {
    if (!visible(e.s) || !visible(e.t)) return;
    const dx = e.t.x - e.s.x, dy = e.t.y - e.s.y, d = Math.sqrt(dx * dx + dy * dy) || 1;
    const L = e.type === 'concept' ? 95 : 62, k = (e.type === 'concept' ? .025 : .055) * alpha;
    const f = (d - L) * k / d;
    e.s.vx += dx * f; e.s.vy += dy * f; e.t.vx -= dx * f; e.t.vy -= dy * f;
  });
  vs.forEach((a) => {
    const c = centers.get(a.group);
    if (c && c.n > 1) { a.vx += (c.x / c.n - a.x) * .012 * alpha; a.vy += (c.y / c.n - a.y) * .012 * alpha; }
    a.vx -= a.x * .0035 * alpha; a.vy -= a.y * .0035 * alpha;
    if (a === drag.node) { a.vx = a.vy = 0; return; }
    a.vx *= .58; a.vy *= .58; a.x += a.vx; a.y += a.vy;
  });
  alpha *= .992;
}

// ───────── 그리기 ─────────
const toScreen = (x, y) => [W / 2 + cam.x + x * cam.k, H / 2 + cam.y + y * cam.k];
const toWorld = (sx, sy) => [(sx - W / 2 - cam.x) / cam.k, (sy - H / 2 - cam.y) / cam.k];
const rgba = (c, a) => `rgba(${c[0]},${c[1]},${c[2]},${a})`;
let searchHits = null;

function activeSet() {
  if (st.hover) { const s = new Set(adj.get(st.hover.id)); s.add(st.hover.id); return s; }
  if (st.hoverEdge) return new Set([st.hoverEdge.s.id, st.hoverEdge.t.id]);
  if (searchHits) return searchHits;
  return null;
}

function draw(t) {
  if (camT.active) {
    cam.x += (camT.x - cam.x) * .14; cam.y += (camT.y - cam.y) * .14; cam.k += (camT.k - cam.k) * .14;
    if (Math.abs(camT.x - cam.x) < .5 && Math.abs(camT.y - cam.y) < .5 && Math.abs(camT.k - cam.k) < .002) camT.active = false;
  }
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  ctx.clearRect(0, 0, W, H);
  if (!sky) sky = drawSky();
  ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.drawImage(sky, 0, 0);

  ctx.setTransform(DPR * cam.k, 0, 0, DPR * cam.k, DPR * (W / 2 + cam.x), DPR * (H / 2 + cam.y));
  const act = activeSet();
  const selId = st.sel && st.sel.type === 'node' ? st.sel.id : null;
  const selEdge = st.sel && st.sel.type === 'edge' ? st.sel.edge : null;
  const k = cam.k;

  // 1) 엣지
  edges.forEach((e) => {
    if (!visible(e.s) || !visible(e.t)) return;
    const inAct = act ? act.has(e.s.id) && act.has(e.t.id) && (!st.hover || e.s === st.hover || e.t === st.hover) : false;
    const isPulse = pulse.has(e.s.id) && pulse.has(e.t.id);
    const isSel = e === selEdge || (selId && (e.s.id === selId || e.t.id === selId));
    let a = act ? (inAct ? .75 : .04) : (isPulse ? .55 : .16);
    if (isSel) a = Math.max(a, .7);
    if (e === st.hoverEdge) a = .95;
    ctx.beginPath(); ctx.moveTo(e.s.x, e.s.y); ctx.lineTo(e.t.x, e.t.y);
    ctx.setLineDash(e.type === 'relation' ? [5 / k, 4 / k] : e.type === 'concept' ? [1.5 / k, 3.5 / k] : []);
    ctx.lineWidth = (e === st.hoverEdge || e === selEdge ? 2.2 : isPulse ? 1.5 : 1) / k;
    ctx.strokeStyle = isPulse && !act ? rgba(GLOW, a) : e.type === 'concept' ? `rgba(255,194,122,${a * .8})` : e.type === 'relation' ? `rgba(180,160,210,${a})` : `rgba(150,160,185,${a})`;
    ctx.stroke();
    if (k > 1.15 && e.type === 'import' && (a > .3)) arrow(e, a);
  });
  ctx.setLineDash([]);

  // 2) 불빛 (가산 혼합)
  ctx.globalCompositeOperation = 'lighter';
  const ph = t / 1000;
  nodes.forEach((n, i) => {
    if (!visible(n)) return;
    const isP = pulse.has(n.id), h = heat.get(n.id) || 0;
    if (!isP && !h) return;
    const dimmed = act && !act.has(n.id);
    const L = isP ? 1 : h;
    const breathe = isP && !CALM ? 1 + .22 * Math.sin(ph * 3.2 + i) : 1;
    const R = n.r * (isP ? 6.5 : 3 + 3 * h) * breathe;
    const gr = ctx.createRadialGradient(n.x, n.y, 0, n.x, n.y, R);
    const base = (dimmed ? .25 : 1) * (isP ? .55 : .32 * L);
    gr.addColorStop(0, rgba(GLOW, base)); gr.addColorStop(.35, rgba(GLOW, base * .45)); gr.addColorStop(1, rgba(GLOW, 0));
    ctx.fillStyle = gr; ctx.beginPath(); ctx.arc(n.x, n.y, R, 0, Math.PI * 2); ctx.fill();
    if (isP && !dimmed && !CALM) { // 퍼져 나가는 빛의 고리
      const f = (ph * .55 + rnd(i)) % 1;
      ctx.beginPath(); ctx.arc(n.x, n.y, n.r + f * n.r * 7, 0, Math.PI * 2);
      ctx.strokeStyle = rgba(GLOW, .5 * (1 - f)); ctx.lineWidth = 1.4 / k; ctx.stroke();
    }
  });
  // 작업 파일 사이를 흐르는 빛 입자
  if (!act && !CALM) pulseEdges.forEach((e, i) => {
    if (!visible(e.s) || !visible(e.t)) return;
    for (let q = 0; q < 2; q++) {
      const f = (ph * .45 + q * .5 + rnd(i * 3)) % 1;
      const x = e.s.x + (e.t.x - e.s.x) * f, y = e.s.y + (e.t.y - e.s.y) * f;
      const gr = ctx.createRadialGradient(x, y, 0, x, y, 5 / Math.sqrt(k));
      gr.addColorStop(0, 'rgba(225,255,235,.95)'); gr.addColorStop(1, 'rgba(141,255,176,0)');
      ctx.fillStyle = gr; ctx.beginPath(); ctx.arc(x, y, 5 / Math.sqrt(k), 0, Math.PI * 2); ctx.fill();
    }
  });
  ctx.globalCompositeOperation = 'source-over';

  // 3) 노드
  nodes.forEach((n) => {
    if (!visible(n)) return;
    const dimmed = act && !act.has(n.id);
    const isP = pulse.has(n.id);
    if (!dimmed && n.exists && n.kind !== 'concept') { // 쉬고 있는 별의 옅은 빛무리
      ctx.globalAlpha = .13; ctx.fillStyle = n.color;
      ctx.beginPath(); ctx.arc(n.x, n.y, n.r * 2.3, 0, Math.PI * 2); ctx.fill();
    }
    ctx.globalAlpha = dimmed ? .14 : 1;
    ctx.beginPath();
    if (n.kind === 'concept') { const r = n.r; ctx.moveTo(n.x, n.y - r); ctx.lineTo(n.x + r, n.y); ctx.lineTo(n.x, n.y + r); ctx.lineTo(n.x - r, n.y); ctx.closePath(); }
    else ctx.arc(n.x, n.y, n.r, 0, Math.PI * 2);
    if (!n.exists) { ctx.setLineDash([2 / k, 2 / k]); ctx.strokeStyle = '#ff9b94'; ctx.lineWidth = 1.2 / k; ctx.stroke(); ctx.setLineDash([]); }
    else { ctx.fillStyle = isP ? '#d8ffe5' : n.color; ctx.fill(); }
    if (n.id === selId) { ctx.beginPath(); ctx.arc(n.x, n.y, n.r + 4 / k, 0, Math.PI * 2); ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.6 / k; ctx.stroke(); }
    if (n === st.hover) { ctx.beginPath(); ctx.arc(n.x, n.y, n.r + 2.5 / k, 0, Math.PI * 2); ctx.strokeStyle = 'rgba(255,255,255,.7)'; ctx.lineWidth = 1 / k; ctx.stroke(); }
  });
  ctx.globalAlpha = 1;

  // 3.5) 폴더 이름: 불빛이 그래프의 어느 영역인지 바로 알 수 있게
  if (k < 1.35) {
    const gs = new Map();
    nodes.forEach((n) => { if (n.kind === 'concept' || !visible(n)) return; const c = gs.get(n.group) || { x: 0, y: 0, n: 0, hot: false }; c.x += n.x; c.y += n.y; c.n++; c.hot = c.hot || pulse.has(n.id); gs.set(n.group, c); });
    ctx.font = `600 ${13 / k}px -apple-system,"Apple SD Gothic Neo","Malgun Gothic",sans-serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    gs.forEach((c, name) => {
      if (c.n < 2) return;
      ctx.fillStyle = c.hot ? rgba(GLOW, .55) : 'rgba(170,178,198,.28)';
      ctx.fillText(name, c.x / c.n, c.y / c.n);
    });
  }

  // 4) 라벨
  const fs = 11.5 / k;
  ctx.font = `${fs}px -apple-system,"Apple SD Gothic Neo","Malgun Gothic",sans-serif`;
  ctx.textAlign = 'center'; ctx.textBaseline = 'top';
  nodes.forEach((n) => {
    if (!visible(n)) return;
    const isP = pulse.has(n.id), dimmed = act && !act.has(n.id);
    const show = !dimmed && (st.showLab || k > 1.35 || isP || n.id === selId || (selId && adj.get(selId) && adj.get(selId).has(n.id)) || (act && act.has(n.id)) || n.kind === 'concept' || (heat.get(n.id) || 0) > .45);
    if (!show) return;
    const label = n.label.length > 28 ? n.label.slice(0, 27) + '…' : n.label;
    ctx.lineWidth = 3 / k; ctx.strokeStyle = 'rgba(11,13,18,.9)'; ctx.strokeText(label, n.x, n.y + n.r + 4 / k);
    ctx.fillStyle = isP ? '#c9ffd9' : n.kind === 'concept' ? '#ffd9a8' : n.id === selId || n === st.hover ? '#fff' : 'rgba(205,210,222,.82)';
    ctx.fillText(label, n.x, n.y + n.r + 4 / k);
  });
}
function arrow(e, a) {
  const dx = e.t.x - e.s.x, dy = e.t.y - e.s.y, d = Math.hypot(dx, dy) || 1, ux = dx / d, uy = dy / d;
  const px = e.t.x - ux * (e.t.r + 2 / cam.k), py = e.t.y - uy * (e.t.r + 2 / cam.k), s = 5 / cam.k;
  ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(px - ux * s - uy * s * .6, py - uy * s + ux * s * .6); ctx.lineTo(px - ux * s + uy * s * .6, py - uy * s - ux * s * .6); ctx.closePath();
  ctx.fillStyle = `rgba(150,160,185,${a})`; ctx.fill();
}

function loop(t) { for (let i = 0; i < 2; i++) tick(); draw(t); requestAnimationFrame(loop); }

// ───────── 카메라 ─────────
// 패널에 가려지지 않고 그래프가 보이는 화면 영역
const isSheet = () => COMPACT && W < 560;
function visibleArea() {
  const a = { l: COMPACT ? 12 : W > 900 ? 342 : 16, r: W - 16, t: COMPACT ? 56 : 40, b: H - 40 };
  const p = $('#panel');
  if (p.classList.contains('open')) {
    if (isSheet()) a.b = H - p.offsetHeight - 12;
    else if (COMPACT || W > 900) a.r = W - p.offsetWidth - 26;
  }
  return a;
}
// 선택한 별이 패널 뒤에 있으면 보이는 곳으로 카메라를 옮깁니다
function revealSelection() {
  const s = st.sel; if (!s) return;
  let x, y;
  if (s.type === 'node') { const n = byId.get(s.id); if (!n) return; x = n.x; y = n.y; }
  else if (s.type === 'edge') { x = (s.edge.s.x + s.edge.t.x) / 2; y = (s.edge.s.y + s.edge.t.y) / 2; }
  else return;
  const a = visibleArea(), [sx, sy] = toScreen(x, y), m = 30;
  if (sx > a.l + m && sx < a.r - m && sy > a.t + m && sy < a.b - m) return;
  Object.assign(camT, { k: cam.k, x: (a.l + a.r) / 2 - W / 2 - x * cam.k, y: (a.t + a.b) / 2 - H / 2 - y * cam.k, active: true });
}
function fit(ids, instant) {
  const ns = (ids && ids.length ? ids.map((id) => byId.get(id)).filter(Boolean) : nodes.filter(visible));
  if (!ns.length) return;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  ns.forEach((n) => { x0 = Math.min(x0, n.x); y0 = Math.min(y0, n.y); x1 = Math.max(x1, n.x); y1 = Math.max(y1, n.y); });
  const a = visibleArea();
  const aw = Math.max(120, a.r - a.l), ah = Math.max(120, a.b - a.t);
  const pad = ns.length < 4 ? 260 : 90;
  const kk = Math.max(.25, Math.min(2.2, Math.min(aw / (x1 - x0 + pad), ah / (y1 - y0 + pad))));
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
  Object.assign(camT, { k: kk, x: (a.l + a.r) / 2 - W / 2 - cx * kk, y: (a.t + a.b) / 2 - H / 2 - cy * kk, active: true });
  if (instant) Object.assign(cam, { x: camT.x, y: camT.y, k: camT.k });
}

// ───────── 입력 ─────────
function hitNode(sx, sy) {
  const [x, y] = toWorld(sx, sy); let best = null, bd = Infinity;
  nodes.forEach((n) => { if (!visible(n)) return; const d = Math.hypot(n.x - x, n.y - y); if (d < n.r + 6 / cam.k && d < bd) { bd = d; best = n; } });
  return best;
}
function hitEdge(sx, sy) {
  const [x, y] = toWorld(sx, sy); let best = null, bd = 6 / cam.k;
  edges.forEach((e) => {
    if (!visible(e.s) || !visible(e.t)) return;
    const dx = e.t.x - e.s.x, dy = e.t.y - e.s.y, l2 = dx * dx + dy * dy || 1;
    const tt = Math.max(0, Math.min(1, ((x - e.s.x) * dx + (y - e.s.y) * dy) / l2));
    const d = Math.hypot(x - (e.s.x + tt * dx), y - (e.s.y + tt * dy));
    if (d < bd) { bd = d; best = e; }
  });
  return best;
}
cv.addEventListener('pointerdown', (ev) => {
  cv.setPointerCapture(ev.pointerId);
  drag.sx = drag.lx = ev.clientX; drag.sy = drag.ly = ev.clientY; drag.moved = 0;
  const n = hitNode(ev.clientX, ev.clientY);
  if (n) { drag.node = n; alpha = Math.max(alpha, .25); } else drag.pan = true;
  camT.active = false; cv.classList.add('grabbing');
});
cv.addEventListener('pointermove', (ev) => {
  const dx = ev.clientX - drag.lx, dy = ev.clientY - drag.ly; drag.lx = ev.clientX; drag.ly = ev.clientY;
  if (drag.node || drag.pan) drag.moved += Math.abs(dx) + Math.abs(dy);
  if (drag.node) { const [x, y] = toWorld(ev.clientX, ev.clientY); drag.node.x = x; drag.node.y = y; alpha = Math.max(alpha, .12); hideTip(); return; }
  if (drag.pan) { cam.x += dx; cam.y += dy; hideTip(); return; }
  const n = hitNode(ev.clientX, ev.clientY);
  st.hover = n; st.hoverEdge = n ? null : hitEdge(ev.clientX, ev.clientY);
  cv.classList.toggle('pointer', !!(n || st.hoverEdge));
  if (n) showTip(ev, `<b>${esc(n.label)}</b><div class="r">${esc(n.kind === 'concept' ? '개념' : n.role)}${pulse.has(n.id) ? ' · <span style="color:${GLOW_HEX}">선택한 작업</span>' : ''}</div>`);
  else if (st.hoverEdge) showTip(ev, `${esc(st.hoverEdge.s.label)} → ${esc(st.hoverEdge.t.label)}<div class="r">클릭해서 관계 설명 보기</div>`);
  else hideTip();
});
cv.addEventListener('pointerup', (ev) => {
  cv.classList.remove('grabbing');
  const click = drag.moved < 5;
  const n = drag.node; drag.node = null; drag.pan = false;
  if (!click) return;
  if (n) return selectNode(n.id);
  const e = hitEdge(ev.clientX, ev.clientY);
  if (e) return selectEdge(e);
  if (COMPACT) closePanel(); // 빈 우주를 누르면 다시 별만 크게
});
cv.addEventListener('pointerleave', () => { st.hover = null; st.hoverEdge = null; hideTip(); });
cv.addEventListener('wheel', (ev) => {
  ev.preventDefault(); camT.active = false;
  const f = Math.exp(-ev.deltaY * .0015), nk = Math.max(.15, Math.min(5, cam.k * f));
  const [wx, wy] = toWorld(ev.clientX, ev.clientY);
  cam.k = nk; cam.x = ev.clientX - W / 2 - wx * nk; cam.y = ev.clientY - H / 2 - wy * nk;
}, { passive: false });
function showTip(ev, html) { const t = $('#tip'); t.innerHTML = html; t.style.display = 'block'; t.style.left = ev.clientX + 14 + 'px'; t.style.top = ev.clientY + 14 + 'px'; }
function hideTip() { $('#tip').style.display = 'none'; }
addEventListener('keydown', (ev) => {
  if (ev.target.tagName === 'INPUT') { if (ev.key === 'Escape') ev.target.blur(); return; }
  if (ev.key === 'Escape') closePanel();
  if (ev.key === 'f' || ev.key === 'F') fit(null);
});

// ───────── 검색 / 토글 ─────────
$('#search').addEventListener('input', (ev) => {
  st.search = ev.target.value.trim().toLowerCase();
  if (!st.search) { searchHits = null; return; }
  searchHits = new Set(nodes.filter((n) => (n.id + ' ' + n.label + ' ' + (n.summary || '') + ' ' + (n.role || '')).toLowerCase().includes(st.search)).map((n) => n.id));
});
$('#search').addEventListener('keydown', (ev) => {
  if (ev.key === 'Enter' && searchHits && searchHits.size) { const id = [...searchHits][0]; selectNode(id); }
});
$('#tOld').onchange = (e) => { st.showOld = e.target.checked; computeHeat(); };
$('#tCon').onchange = (e) => { st.showCon = e.target.checked; alpha = Math.max(alpha, .3); };
$('#tLab').onchange = (e) => { st.showLab = e.target.checked; };

// ───────── 시간 표시 ─────────
function ago(ms) {
  const s = (Date.now() - ms) / 1000;
  if (s < 60) return '방금 전'; if (s < 3600) return Math.floor(s / 60) + '분 전';
  if (s < 86400) return Math.floor(s / 3600) + '시간 전'; if (s < 86400 * 30) return Math.floor(s / 86400) + '일 전';
  return new Date(ms).toLocaleDateString('ko-KR');
}
const when = (ms) => new Date(ms).toLocaleString('ko-KR', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });

// ───────── 타임라인 ─────────
function renderTimeline() {
  const fc = focusedChange();
  if (!changes.length) {
    $('#tl').innerHTML = `<div class="empty">아직 기록된 작업이 없어요.<br>Claude Code로 파일을 수정하면 여기에 쌓이고, 그래프의 해당 위치에 불이 들어와요.<br><br>지금 보이는 점들은 프로젝트의 기존 파일이에요. 아무 점이나 눌러 보세요.</div>`;
    return;
  }
  $('#tl').innerHTML = changes.map((c, i) => `
    <div class="ti ${i === 0 ? 'latest' : ''} ${fc && c.id === fc.id ? 'on' : ''}" data-change="${esc(c.id)}" role="button" tabindex="0">
      <span class="dot"></span>
      <div class="tt">${esc(c.title)}${c.auto ? '<span class="auto">자동 기록</span>' : ''}</div>
      <div class="tm">${i === 0 ? '<b style="color:var(--glow)">최신</b> · ' : ''}${ago(c.time)} · 파일 ${c.files.length}개</div>
    </div>`).join('');
}
$('#tl').addEventListener('click', (ev) => { const el = ev.target.closest('[data-change]'); if (el) selectChange(el.dataset.change, true); });
$('#tl').addEventListener('keydown', (ev) => { if (ev.key !== 'Enter' && ev.key !== ' ') return; const el = ev.target.closest('[data-change]'); if (el) { ev.preventDefault(); selectChange(el.dataset.change, true); } });

// ───────── 상세 패널 ─────────
function openPanel(html) { $('#pc').innerHTML = html; $('#panel').classList.add('open'); document.body.classList.add('panel-open'); $('#panel').scrollTop = 0; revealSelection(); }
function closePanel() { $('#panel').classList.remove('open'); document.body.classList.remove('panel-open'); st.sel = null; }
$('#close').onclick = closePanel;
$('#pc').addEventListener('click', (ev) => {
  const t = ev.target.closest('[data-node],[data-change],[data-toggle],[data-concept],[data-open]');
  if (!t) return;
  if (t.dataset.open) return editor.postMessage({ type: 'openFile', path: t.dataset.open });
  if (t.dataset.toggle) { const el = document.getElementById(t.dataset.toggle); el.classList.toggle('hidden'); t.textContent = el.classList.contains('hidden') ? t.dataset.closed : '접기'; return; }
  if (t.dataset.node) return selectNode(t.dataset.node, true);
  if (t.dataset.change) return selectChange(t.dataset.change, true);
  if (t.dataset.concept) return selectNode('concept:' + t.dataset.concept, true);
});

function nodeLink(id, extra) {
  const n = byId.get(id); if (!n) return `<div class="link"><span class="nm">${esc(id)}</span></div>`;
  return `<div class="link ${pulse.has(id) ? 'hot' : ''}" data-node="${esc(id)}"><span class="sw" style="background:${n.kind === 'concept' ? CONCEPT : n.color}${pulse.has(id) ? ';box-shadow:0 0 8px ' + GLOW_HEX : ''}"></span><span class="nm">${esc(n.label)}</span><span class="rl">${esc(extra || (n.kind === 'concept' ? '개념' : n.role))}</span></div>`;
}
const changesFor = (id) => changes.filter((c) => c._ids.includes(id));
let uid = 0;

// 줄 단위 diff (structuredPatch가 없을 때)
function lineDiff(a, b) {
  const A = (a || '').split('\n'), B = (b || '').split('\n');
  if (A.length * B.length > 90000) return [...A.map((l) => ['-', l]), ...B.map((l) => ['+', l])];
  const m = A.length, n = B.length, T = Array.from({ length: m + 1 }, () => new Uint16Array(n + 1));
  for (let i = m - 1; i >= 0; i--) for (let j = n - 1; j >= 0; j--) T[i][j] = A[i] === B[j] ? T[i + 1][j + 1] + 1 : Math.max(T[i + 1][j], T[i][j + 1]);
  const out = []; let i = 0, j = 0;
  while (i < m && j < n) { if (A[i] === B[j]) { out.push([' ', A[i]]); i++; j++; } else if (T[i + 1][j] >= T[i][j + 1]) out.push(['-', A[i++]]); else out.push(['+', B[j++]]); }
  while (i < m) out.push(['-', A[i++]]); while (j < n) out.push(['+', B[j++]]);
  return out;
}
function diffHtml(evs) {
  const rows = [];
  evs.forEach((ev) => {
    const tag = { create: '새 파일 생성', rewrite: '파일 전체 다시 쓰기', delete: '파일 삭제 (셸 명령)', bash: '셸 명령으로 수정 · 마지막 커밋과 비교' }[ev.kind] || '부분 수정';
    rows.push(`<span class="l hh">── ${esc(tag)} · ${esc(when(ev.ts))}</span>`);
    if (ev.command) rows.push(`<span class="l hh">$ ${esc(ev.command)}</span>`);
    if (ev.redacted) rows.push('<span class="l hh">민감한 파일이라 코드 내용은 기록하지 않았어요.</span>');
    else if (ev.patch && ev.patch.length) {
      ev.patch.forEach((h) => {
        rows.push(`<span class="l hh">@@ ${h.oldStart}번째 줄 부근 @@</span>`);
        h.lines.forEach((l) => { const c = l[0]; rows.push(`<span class="l ${c === '+' ? 'add' : c === '-' ? 'del' : 'ctx'}">${esc(l)}</span>`); });
      });
    } else (ev.edits || []).forEach((ed) => {
      if (ed.old == null) { const ls = (ed.new || '').split('\n'); ls.slice(0, 60).forEach((l) => rows.push(`<span class="l add">+${esc(l)}</span>`)); if (ls.length > 60) rows.push(`<span class="l hh">… ${ls.length - 60}줄 더</span>`); }
      else lineDiff(ed.old, ed.new).forEach(([c, l]) => rows.push(`<span class="l ${c === '+' ? 'add' : c === '-' ? 'del' : 'ctx'}">${esc(c + l)}</span>`));
    });
  });
  return `<div class="diff"><pre>${rows.join('')}</pre></div>`;
}
function diffToggle(evs, label) {
  if (!evs || !evs.length) return '';
  const id = 'd' + (uid++);
  return `<button class="tg" data-toggle="${id}" data-closed="${esc(label)}">${esc(label)}</button><div id="${id}" class="hidden">${diffHtml(evs)}</div>`;
}

function selectNode(id, center) {
  const n = byId.get(id); if (!n) return;
  st.sel = { type: 'node', id };
  if (n.kind === 'concept') return renderConcept(n, center);
  const isP = pulse.has(id), hc = changesFor(id);
  const outs = edges.filter((e) => e.s.id === id && e.type !== 'concept');
  const ins = edges.filter((e) => e.t.id === id && e.type !== 'concept');
  const cons = edges.filter((e) => e.type === 'concept' && (e.s.id === id || e.t.id === id)).map((e) => (e.s.id === id ? e.t : e.s).label);
  const about = n.summary
    ? `<p class="lead">${esc(n.summary)}</p>${n.detail ? `<p>${esc(n.detail)}</p>` : ''}${n.roleExplain ? `<p class="muted small">역할 분류: ${esc(n.role)} — ${esc(n.roleExplain)}</p>` : ''}`
    : `${n.doc ? `<p class="lead">${esc(n.doc)}</p><p class="muted small">파일 맨 앞의 주석에서 가져온 설명이에요.</p>` : ''}<p class="${n.doc ? 'muted small' : 'lead'}">${esc(n.roleExplain || '이 프로젝트의 코드 파일이에요.')}</p>${!n.exists ? '<p class="muted small">지금은 프로젝트에 없는 파일이에요(삭제되었거나 분석 범위 밖).</p>' : ''}<p class="muted small">💡 Claude Code에서 <b>/mycena-describe</b>를 실행하면 모든 파일에 맞춤 설명이 붙어요.</p>`;
  const html = `
    <div class="ph">
      <div class="kicker">파일</div>
      <h2>${esc(n.label)}</h2><div class="path">${esc(n.id)}</div>
      ${isP ? '<span class="badge live">● 선택한 작업에서 수정됨</span>' : hc.length ? `<span class="badge old">Claude가 ${hc.length}번 수정</span>` : ''}
      <span class="badge role">${esc(n.role)}</span>${!n.exists ? '<span class="badge gone">현재 없음</span>' : ''}
      ${EMBED && n.exists ? `<div><button class="tg" data-open="${esc(n.id)}">에디터에서 열기 →</button></div>` : ''}
    </div>
    <div class="sec"><h3>이 파일은 무슨 일을 하나요?</h3>${about}</div>
    ${n.endpoints && n.endpoints.length ? `<div class="sec"><h3>이 파일이 여는 API 주소</h3>${n.endpoints.map((e) => { const [m, ...p] = e.split(' '); return `<div class="ep"><b>${esc(m)}</b>${esc(p.join(' '))}</div>`; }).join('')}</div>` : ''}
    ${n.decls && n.decls.length ? `<div class="sec"><h3>안에 들어있는 주요 기능 (${n.decls.length})</h3><div class="chips">${n.decls.map((d) => `<span class="chip">${esc(d)}</span>`).join('')}</div>${n.lines ? `<p class="muted small" style="margin-top:8px">총 ${n.lines}줄</p>` : ''}</div>` : ''}
    ${cons.length ? `<div class="sec"><h3>관련 개념</h3><div class="chips">${cons.map((c) => `<span class="chip c" data-concept="${esc(c)}">◆ ${esc(c)}</span>`).join('')}</div></div>` : ''}
    <div class="sec"><h3>Claude 작업 기록 ${hc.length ? `(${hc.length})` : ''}</h3>
      ${hc.length ? hc.map((c) => {
        const f = c.files.find((x) => x.path === id) || {};
        const evs = (c.events || []).filter((e) => e.file === id);
        return `<div class="card ${focusedChange() && c.id === focusedChange().id ? 'latest' : ''}">
          <div class="ct" data-change="${esc(c.id)}">${esc(c.title)}</div>
          <div class="cm">${ago(c.time)} · ${esc(when(c.time))}${c.auto ? ' · 자동 기록' : ''}</div>
          ${f.what || f.why ? `<div class="kv">${f.what ? `<span class="k">무엇</span><span>${esc(f.what)}</span>` : ''}${f.why ? `<span class="k">왜</span><span>${esc(f.why)}</span>` : ''}</div>` : `<div class="muted small">${esc(c.intent ? clipText(c.intent, 160) : '이 작업에서 함께 수정된 파일이에요.')}</div>`}
          ${diffToggle(evs, '실제 코드 변경 보기')}
        </div>`;
      }).join('') : '<p class="muted">Claude가 수정한 기록이 없어요. 이미 있던 코드예요.</p>'}
    </div>
    ${commitsHtml(n.commits, '이 파일의 git 기록')}
    <div class="sec"><h3>이 파일이 가져다 쓰는 것 (${outs.length})</h3>${outs.length ? outs.map((e) => nodeLink(e.t.id, e.type === 'relation' ? 'Claude가 설명한 관계' : (e.symbols || []).slice(0, 3).join(', '))).join('') : '<p class="muted small">없음</p>'}</div>
    <div class="sec"><h3>이 파일을 사용하는 곳 (${ins.length})</h3>${ins.length ? ins.map((e) => nodeLink(e.s.id)).join('') : '<p class="muted small">없음 — 다른 파일이 이 파일을 직접 부르지 않아요.</p>'}
      ${ins.length ? `<p class="muted small" style="margin-top:6px">⚠️ 이 파일을 바꾸면 위 ${ins.length}개 파일에도 영향이 갈 수 있어요.</p>` : ''}</div>`;
  openPanel(html);
  if (center) fit([id, ...adj.get(id)]);
}
function commitsHtml(list, title) {
  if (!list || !list.length) return '';
  return `<div class="sec"><h3>${esc(title)} (${list.length})</h3>${list.map((c) => `<div class="commit"><code>${esc(c.hash)}</code><div>${esc(c.subject)}<div class="cm">${esc(c.author)} · ${ago(c.time)}</div></div></div>`).join('')}</div>`;
}
const clipText = (s, n) => (s && s.length > n ? s.slice(0, n) + '…' : s || '');

function renderConcept(n, center) {
  const files = [...adj.get(n.id)];
  const cs = changes.filter((c) => (c.concepts || []).includes(n.label));
  openPanel(`
    <div class="ph"><div class="kicker">개념</div><h2>◆ ${esc(n.label)}</h2></div>
    <div class="sec"><p class="lead">이 개념과 관련된 파일이 ${files.length}개 있어요. 그래프에서 분홍 점선으로 연결돼 있어요.</p></div>
    ${cs.length ? `<div class="sec"><h3>이 개념을 다룬 Claude 작업</h3>${cs.map((c) => `<div class="card"><div class="ct" data-change="${esc(c.id)}">${esc(c.title)}</div><div class="cm">${ago(c.time)}</div></div>`).join('')}</div>` : ''}
    <div class="sec"><h3>관련 파일</h3>${files.map((id) => nodeLink(id)).join('')}</div>`);
  if (center) fit([n.id, ...files]);
}

function selectEdge(e) {
  st.sel = { type: 'edge', edge: e };
  const a = e.s, b = e.t;
  const both = changes.filter((c) => c._ids.includes(a.id) && c._ids.includes(b.id));
  const typeLabel = e.type === 'import' ? '코드 연결 (import / 참조)' : e.type === 'relation' ? 'Claude가 설명한 관계' : '개념 연결';
  let plain;
  if (e.type === 'concept') plain = `<b>${esc(a.label)}</b> 파일은 <b>◆ ${esc(b.label)}</b> 개념과 관련된 작업에 등장해요.`;
  else if (e.type === 'relation') plain = `코드에서 직접 import하지는 않지만, Claude가 두 파일이 함께 동작한다고 설명한 관계예요.`;
  else plain = `<b>${esc(a.label)}</b>이(가) <b>${esc(b.label)}</b>의 기능을 가져다 써요.${e.symbols && e.symbols.length ? `<br><span class="muted small">가져다 쓰는 것: </span>${e.symbols.map((s) => `<span class="chip">${esc(s)}</span>`).join(' ')}` : ''}
    <p class="muted small" style="margin:8px 0 0">비유하면 ${esc(a.label)}이(가) ${esc(b.label)}에게 일을 부탁하는 관계예요. 그래서 <b>${esc(b.label)}</b>이(가) 바뀌면 <b>${esc(a.label)}</b>도 영향을 받을 수 있어요.</p>`;
  const descs = (e.descs || []);
  openPanel(`
    <div class="ph"><div class="kicker">${esc(typeLabel)}</div>
      <div class="edgehead" style="margin-top:6px"><span>${esc(a.label)}</span><span class="ar">→</span><span>${esc(b.label)}</span></div>
      ${pulse.has(a.id) && pulse.has(b.id) ? '<span class="badge live">● 선택한 작업에서 둘 다 수정됨</span>' : ''}
    </div>
    <div class="sec"><h3>두 파일은 어떤 관계인가요?</h3><div class="explain">${plain}</div></div>
    ${descs.length ? `<div class="sec"><h3>Claude의 설명</h3>${descs.map((d) => `<div class="card"><div>${esc(d.text)}</div>${d.by ? `<div class="cm" style="margin:6px 0 0">출처: ${esc(d.by === 'descriptions' ? '/mycena-describe 설명' : '작업 — ' + d.by)}</div>` : ''}</div>`).join('')}</div>` : ''}
    <div class="sec"><h3>두 파일을 함께 바꾼 작업 (${both.length})</h3>
      ${both.length ? both.map((c) => {
        const fa = c.files.find((x) => x.path === a.id) || {}, fb = c.files.find((x) => x.path === b.id) || {};
        return `<div class="card"><div class="ct" data-change="${esc(c.id)}">${esc(c.title)}</div><div class="cm">${ago(c.time)}</div>
          <div class="kv">${fa.what ? `<span class="k">${esc(a.label.split('.')[0].slice(0, 6))}</span><span>${esc(fa.what)}</span>` : ''}${fb.what ? `<span class="k">${esc(b.label.split('.')[0].slice(0, 6))}</span><span>${esc(fb.what)}</span>` : ''}</div>
          ${diffToggle((c.events || []).filter((x) => x.file === a.id || x.file === b.id), '두 파일의 코드 변경 보기')}</div>`;
      }).join('') : '<p class="muted small">함께 수정된 기록은 없어요.</p>'}
    </div>
    ${commitsHtml((a.commits || []).filter((c) => (b.commits || []).some((x) => x.hash === c.hash)), '두 파일을 함께 바꾼 커밋')}
    <div class="sec"><h3>양쪽 파일</h3>${nodeLink(a.id)}${nodeLink(b.id)}</div>`);
}

const fitChange = (c) => fit([...new Set(c._ids.flatMap((x) => [x, ...adj.get(x)]))]);
function selectChange(id, doFit) {
  const c = changeById.get(id); if (!c) return;
  st.focus = id; st.sel = { type: 'change', id };
  computeHeat(); renderTimeline();
  const isLatest = changes[0] && changes[0].id === id;
  const areas = [...new Set(c.files.map((f) => (byId.get(f.path) || {}).group).filter(Boolean))];
  const fileCards = c.files.map((f) => {
    const evs = (c.events || []).filter((e) => e.file === f.path);
    const n = byId.get(f.path);
    const kind = evs.some((e) => e.kind === 'create') ? '새로 만듦' : evs.length ? `${evs.length}번 수정` : '';
    return `<div class="card">
      ${nodeLink(f.path, kind || (n ? n.role : ''))}
      ${f.what || f.why ? `<div class="kv" style="margin-top:6px">${f.what ? `<span class="k">무엇</span><span>${esc(f.what)}</span>` : ''}${f.why ? `<span class="k">왜</span><span>${esc(f.why)}</span>` : ''}</div>` : ''}
      ${diffToggle(evs, '코드 변경 보기')}
    </div>`;
  }).join('');
  openPanel(`
    <div class="ph">
      <div class="kicker">Claude 작업 · ${esc(when(c.time))} (${ago(c.time)})</div>
      <h2>${esc(c.title)}</h2>
      ${isLatest ? '<span class="badge live">● 가장 최근 작업</span>' : '<span class="badge old">이전 작업</span>'}${c.auto ? '<span class="badge role">자동 기록</span>' : ''}
      ${areas.length ? `<div class="area">그래프에서 빛나는 영역: ${areas.map(esc).join(', ')}</div>` : ''}
    </div>
    ${c.request ? `<div class="sec"><h3>사용자가 요청한 것</h3><div class="quote">${esc(clipText(c.request, 500))}</div></div>` : ''}
    ${c.intent ? `<div class="sec"><h3>${c.auto ? 'Claude가 작업하며 남긴 말' : '왜 이 작업을 했나요?'}</h3><p class="${c.auto ? 'quote' : 'lead'}">${esc(clipText(c.intent, 700))}</p></div>` : ''}
    ${c.before || c.after ? `<div class="sec"><h3>무엇이 달라졌나요?</h3><div class="ba"><div class="b"><div class="lab">이전</div>${esc(c.before || '—')}</div><div class="arr">→</div><div class="a"><div class="lab">이후</div>${esc(c.after || '—')}</div></div></div>` : ''}
    <div class="sec"><h3>건드린 파일 (${c.files.length}) — 그래프에서 빛나는 점들</h3>${fileCards}</div>
    ${c.relations && c.relations.length ? `<div class="sec"><h3>파일 사이의 연결</h3>${c.relations.map((r) => `<div class="card"><div style="font-weight:600">${esc((byId.get(r.from) || { label: r.from }).label)} <span class="muted">→</span> ${esc((byId.get(r.to) || { label: r.to }).label)}</div><div style="margin-top:4px">${esc(r.desc)}</div></div>`).join('')}</div>` : ''}
    ${c.concepts && c.concepts.length ? `<div class="sec"><h3>관련 개념</h3><div class="chips">${c.concepts.map((x) => `<span class="chip c" data-concept="${esc(x)}">◆ ${esc(x)}</span>`).join('')}</div></div>` : ''}
    ${c.auto ? `<div class="sec"><p class="muted small">이 작업은 Claude가 설명 노트를 남기기 전에 기록된 거라 자동 정보만 있어요. 훅이 켜진 상태의 작업에는 "왜/무엇/이전→이후" 설명이 함께 붙어요.</p></div>` : ''}`);
  // 이웃까지 함께 보여줘야 불빛이 그래프의 어느 부분인지 알 수 있습니다
  if (doFit) fitChange(c);
}

// ───────── 실시간 갱신 ─────────
function toast(msg, onclick) {
  const t = $('#toast'); t.textContent = msg; t.classList.add('show'); t.onclick = () => { onclick && onclick(); t.classList.remove('show'); };
  clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.remove('show'), 6000);
}
function ingest(d) {
  if (D && d.version === D.version) return;
  const prevLatest = changes[0] && changes[0].id;
  const first = !D;
  const wasFollowingLatest = !st.focus || st.focus === prevLatest;
  load(d);
  const nl = changes[0];
  if (first) start();
  else if (nl && nl.id !== prevLatest) {
    if (wasFollowingLatest) { st.focus = nl.id; computeHeat(); renderTimeline(); }
    toast(`✨ Claude가 방금 작업했어요: ${nl.title}`, () => selectChange(nl.id, true));
    if (COMPACT && !st.sel) { if (wasFollowingLatest) fitChange(nl); } // 미리보기는 패널 없이 불빛으로만 알림
    else if (!st.sel || st.sel.type === 'change') selectChange(nl.id, wasFollowingLatest);
  } else if (st.sel && st.sel.type === 'change') selectChange(st.sel.id, false);
}
async function poll() {
  try {
    const r = await fetch('/data.json', { cache: 'no-store' });
    ingest(await r.json());
    $('#live').innerHTML = `<span style="color:${GLOW_HEX}">●</span> 실시간`;
  } catch (e) { $('#live').textContent = '연결 끊김'; }
  setTimeout(poll, 2500);
}

// ───────── 큰 화면으로 이동 ─────────
// 지금 보던 별을 브라우저에서도 그대로 이어서 보여줍니다
function selectionRef() {
  const s = st.sel;
  if (!s) return null;
  if (s.type === 'node') return { kind: 'node', id: s.id };
  if (s.type === 'edge') return { kind: 'node', id: s.edge.s.id };
  return { kind: 'change', id: s.id };
}
function openFull() {
  const ref = selectionRef();
  if (editor) return editor.postMessage({ type: 'openBrowser', ref });
  const hash = ref ? '#' + new URLSearchParams({ [ref.kind]: ref.id }) : '';
  window.open(location.href.split(/[?#]/)[0] + hash, '_blank', 'noopener');
}
$('#mFull').onclick = openFull;
$('#mFit').onclick = () => fit(null);
function selectFromHash() {
  const h = new URLSearchParams(location.hash.slice(1));
  if (h.get('node') && byId.has(h.get('node'))) { selectNode(h.get('node'), true); return true; }
  if (h.get('change') && changeById.has(h.get('change'))) { selectChange(h.get('change'), true); return true; }
  return false;
}

function start() {
  if (started) return; started = true;
  for (let i = 0; i < 260; i++) tick();   // 첫 화면부터 정돈된 상태로
  if (changes.length && !COMPACT && W >= 1200) selectChange(changes[0].id, false); // 넓은 화면은 열자마자 "방금 한 일"부터 보여줌
  fit(null, true);
  selectFromHash();
  requestAnimationFrame(loop);
}
addEventListener('resize', resize); resize();
// 콘솔/외부 스크립트용 작은 API
window.mycena = {
  selectNode: (id) => selectNode(id, true), selectChange: (id) => selectChange(id, true), fit: () => fit(null),
  selectEdge: (a, b) => { const e = edges.find((x) => (x.s.id.endsWith(a) && x.t.id.endsWith(b))); if (e) selectEdge(e); return !!e; },
};
if (window.__DATA__) { load(window.__DATA__); start(); $('#live').textContent = ago(window.__DATA__.generatedAt) + ' 생성'; }
if (window.__LIVE__) poll();
if (editor) { addEventListener('message', (ev) => { if (ev.data && ev.data.type === 'data') ingest(ev.data.data); }); editor.postMessage({ type: 'ready' }); }
if (!window.__DATA__ && !window.__LIVE__ && !editor) $('#tl').innerHTML = '<div class="empty">데이터가 없어요. <code>mycena serve</code> 또는 <code>mycena build</code>로 열어 주세요.</div>';
})();
