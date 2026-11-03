'use strict';
// .mycena 폴더의 자동 기록(events), 작업 노트(notes), 파일 설명(descriptions)을 읽고 씁니다.
const fs = require('fs');
const path = require('path');
const { DATA, dataDir } = require('./util');

function readEvents(r) {
  const p = path.join(r, DATA, 'events.jsonl');
  if (!fs.existsSync(p)) return [];
  return fs.readFileSync(p, 'utf8').split('\n').filter(Boolean).map((l) => {
    try { return JSON.parse(l); } catch { return null; }
  }).filter(Boolean);
}
function appendEvents(r, events) {
  if (!events.length) return;
  fs.appendFileSync(path.join(dataDir(r), 'events.jsonl'), events.map((e) => JSON.stringify(e)).join('\n') + '\n');
}

// 파일 이름의 시각(ISO)을 우선합니다. mtime은 git clone만 해도 바뀌어 작업 순서가 뒤섞이기 때문입니다.
function noteTime(id, mtime) {
  const m = /^(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})-(\d{3})/.exec(id);
  const t = m ? Date.parse(`${m[1]}T${m[2]}:${m[3]}:${m[4]}.${m[5]}Z`) : NaN;
  return Number.isNaN(t) ? mtime : t;
}
function newNoteId(now = new Date()) {
  return now.toISOString().replace(/[:.]/g, '-').replace('Z', '');
}
function readNotes(r) {
  const dir = path.join(r, DATA, 'notes');
  const out = [];
  let files = [];
  try { files = fs.readdirSync(dir); } catch { return out; }
  for (const f of files) {
    if (!f.endsWith('.json')) continue;
    const p = path.join(dir, f);
    const id = f.replace(/\.json$/, '');
    const time = noteTime(id, fs.statSync(p).mtimeMs);
    let n = null;
    try { n = JSON.parse(fs.readFileSync(p, 'utf8')); } catch { /* 아래에서 처리 */ }
    if (n && typeof n === 'object' && !Array.isArray(n)) out.push(Object.assign(n, { _id: id, _time: time }));
    else out.push({ _id: id, _time: time, title: `(노트 형식 오류: ${f})`, files: [], _broken: true });
  }
  return out;
}
function readDescriptions(r) {
  try {
    const d = JSON.parse(fs.readFileSync(path.join(r, DATA, 'descriptions.json'), 'utf8'));
    return d && typeof d === 'object' && !Array.isArray(d) ? d : {};
  } catch { return {}; }
}

module.exports = { readEvents, appendEvents, readNotes, readDescriptions, newNoteId };
