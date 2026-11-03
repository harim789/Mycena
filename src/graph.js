'use strict';
// 파일·연결·작업 기록을 뷰어가 그릴 하나의 데이터로 합칩니다.
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');
const { toPosix, clip } = require('./util');
const { readEvents, readNotes, readDescriptions } = require('./store');
const { scanFiles, gitHistory } = require('./scan');
const { JS_EXT, parseFile, detectRole, leadingDoc } = require('./parse');

const list = (x) => (Array.isArray(x) ? x : []);
const str = (x) => (typeof x === 'string' ? x : '');
const cleanPath = (p) => toPosix(String(p)).replace(/^\.\//, '');
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function makeResolver(r, files, parsed) {
  const fileSet = new Set(files.map((f) => f.rel));
  const fqcn = new Map(); const pkgFiles = new Map(); const pyIndex = []; const baseIndex = new Map();
  for (const f of files) {
    const p = parsed.get(f.rel);
    const base = f.name.replace(/\.[^.]+$/, '');
    if (!baseIndex.has(base.toLowerCase())) baseIndex.set(base.toLowerCase(), f.rel);
    if (p.pkg) {
      fqcn.set(p.pkg + '.' + base, f.rel);
      if (!pkgFiles.has(p.pkg)) pkgFiles.set(p.pkg, []);
      pkgFiles.get(p.pkg).push({ rel: f.rel, cls: base });
    }
    if (f.ext === '.py') pyIndex.push({ rel: f.rel, dotted: f.rel.replace(/\.py$/, '').replace(/\/__init__$/, '').split('/').join('.') });
  }
  const srcRoot = fs.existsSync(path.join(r, 'src')) ? 'src' : '';
  const tryFile = (base) => {
    const cands = [base, ...JS_EXT.map((e) => base + e), ...JS_EXT.map((e) => base + '/index' + e), base.replace(/\.js$/, '.ts'), base.replace(/\.js$/, '.tsx')];
    return cands.find((c) => fileSet.has(c));
  };
  const pyLookup = (dotted) => {
    let best = null;
    for (const x of pyIndex) if (x.dotted === dotted || x.dotted.endsWith('.' + dotted)) { if (!best || x.dotted.length < best.dotted.length) best = x; }
    return best && best.rel;
  };
  const resolve = (from, imp) => {
    const dir = path.posix.dirname(from);
    if (imp.jvm) {
      if (imp.spec.endsWith('.*')) return (pkgFiles.get(imp.spec.slice(0, -2)) || []).map((x) => x.rel);
      const hit = fqcn.get(imp.spec) || fqcn.get(imp.spec.split('.').slice(0, -1).join('.'));
      return hit ? [hit] : [];
    }
    if (imp.py) {
      const dots = (/^\.+/.exec(imp.spec) || [''])[0].length;
      const rest = imp.spec.slice(dots);
      const res = [];
      if (dots) {
        let base = dir; for (let i = 1; i < dots; i++) base = path.posix.dirname(base);
        const mod = rest ? path.posix.join(base, rest.split('.').join('/')) : base;
        const tryPy = (m) => [m + '.py', m + '/__init__.py'].find((c) => fileSet.has(path.posix.normalize(c)));
        if (imp.from) imp.symbols.forEach((s) => { const h = tryPy(mod + '/' + s); if (h) res.push(path.posix.normalize(h)); });
        if (!res.length) { const h = tryPy(mod); if (h) res.push(path.posix.normalize(h)); }
      } else {
        if (imp.from) imp.symbols.forEach((s) => { const h = pyLookup(rest + '.' + s); if (h) res.push(h); });
        if (!res.length) { const h = pyLookup(rest); if (h) res.push(h); }
      }
      return res;
    }
    if (imp.wiki) { const h = baseIndex.get(imp.spec.toLowerCase()); return h ? [h] : []; }
    let spec = imp.spec;
    if (spec.startsWith('@/') || spec.startsWith('~/')) spec = path.posix.join(srcRoot || '.', spec.slice(2));
    else if (spec.startsWith('/')) spec = spec.slice(1);
    else if (spec.startsWith('.')) spec = path.posix.join(dir, spec);
    else return [];
    spec = path.posix.normalize(spec);
    const h = imp.rel ? (fileSet.has(spec) ? spec : null) : tryFile(spec);
    return h ? [h] : [];
  };
  return { resolve, pkgFiles };
}

// 요청의 첫 문장을 제목으로 씁니다. 첨부 파일 경로(@"...")만 있는 줄은 건너뜁니다.
function requestTitle(request) {
  const line = String(request || '').split('\n').map((l) => l.trim())
    .find((l) => l && !/^@("[^"]*"|\S+)$/.test(l));
  if (!line) return '';
  const t = line.replace(/^["'“‘]+|["'”’]+$/g, '');
  return t.length > 60 ? t.slice(0, 59) + '…' : t;
}

// 이벤트(자동 기록)와 노트(Claude의 설명)를 "작업" 단위로 묶습니다.
function buildChanges(r) {
  const events = readEvents(r).filter((e) => e && e.file).sort((a, b) => a.ts - b.ts);
  const changes = readNotes(r).sort((a, b) => a._time - b._time).map((n) => ({
    id: 'note:' + n._id, time: n._time, session: str(n.session) || null, auto: false, broken: !!n._broken,
    title: str(n.title) || '(제목 없음)', intent: str(n.intent), before: str(n.before), after: str(n.after),
    files: list(n.files).filter((x) => x && x.path).map((x) => ({ path: cleanPath(x.path), what: str(x.what), why: str(x.why) })),
    relations: list(n.relations).filter((x) => x && x.from && x.to).map((x) => ({ from: cleanPath(x.from), to: cleanPath(x.to), desc: str(x.desc) })),
    concepts: list(n.concepts).filter((x) => x && typeof x === 'string'), events: [], request: '', said: '',
  }));
  const notes = changes.slice();
  const autoBySession = new Map();
  for (const ev of events) {
    const slim = { ts: ev.ts, file: ev.file, tool: ev.tool, kind: ev.kind, edits: ev.edits, patch: ev.patch, command: ev.command, redacted: ev.redacted };
    // 같은 세션에서 이 수정 직후에 쓰인 첫 노트에 귀속
    const owner = notes.find((x) => x.time >= ev.ts && (!x.session || x.session === ev.session));
    if (owner) {
      owner.events.push(slim);
      if (!owner.request && ev.request) owner.request = ev.request;
      if (ev.said) owner.said = ev.said;
      continue;
    }
    // 노트가 없으면 같은 세션 + 같은 요청 + 10분 이내 수정을 하나의 "자동 기록 작업"으로 묶음
    let cur = autoBySession.get(ev.session);
    if (!cur || ev.ts - cur.time > 10 * 60 * 1000 || (ev.request && cur.request && ev.request !== cur.request)) {
      cur = { id: `auto:${ev.session}:${ev.ts}`, time: ev.ts, session: ev.session, auto: true, title: '', intent: '', before: '', after: '', files: [], relations: [], concepts: [], events: [], request: ev.request || '', said: '' };
      autoBySession.set(ev.session, cur); changes.push(cur);
    }
    cur.events.push(slim); cur.time = ev.ts;
    if (ev.said) cur.said = ev.said;
  }
  for (const c of changes) {
    for (const ev of c.events) if (!c.files.some((f) => f.path === ev.file)) c.files.push({ path: ev.file, what: '', why: '' });
    if (c.auto) {
      c.title = requestTitle(c.request) || `파일 ${c.files.length}개 수정`;
      c.intent = c.said;
    }
  }
  return changes.sort((a, b) => b.time - a.time).slice(0, 300);
}

function buildData(r) {
  const files = scanFiles(r);
  const parsed = new Map(files.map((f) => [f.rel, parseFile(f)]));
  const desc = readDescriptions(r);
  const history = gitHistory(r);
  const { resolve, pkgFiles } = makeResolver(r, files, parsed);

  const nodes = []; const nodeMap = new Map();
  for (const f of files) {
    const p = parsed.get(f.rel);
    const role = detectRole(f, p);
    const d = desc[f.rel] && typeof desc[f.rel] === 'object' ? desc[f.rel] : {};
    const dirName = path.posix.basename(path.posix.dirname(f.rel));
    const n = {
      id: f.rel, kind: 'file', label: f.name, group: dirName === '.' ? '(root)' : dirName,
      ext: f.ext, lines: f.text ? f.text.split('\n').length : null, exists: true,
      role: role.label, roleKey: role.key, roleExplain: role.explain,
      decls: p.decls, endpoints: p.endpoints, annotations: p.annotations,
      summary: str(d.summary), detail: str(d.detail), doc: leadingDoc(f), commits: history.get(f.rel) || [],
    };
    nodes.push(n); nodeMap.set(n.id, n);
  }

  const edgeMap = new Map();
  const addEdge = (s, t, type, extra = {}) => {
    if (s === t || !nodeMap.has(s) || !nodeMap.has(t)) return null;
    const key = s + '\u0000' + t;
    let e = edgeMap.get(key);
    if (!e) { e = { source: s, target: t, type, symbols: [], descs: [] }; edgeMap.set(key, e); }
    (extra.symbols || []).forEach((x) => { if (!e.symbols.includes(x)) e.symbols.push(x); });
    if (extra.desc && !e.descs.some((d) => d.text === extra.desc)) e.descs.push({ text: extra.desc, by: extra.by || '' });
    return e;
  };
  for (const f of files) {
    const p = parsed.get(f.rel);
    for (const imp of p.imports) for (const t of resolve(f.rel, imp)) addEdge(f.rel, t, 'import', { symbols: imp.symbols.slice(0, 12) });
    if (p.pkg && f.text) {
      for (const o of pkgFiles.get(p.pkg) || []) {
        if (o.rel === f.rel) continue;
        if (new RegExp('\\b' + escapeRe(o.cls) + '\\b').test(f.text)) addEdge(f.rel, o.rel, 'import', { symbols: [o.cls] });
      }
    }
  }
  const addRelation = (from, to, text, by) => {
    const e = edgeMap.get(from + '\u0000' + to) || edgeMap.get(to + '\u0000' + from);
    if (e) { if (text && !e.descs.some((d) => d.text === text)) e.descs.push({ text, by }); } else addEdge(from, to, 'relation', { desc: text, by });
  };
  const ensureConcept = (name) => {
    const id = 'concept:' + name;
    if (!nodeMap.has(id)) { const n = { id, kind: 'concept', label: name, group: '개념', exists: true }; nodes.push(n); nodeMap.set(id, n); }
    return id;
  };
  for (const [file, d] of Object.entries(desc)) {
    if (!d || typeof d !== 'object' || !nodeMap.has(file)) continue;
    list(d.concepts).forEach((c) => { if (c && typeof c === 'string') addEdge(file, ensureConcept(c), 'concept'); });
    list(d.uses).forEach((u) => { if (u && u.path) addRelation(file, cleanPath(u.path), str(u.why), 'descriptions'); });
  }

  const changes = buildChanges(r);
  for (const c of changes) {
    for (const f of c.files) {
      if (!nodeMap.has(f.path)) { // 삭제됐거나 분석 범위 밖 파일
        const n = { id: f.path, kind: 'file', label: path.posix.basename(f.path), group: path.posix.basename(path.posix.dirname(f.path)) || '(root)', exists: false, role: '삭제되었거나 분석 범위 밖', roleKey: 'code', roleExplain: '', decls: [], endpoints: [], annotations: [], summary: '', detail: '', doc: '', commits: history.get(f.path) || [] };
        nodes.push(n); nodeMap.set(n.id, n);
      }
    }
    c.relations.forEach((rel) => addRelation(rel.from, rel.to, rel.desc, c.title));
    c.concepts.forEach((name) => { const cid = ensureConcept(name); c.files.forEach((f) => addEdge(f.path, cid, 'concept')); });
  }

  const body = { project: path.basename(r), nodes, edges: [...edgeMap.values()], changes };
  // 내용이 같으면 같은 version: 뷰어는 이 값이 바뀔 때만 다시 그립니다.
  const version = crypto.createHash('sha1').update(JSON.stringify(body)).digest('hex').slice(0, 16);
  return Object.assign(body, { version, generatedAt: Date.now() });
}

module.exports = { buildData };
