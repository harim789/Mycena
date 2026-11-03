'use strict';
// Claude Code 대화 기록(.jsonl)에서 "사용자 요청"과 "Claude의 말"을 읽고, 훅 설치 전의 작업을 가져옵니다.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { clip } = require('./util');
const { FILE_TOOLS, makeFileEvent } = require('./events');
const { readEvents, appendEvents } = require('./store');

function readTail(p, bytes = 600000) {
  const fd = fs.openSync(p, 'r');
  try {
    const size = fs.fstatSync(fd).size;
    const start = Math.max(0, size - bytes);
    const buf = Buffer.alloc(size - start);
    fs.readSync(fd, buf, 0, buf.length, start);
    let s = buf.toString('utf8');
    if (start > 0) s = s.slice(s.indexOf('\n') + 1);
    return s.split('\n').filter(Boolean);
  } finally { fs.closeSync(fd); }
}
function textOf(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) return content.filter((b) => b && b.type === 'text').map((b) => b.text).join('\n');
  return '';
}
// 앱이 끼워 넣은 시스템 안내를 걷어내고 사람이 쓴 말만 남깁니다. 슬래시 명령 같은 내부 메시지는 빈 문자열이 됩니다.
function humanText(content) {
  const t = textOf(content).replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, '').trim();
  return t.startsWith('<') ? '' : t;
}
const isToolResult = (c) => Array.isArray(c) && c.some((b) => b && b.type === 'tool_result');

function turnContext(transcriptPath) {
  const res = { said: '', request: '' };
  if (!transcriptPath || !fs.existsSync(transcriptPath)) return res;
  try {
    const lines = readTail(transcriptPath);
    for (let i = lines.length - 1; i >= 0; i--) {
      let o; try { o = JSON.parse(lines[i]); } catch { continue; }
      const msg = o.message || {};
      if (o.type === 'assistant' && !res.said) {
        const t = textOf(msg.content).trim();
        if (t) res.said = clip(t, 800);
      } else if (o.type === 'user' && !o.isMeta && !o.isSidechain && !isToolResult(msg.content)) {
        const t = humanText(msg.content);
        if (t) { res.request = clip(t, 800); break; }
      }
    }
  } catch { /* 대화 기록 형식이 달라도 기록은 계속 */ }
  return res;
}

// 대화 기록 하나를 훑어 성공한 파일 수정만 이벤트로 바꿉니다.
function eventsFromTranscript(file, root) {
  const out = [];
  const uses = new Map();
  const ctx = { request: '', said: '' };
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    if (!line) continue;
    let o; try { o = JSON.parse(line); } catch { continue; }
    const c = o.message && o.message.content;
    if (o.type === 'assistant' && Array.isArray(c)) {
      const t = textOf(c).trim();
      if (t) ctx.said = clip(t, 800);
      for (const b of c) if (b && b.type === 'tool_use' && FILE_TOOLS.has(b.name)) uses.set(b.id, b);
    } else if (o.type === 'user' && !o.isMeta) {
      if (!isToolResult(c)) {
        const t = o.isSidechain ? '' : humanText(c);
        if (t) { ctx.request = clip(t, 800); ctx.said = ''; }
        continue;
      }
      for (const b of c) {
        if (!b || b.type !== 'tool_result' || b.is_error || !uses.has(b.tool_use_id)) continue;
        const u = uses.get(b.tool_use_id);
        const ev = makeFileEvent({
          root, tool: u.name, input: u.input, response: o.toolUseResult, session: o.sessionId,
          ts: Date.parse(o.timestamp) || 0, id: u.id, ctx, imported: true,
        });
        if (ev) out.push(ev);
      }
    }
  }
  return out;
}

const transcriptDir = (root, home = os.homedir()) => path.join(home, '.claude', 'projects', root.replace(/[^a-zA-Z0-9]/g, '-'));

function listJsonl(dir) {
  let ents = [];
  try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { return []; }
  return ents.flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return e.name === 'memory' ? [] : listJsonl(p);
    return e.isFile() && e.name.endsWith('.jsonl') ? [p] : [];
  });
}

// 여러 번 실행해도 같은 수정이 두 번 쌓이지 않습니다.
function importHistory(root, dir = transcriptDir(root)) {
  const seen = new Set(readEvents(root).map((e) => e.id).filter(Boolean));
  const fresh = [];
  const files = listJsonl(dir);
  for (const file of files) {
    let evs = [];
    try { evs = eventsFromTranscript(file, root); } catch (e) { process.stderr.write(`[mycena] 건너뜀 ${file}: ${e.message}\n`); }
    for (const ev of evs) if (!seen.has(ev.id)) { seen.add(ev.id); fresh.push(ev); }
  }
  fresh.sort((a, b) => a.ts - b.ts);
  appendEvents(root, fresh);
  return { transcripts: files.length, added: fresh.length, dir };
}

module.exports = { turnContext, humanText, eventsFromTranscript, importHistory, transcriptDir };
