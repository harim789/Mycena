'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { tempProject, gitProject, git, runHook, readEvents } = require('./helpers');

const postEdit = (cwd, over = {}) => runHook('hook-post', {
  cwd, session_id: 's1', tool_use_id: 'tu1', tool_name: 'Edit',
  tool_input: { file_path: path.join(cwd, 'a.js'), old_string: 'x', new_string: 'y' },
  tool_response: { structuredPatch: [{ oldStart: 1, newStart: 1, lines: ['-x', '+y'] }] }, ...over,
});

test('Edit 기록: diff와 사용자 요청을 남긴다', () => {
  const cwd = tempProject({ 'a.js': 'y\n' });
  const tr = path.join(cwd, 't.jsonl');
  fs.writeFileSync(tr, [
    { type: 'user', message: { content: '<system-reminder>안내</system-reminder>로그인 고쳐줘' } },
    { type: 'assistant', message: { content: [{ type: 'text', text: '수정할게요' }] } },
  ].map((x) => JSON.stringify(x)).join('\n') + '\n');
  assert.strictEqual(postEdit(cwd, { transcript_path: tr }).status, 0);
  const [ev] = readEvents(cwd);
  assert.strictEqual(ev.file, 'a.js');
  assert.deepStrictEqual(ev.patch[0].lines, ['-x', '+y']);
  assert.strictEqual(ev.request, '로그인 고쳐줘');
  assert.strictEqual(ev.said, '수정할게요');
});

test('프로젝트 밖, .mycena, .claude 수정은 기록하지 않는다', () => {
  const cwd = tempProject({});
  for (const fp of ['/etc/hosts', path.join(cwd, '.mycena/notes/x.json'), path.join(cwd, '.claude/settings.json')]) {
    postEdit(cwd, { tool_input: { file_path: fp, old_string: 'a', new_string: 'b' } });
  }
  assert.deepStrictEqual(readEvents(cwd), []);
});

test('.env 같은 민감한 파일은 내용을 기록하지 않는다', () => {
  const cwd = tempProject({});
  runHook('hook-post', { cwd, session_id: 's', tool_name: 'Write', tool_input: { file_path: path.join(cwd, '.env'), content: 'TOKEN=abc' }, tool_response: { type: 'create' } });
  const [ev] = readEvents(cwd);
  assert.strictEqual(ev.redacted, true);
  assert.ok(!JSON.stringify(ev).includes('TOKEN'));
});

test('.mycena 원본 기록은 git에 잡히지 않는다', () => {
  const cwd = gitProject({ 'a.js': 'y\n' });
  postEdit(cwd);
  assert.strictEqual(git(cwd, 'status', '--porcelain', '--untracked-files=all').includes('events.jsonl'), false);
});

test('Stop: 노트 없는 수정이 있으면 한 번 붙잡고, 노트가 생기면 놓아준다', () => {
  const cwd = tempProject({ 'a.js': 'y\n' });
  postEdit(cwd);
  const res = runHook('hook-stop', { cwd, session_id: 's1' });
  const out = JSON.parse(res.stdout);
  assert.strictEqual(out.decision, 'block');
  assert.match(out.reason, /a\.js/);
  const id = /\.mycena\/notes\/([\w-]+)\.json/.exec(out.reason)[1];

  // 무한 반복 방지
  assert.strictEqual(runHook('hook-stop', { cwd, session_id: 's1', stop_hook_active: true }).stdout, '');

  fs.writeFileSync(path.join(cwd, `.mycena/notes/${id}.json`), JSON.stringify({ session: 's1', title: 't', files: [] }));
  assert.strictEqual(runHook('hook-stop', { cwd, session_id: 's1' }).stdout, '');
  assert.ok(fs.existsSync(path.join(cwd, '.mycena/graph.html')));
});

test('Stop: 다른 세션의 수정이나 끈 설정에는 노트를 요청하지 않는다', () => {
  const cwd = tempProject({ 'a.js': 'y\n' });
  postEdit(cwd);
  assert.strictEqual(runHook('hook-stop', { cwd, session_id: 'other' }).stdout, '');
  assert.strictEqual(runHook('hook-stop', { cwd, session_id: 's1' }, { MYCENA_NO_NOTE: '1' }).stdout, '');
});

test('훅은 입력이 망가져도 Claude를 막지 않는다', () => {
  const { spawnSync } = require('child_process');
  const { BIN } = require('./helpers');
  for (const sub of ['hook-pre', 'hook-post', 'hook-stop']) {
    const r = spawnSync('node', [BIN, sub], { input: 'not json', encoding: 'utf8', cwd: tempProject({}), env: { ...process.env, CLAUDE_PROJECT_DIR: '' } });
    assert.strictEqual(r.status, 0, sub);
  }
});

const bash = (cwd, id, command, action) => {
  runHook('hook-pre', { cwd, session_id: 's', tool_use_id: id, tool_name: 'Bash', tool_input: { command } });
  action();
  return runHook('hook-post', { cwd, session_id: 's', tool_use_id: id, tool_name: 'Bash', tool_input: { command }, tool_response: {} });
};

test('Bash: 셸로 수정·생성·삭제한 파일을 찾아 기록한다', () => {
  const cwd = gitProject({ 'a.js': 'one\n', 'gone.js': 'x\n' });
  bash(cwd, 'b1', "sed -i '' ...", () => {
    fs.writeFileSync(path.join(cwd, 'a.js'), 'two\n');
    fs.writeFileSync(path.join(cwd, 'new.js'), 'hello\n');
    fs.unlinkSync(path.join(cwd, 'gone.js'));
  });
  const evs = readEvents(cwd);
  const by = Object.fromEntries(evs.map((e) => [e.file, e]));
  assert.strictEqual(by['a.js'].kind, 'bash');
  assert.ok(by['a.js'].patch[0].lines.includes('+two'));
  assert.strictEqual(by['new.js'].kind, 'create');
  assert.strictEqual(by['new.js'].edits[0].new, 'hello\n');
  assert.strictEqual(by['gone.js'].kind, 'delete');
  assert.match(by['a.js'].command, /sed/);
});

test('Bash: 파일을 안 바꾸는 명령과 이미 고쳐져 있던 파일은 기록하지 않는다', () => {
  const cwd = gitProject({ 'a.js': 'one\n' });
  fs.writeFileSync(path.join(cwd, 'a.js'), 'dirty\n');
  bash(cwd, 'b1', 'ls', () => {});
  assert.deepStrictEqual(readEvents(cwd), []);
});

test('Bash: git commit으로 작업 트리가 깨끗해진 것은 수정으로 치지 않는다', () => {
  const cwd = gitProject({ 'a.js': 'one\n' });
  fs.writeFileSync(path.join(cwd, 'a.js'), 'dirty\n');
  bash(cwd, 'b1', 'git commit', () => { git(cwd, 'commit', '-qam', 'two'); });
  assert.deepStrictEqual(readEvents(cwd), []);
});

test('Bash: git 저장소가 아니면 조용히 넘어간다', () => {
  const cwd = tempProject({ 'a.js': 'one\n' });
  const r = bash(cwd, 'b1', 'x', () => fs.writeFileSync(path.join(cwd, 'a.js'), 'two\n'));
  assert.strictEqual(r.status, 0);
  assert.deepStrictEqual(readEvents(cwd), []);
});
