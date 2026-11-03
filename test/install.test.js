'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const http = require('http');
const { tempProject } = require('./helpers');
const { init, uninstall } = require('../src/install');
const { createServer } = require('../src/output');

const read = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));

test('init: 기존 설정을 보존하고, 다시 실행해도 훅이 중복되지 않으며, uninstall로 원상복구된다', () => {
  const root = tempProject({ '.claude/settings.local.json': JSON.stringify({ model: 'x', hooks: { Stop: [{ hooks: [{ type: 'command', command: 'echo keep' }] }] } }) });
  const before = read(path.join(root, '.claude/settings.local.json'));
  init(root); init(root);
  const s = read(path.join(root, '.claude/settings.local.json'));
  assert.strictEqual(s.model, 'x');
  assert.strictEqual(s.hooks.Stop.length, 2);
  assert.strictEqual(s.hooks.PostToolUse.length, 1);
  assert.strictEqual(s.hooks.PreToolUse.length, 1);
  assert.ok(fs.existsSync(path.join(root, '.claude/commands/mycena-describe.md')));
  assert.ok(fs.readFileSync(path.join(root, '.gitignore'), 'utf8').includes('.claude/settings.local.json'));
  uninstall(root);
  assert.deepStrictEqual(read(path.join(root, '.claude/settings.local.json')), before);
});

test('init: 형식이 깨진 설정 파일은 덮어쓰지 않고 멈춘다', () => {
  const root = tempProject({ '.claude/settings.local.json': '{ // 주석\n}' });
  assert.throws(() => init(root), /JSON/);
  assert.strictEqual(fs.readFileSync(path.join(root, '.claude/settings.local.json'), 'utf8'), '{ // 주석\n}');
});

test('init --global: 홈의 settings.json에 설치한다', () => {
  const home = tempProject({});
  const root = tempProject({});
  init(root, { global: true, home });
  assert.ok(read(path.join(home, '.claude/settings.json')).hooks.Stop);
  assert.ok(!fs.existsSync(path.join(root, '.claude')));
});

test('서버: 데이터를 주고, 다른 Host로 온 요청은 거절한다', async () => {
  const srv = createServer(tempProject({ 'a.js': '1\n' }));
  await new Promise((ok) => srv.listen(0, '127.0.0.1', ok));
  const { port } = srv.address();
  const get = (host, p) => new Promise((ok, no) => {
    http.get({ host: '127.0.0.1', port, path: p, headers: { host } }, (res) => {
      let b = ''; res.on('data', (c) => { b += c; }); res.on('end', () => ok({ status: res.statusCode, body: b }));
    }).on('error', no);
  });
  try {
    const r = await get(`localhost:${port}`, '/data.json');
    assert.ok(JSON.parse(r.body).nodes.some((n) => n.id === 'a.js'));
    assert.match((await get(`127.0.0.1:${port}`, '/')).body, /__LIVE__=true/);
    assert.strictEqual((await get('evil.example', '/data.json')).status, 403);
  } finally { srv.close(); }
});
