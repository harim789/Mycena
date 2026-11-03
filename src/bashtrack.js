'use strict';
// Claude가 sed, mv 같은 셸 명령으로 바꾼 파일을 찾습니다. 명령 전후의 git 작업 트리를 비교하므로 git 저장소에서만 동작합니다.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');
const { clip, dataDir, isSecretPath, trackablePath } = require('./util');
const { slimPatch } = require('./events');

const MAX_DIRTY = 500;
const MAX_HASH = 2 * 1024 * 1024;

function git(root, args) {
  return execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 32 * 1024 * 1024 });
}
function fingerprint(abs) {
  let st; try { st = fs.statSync(abs); } catch { return 'gone'; }
  if (!st.isFile()) return 'other';
  if (st.size > MAX_HASH) return `size:${st.size}:${st.mtimeMs}`;
  return crypto.createHash('sha1').update(fs.readFileSync(abs)).digest('hex');
}

// git 저장소가 아니거나 더러운 파일이 너무 많으면 null (추적을 포기하고 Claude 작업은 막지 않음)
function takeSnapshot(root) {
  let raw, head = '';
  try {
    raw = git(root, ['status', '--porcelain', '-z', '--untracked-files=all']);
    try { head = git(root, ['rev-parse', 'HEAD']).trim(); } catch { /* 아직 커밋 없음 */ }
  } catch { return null; }
  const parts = raw.split('\0').filter(Boolean);
  const files = {};
  for (let i = 0; i < parts.length; i++) {
    const code = parts[i].slice(0, 2);
    const rel = trackablePath(root, parts[i].slice(3));
    if (code[0] === 'R' || code[0] === 'C') i++; // 이름 변경은 원래 이름이 한 칸 더 따라옴
    if (rel) files[rel] = fingerprint(path.join(root, rel));
    if (Object.keys(files).length > MAX_DIRTY) return null;
  }
  return { head, files };
}

function parseUnifiedDiff(text) {
  const hunks = [];
  let cur = null;
  for (const line of text.split('\n')) {
    const m = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line);
    if (m) { cur = { oldStart: +m[1], newStart: +m[2], lines: [] }; hunks.push(cur); } else if (cur && /^[ +\\-]/.test(line)) cur.lines.push(line);
  }
  return hunks;
}

// HEAD가 움직였다면(커밋, 브랜치 전환, pull) 파일 변화가 Claude의 편집이라 볼 수 없어 기록하지 않습니다.
function diffSnapshots(root, before, after) {
  if (!before || !after || before.head !== after.head) return [];
  const names = new Set([...Object.keys(before.files), ...Object.keys(after.files)]);
  const changed = [];
  for (const rel of names) {
    const was = before.files[rel];
    const now = after.files[rel] || fingerprint(path.join(root, rel));
    if (was !== now) changed.push({ rel, now });
  }
  return changed;
}

function bashEvents(root, changed, { session, ts, id, command, ctx }) {
  return changed.map(({ rel, now }, i) => {
    const ev = { id: id ? `${id}:${i}` : null, ts, session: session || 'unknown', tool: 'Bash', kind: now === 'gone' ? 'delete' : 'bash', file: rel, command: clip(command || '', 300), edits: [], patch: null, said: (ctx && ctx.said) || '', request: (ctx && ctx.request) || '' };
    if (isSecretPath(rel)) { ev.redacted = true; return ev; }
    let diff = '';
    try { diff = git(root, ['diff', 'HEAD', '--no-color', '-U2', '--', rel]); } catch { /* 첫 커밋 전 */ }
    ev.patch = slimPatch(parseUnifiedDiff(diff));
    if (!ev.patch && now !== 'gone') {
      // 아직 git이 모르는 새 파일은 내용을 직접 읽습니다 (이진 파일 제외)
      try {
        const buf = fs.readFileSync(path.join(root, rel));
        if (buf.length <= MAX_HASH && !buf.includes(0)) { ev.edits = [{ old: null, new: clip(buf.toString('utf8'), 4000) }]; ev.kind = 'create'; }
      } catch { /* 그새 사라짐 */ }
    }
    return ev;
  });
}

const snapshotPath = (root, id) => path.join(dataDir(root), 'tmp', `${String(id).replace(/[^\w-]/g, '_')}.json`);
function saveSnapshot(root, id, snap) {
  const p = snapshotPath(root, id);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(snap));
}
function loadSnapshot(root, id) {
  const p = snapshotPath(root, id);
  try { const s = JSON.parse(fs.readFileSync(p, 'utf8')); fs.unlinkSync(p); return s; } catch { return null; }
}

module.exports = { takeSnapshot, diffSnapshots, bashEvents, saveSnapshot, loadSnapshot, parseUnifiedDiff };
