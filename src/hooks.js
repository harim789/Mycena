'use strict';
// Claude Code 훅에서 불리는 진입점들. 실패해도 Claude의 작업을 막지 않습니다 (bin/mycena.js 참고).
const fs = require('fs');
const path = require('path');
const { DATA, projectRoot } = require('./util');
const { readEvents, appendEvents, readNotes, newNoteId } = require('./store');
const { makeFileEvent } = require('./events');
const { turnContext } = require('./transcript');
const { takeSnapshot, diffSnapshots, bashEvents, saveSnapshot, loadSnapshot } = require('./bashtrack');
const { writeStatic } = require('./output');

function readStdin() {
  try { return JSON.parse(fs.readFileSync(0, 'utf8') || '{}'); } catch { return {}; }
}

function hookPre(inp = readStdin()) {
  if (inp.tool_name !== 'Bash') return;
  const r = projectRoot(inp);
  const snap = takeSnapshot(r);
  if (snap) saveSnapshot(r, inp.tool_use_id || 'bash', snap);
}

function hookPost(inp = readStdin()) {
  const r = projectRoot(inp);
  const ts = Date.now();
  if (inp.tool_name === 'Bash') {
    const before = loadSnapshot(r, inp.tool_use_id || 'bash');
    if (!before) return;
    const changed = diffSnapshots(r, before, takeSnapshot(r));
    if (!changed.length) return;
    const command = inp.tool_input && inp.tool_input.command;
    appendEvents(r, bashEvents(r, changed, { session: inp.session_id, ts, id: inp.tool_use_id, command, ctx: turnContext(inp.transcript_path) }));
    return;
  }
  const ev = makeFileEvent({
    root: r, tool: inp.tool_name || 'Edit', input: inp.tool_input, response: inp.tool_response,
    session: inp.session_id, ts, id: inp.tool_use_id, ctx: turnContext(inp.transcript_path),
  });
  if (ev) appendEvents(r, [ev]);
}

function noteRequest(files, id, sid) {
  return [
    `[Mycena] 이번 작업에서 수정한 파일: ${files.join(', ')}`,
    '사용자가 관계 그래프에서 클릭해 바로 이해할 수 있도록 "변경 노트"를 하나 남겨 주세요.',
    `Write 도구로 \`${DATA}/notes/${id}.json\` 파일을 만들고 아래 JSON 형식을 지켜 주세요.`,
    '설명은 개발 입문자도 30초 안에 이해할 수 있게 쉬운 한국어로, 필요하면 일상 비유를 써 주세요.',
    '{',
    `  "session": "${sid}",`,
    '  "title": "한 줄 제목 (예: 로그인 실패 시 401과 안내 메시지 반환)",',
    '  "intent": "왜 이 작업을 했는지 — 사용자의 요청과 목적",',
    '  "before": "변경 전에는 어떻게 동작했는지",',
    '  "after": "변경 후에는 어떻게 동작하는지",',
    '  "files": [{ "path": "프로젝트 기준 상대경로", "what": "이 파일에서 무엇을 바꿨는지", "why": "왜 하필 이 파일인지" }],',
    '  "relations": [{ "from": "파일A", "to": "파일B", "desc": "A가 B를 어떻게/왜 사용하는지" }],',
    '  "concepts": ["관련 개념 1~3개 (예: JWT 인증, 예외 처리)"]',
    '}',
    '노트를 저장한 뒤에는 추가 작업 없이 한두 문장으로 마무리하세요.',
  ].join('\n');
}

// 아직 노트가 없는 수정이 있으면 응답을 한 번 붙잡아 노트를 요청합니다. stdout이 있으면 그것이 Claude Code에 전달할 응답입니다.
function hookStop(inp = readStdin()) {
  const r = projectRoot(inp);
  if (!fs.existsSync(path.join(r, DATA))) return ''; // 이 프로젝트에서 아직 아무것도 기록 안 됨
  const sid = inp.session_id || 'unknown';
  const done = () => {
    try { writeStatic(r); } catch (e) { process.stderr.write('[mycena] 그래프 생성 실패: ' + e.message + '\n'); }
    return '';
  };
  if (inp.stop_hook_active || process.env.MYCENA_NO_NOTE === '1') return done();
  const lastNote = readNotes(r).filter((n) => !n.session || n.session === sid).reduce((m, n) => Math.max(m, n._time), 0);
  const pending = readEvents(r).filter((e) => e.session === sid && !e.imported && e.ts > lastNote);
  if (!pending.length) return done();
  const files = [...new Set(pending.map((e) => e.file))];
  return JSON.stringify({ decision: 'block', reason: noteRequest(files, newNoteId(), sid) });
}

module.exports = { readStdin, hookPre, hookPost, hookStop };
