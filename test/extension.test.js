'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { fork } = require('child_process');
const { BIN, tempProject } = require('./helpers');
const { safeFilePath, browserUrl } = require('../extension/helpers');
const { init, hookStatus } = require('../src/install');
const { viewerHtml } = require('../src/output');

test('safeFilePath: 프로젝트 밖으로 나가는 경로는 거절한다', () => {
  assert.strictEqual(safeFilePath('/p/app', 'src/a.js'), '/p/app/src/a.js');
  for (const bad of ['../secret', '/etc/passwd', '../app2/x', '', null, 3]) assert.strictEqual(safeFilePath('/p/app', bad), null, String(bad));
});

test('browserUrl: 선택한 별을 주소에 안전하게 담고, 모르는 값은 무시한다', () => {
  assert.strictEqual(browserUrl(9, null), 'http://localhost:9/');
  assert.strictEqual(browserUrl(9, { kind: 'node', id: 'src/a b.js' }), 'http://localhost:9/#node=src%2Fa+b.js');
  assert.strictEqual(browserUrl(9, { kind: 'evil', id: 'x' }), 'http://localhost:9/');
});

test('hookStatus: 없음, 현재 위치, 옮겨진 위치를 구분한다', () => {
  const home = tempProject({});
  const root = tempProject({});
  assert.strictEqual(hookStatus(root, { home }), 'none');
  init(root, { home });
  assert.strictEqual(hookStatus(root, { home }), 'current');
  const p = path.join(root, '.claude/settings.local.json');
  fs.writeFileSync(p, fs.readFileSync(p, 'utf8').replace(/node \\".*?mycena\.js\\"/g, 'node \\"/old/place/mycena.js\\"'));
  assert.strictEqual(hookStatus(root, { home }), 'stale');
});

test('serve 0: 빈 포트를 골라 부모에게 알려주고, 부모가 끊으면 종료한다', async () => {
  const root = tempProject({ 'a.js': '1\n' });
  const child = fork(BIN, ['serve', '0'], { env: { ...process.env, MYCENA_ROOT: root }, silent: true });
  const { port } = await new Promise((ok) => child.once('message', ok));
  assert.ok(port > 0);
  const body = await (await fetch(`http://127.0.0.1:${port}/data.json`)).json();
  assert.ok(body.nodes.some((n) => n.id === 'a.js'));
  const exited = new Promise((ok) => child.once('exit', ok));
  child.disconnect();
  assert.strictEqual(await exited, 0);
});

test('뷰어: 미리보기 버튼과 확장용 부트 코드가 들어간다', () => {
  const html = viewerHtml('window.__EMBED__=true;');
  assert.match(html, /window\.__EMBED__=true;/);
  assert.match(html, /브라우저에서 크게 보기/);
  assert.ok(!html.includes('__APP__') && !html.includes('__STYLE__'));
});
