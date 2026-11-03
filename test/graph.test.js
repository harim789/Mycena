'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { tempProject, gitProject } = require('./helpers');
const { buildData } = require('../src/graph');
const { writeStatic } = require('../src/output');

const edge = (d, a, b) => d.edges.find((e) => e.source === a && e.target === b);

test('JS import, 파이썬 import, 마크다운 링크를 연결선으로 만든다', () => {
  const dir = tempProject({
    'src/a.js': "import { b } from './b';\n",
    'src/b.js': 'export const b = 1;\n',
    'py/main.py': 'from .util import helper\n',
    'py/util.py': 'def helper(): pass\n',
    'README.md': '[코드](src/a.js)\n',
  });
  const d = buildData(dir);
  assert.deepStrictEqual(edge(d, 'src/a.js', 'src/b.js').symbols, ['b']);
  assert.ok(edge(d, 'py/main.py', 'py/util.py'));
  assert.ok(edge(d, 'README.md', 'src/a.js'));
});

test('같은 패키지의 클래스 이름 참조를 찾고, 정규식 특수문자가 든 파일명에도 죽지 않는다', () => {
  const dir = tempProject({
    'A.java': 'package app;\nclass A { B b; }\n',
    'B.java': 'package app;\nclass B {}\n',
    'C(1).java': 'package app;\nclass Other {}\n',
  });
  const d = buildData(dir);
  assert.ok(edge(d, 'A.java', 'B.java'));
});

test('.gitignore에 있는 파일은 그래프에 올리지 않는다', () => {
  const dir = gitProject({ '.gitignore': 'gen/\n', 'gen/out.js': '//x\n', 'a.js': '//y\n' });
  const ids = buildData(dir).nodes.map((n) => n.id);
  assert.ok(ids.includes('a.js'));
  assert.ok(!ids.includes('gen/out.js'));
});

test('파일 맨 앞 주석과 git 기록을 설명으로 제공한다', () => {
  const dir = gitProject({ 'a.js': '// 주문을 계산합니다\nexport const a = 1;\n' });
  const n = buildData(dir).nodes.find((x) => x.id === 'a.js');
  assert.strictEqual(n.doc, '주문을 계산합니다');
  assert.strictEqual(n.commits[0].subject, 'first');
});

test('노트 시각은 파일 이름을 따르고, 수정 기록은 그 직전 노트에 묶인다', () => {
  const dir = tempProject({ 'a.js': '1\n' });
  const id = '2026-01-02T03-04-05-000';
  const t = Date.parse('2026-01-02T03:04:05.000Z');
  fs.mkdirSync(path.join(dir, '.mycena/notes'), { recursive: true });
  fs.writeFileSync(path.join(dir, `.mycena/notes/${id}.json`), JSON.stringify({ session: 's', title: '제목', files: [{ path: './a.js', what: '무엇' }] }));
  fs.writeFileSync(path.join(dir, '.mycena/events.jsonl'), JSON.stringify({ ts: t - 1000, session: 's', tool: 'Edit', kind: 'edit', file: 'a.js', edits: [], patch: null, request: '요청' }) + '\n');
  const [c] = buildData(dir).changes;
  assert.strictEqual(c.time, t);
  assert.strictEqual(c.request, '요청');
  assert.strictEqual(c.events.length, 1);
  assert.strictEqual(c.files[0].path, 'a.js');
});

test('Claude가 이상한 형식의 노트를 써도 그래프는 만들어진다', () => {
  const dir = tempProject({ 'a.js': '1\n' });
  fs.mkdirSync(path.join(dir, '.mycena/notes'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.mycena/notes/broken.json'), '{not json');
  fs.writeFileSync(path.join(dir, '.mycena/notes/arr.json'), '[1,2]');
  fs.writeFileSync(path.join(dir, '.mycena/notes/odd.json'), JSON.stringify({ title: 3, files: 'a.js', relations: {}, concepts: 'x' }));
  fs.writeFileSync(path.join(dir, '.mycena/descriptions.json'), JSON.stringify({ 'a.js': 'x', 'b.js': null }));
  const d = buildData(dir);
  assert.strictEqual(d.changes.length, 3);
  assert.ok(d.nodes.some((n) => n.id === 'a.js'));
});

test('데이터가 같으면 version도 같고, 절대경로를 싣지 않는다', () => {
  const dir = tempProject({ 'a.js': '1\n' });
  const a = buildData(dir); const b = buildData(dir);
  assert.strictEqual(a.version, b.version);
  assert.ok(!JSON.stringify(a).includes(dir));
});

test('정적 HTML: 코드 조각의 $& 와 </script> 가 페이지를 깨지 않는다', () => {
  const dir = tempProject({ 'a.js': '1\n' });
  const nasty = "x.replace(/a/, '$&') + `$'` </script><script>alert(1)</script>";
  fs.mkdirSync(path.join(dir, '.mycena'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.mycena/events.jsonl'), JSON.stringify({ ts: 1, session: 's', tool: 'Write', kind: 'create', file: 'a.js', edits: [{ old: null, new: nasty }], patch: null }) + '\n');
  const { out, data } = writeStatic(dir);
  const html = fs.readFileSync(out, 'utf8');
  assert.strictEqual(html.match(/<\/script>/g).length, 1);
  const payload = /window\.__DATA__=(.*?);\n/s.exec(html)[1];
  assert.strictEqual(JSON.parse(payload).changes[0].events[0].edits[0].new, nasty);
  assert.strictEqual(data.changes.length, 1);
});

test('자동 기록 제목은 첨부 경로 줄을 건너뛰고 요청 문장을 쓴다', () => {
  const dir = tempProject({ 'a.js': '1\n' });
  fs.mkdirSync(path.join(dir, '.mycena'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.mycena/events.jsonl'), JSON.stringify({ ts: 1, session: 's', tool: 'Edit', kind: 'edit', file: 'a.js', edits: [], patch: null, request: '@"/tmp/x.zip"\n"로그인 고쳐줘"' }) + '\n');
  assert.strictEqual(buildData(dir).changes[0].title, '로그인 고쳐줘');
});
