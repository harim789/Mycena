'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { tempProject, readEvents } = require('./helpers');
const { importHistory, transcriptDir } = require('../src/transcript');

function writeTranscript(dir, root) {
  const f = (id) => path.join(root, id);
  const lines = [
    { type: 'user', sessionId: 's', timestamp: '2026-01-01T00:00:00Z', message: { content: '결제 버그 고쳐줘' } },
    { type: 'assistant', sessionId: 's', timestamp: '2026-01-01T00:00:01Z', message: { content: [
      { type: 'text', text: '고칠게요' },
      { type: 'tool_use', id: 'ok', name: 'Edit', input: { file_path: f('a.js'), old_string: 'x', new_string: 'y' } },
      { type: 'tool_use', id: 'fail', name: 'Edit', input: { file_path: f('b.js'), old_string: 'x', new_string: 'y' } },
      { type: 'tool_use', id: 'out', name: 'Write', input: { file_path: '/elsewhere/c.js', content: 'z' } },
      { type: 'tool_use', id: 'read', name: 'Read', input: { file_path: f('a.js') } },
    ] } },
    { type: 'user', sessionId: 's', timestamp: '2026-01-01T00:00:02Z', toolUseResult: { structuredPatch: [{ oldStart: 3, newStart: 3, lines: ['-x', '+y'] }] }, message: { content: [{ type: 'tool_result', tool_use_id: 'ok' }] } },
    { type: 'user', sessionId: 's', timestamp: '2026-01-01T00:00:02Z', message: { content: [{ type: 'tool_result', tool_use_id: 'fail', is_error: true }] } },
    { type: 'user', sessionId: 's', timestamp: '2026-01-01T00:00:02Z', toolUseResult: { type: 'create' }, message: { content: [{ type: 'tool_result', tool_use_id: 'out' }] } },
    { type: 'user', sessionId: 's', timestamp: '2026-01-01T00:00:02Z', message: { content: [{ type: 'tool_result', tool_use_id: 'read' }] } },
  ];
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 's.jsonl'), lines.map((l) => JSON.stringify(l)).join('\n') + '\nnot json\n');
}

test('import: 프로젝트 안의 성공한 수정만 가져오고, 다시 실행해도 중복되지 않는다', () => {
  const root = tempProject({ 'a.js': 'y\n' });
  const dir = tempProject({});
  writeTranscript(dir, root);
  assert.strictEqual(importHistory(root, dir).added, 1);
  const [ev] = readEvents(root);
  assert.strictEqual(ev.file, 'a.js');
  assert.strictEqual(ev.request, '결제 버그 고쳐줘');
  assert.strictEqual(ev.imported, true);
  assert.strictEqual(ev.ts, Date.parse('2026-01-01T00:00:02Z'));
  assert.deepStrictEqual(ev.patch[0].lines, ['-x', '+y']);
  assert.strictEqual(importHistory(root, dir).added, 0);
  assert.strictEqual(readEvents(root).length, 1);
});

test('대화 기록 폴더 이름은 Claude Code 규칙을 따른다', () => {
  assert.strictEqual(path.basename(transcriptDir('/Users/me/My_App.v2')), '-Users-me-My-App-v2');
});
