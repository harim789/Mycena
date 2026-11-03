'use strict';
// 뷰어 HTML 조립, 정적 파일 생성, 실시간 서버.
const fs = require('fs');
const path = require('path');
const http = require('http');
const { DATA, dataDir } = require('./util');
const { buildData } = require('./graph');

const VIEWER = path.join(__dirname, '..', 'viewer');
const safeJson = (o) => JSON.stringify(o).replace(/</g, '\\u003c').replace(new RegExp('\\u2028', 'g'), '\\u2028').replace(new RegExp('\\u2029', 'g'), '\\u2029');

// 치환 문자열 안의 $& 같은 패턴이 코드 조각을 망가뜨리지 않도록 함수형 replace를 씁니다.
function viewerHtml(boot) {
  const read = (f) => fs.readFileSync(path.join(VIEWER, f), 'utf8');
  return read('index.html')
    .replace('/*__STYLE__*/', () => read('style.css'))
    .replace('/*__APP__*/', () => read('app.js'))
    .replace('/*__BOOT__*/', () => boot);
}

function writeStatic(r, outPath) {
  const data = buildData(r);
  const out = outPath || path.join(dataDir(r), 'graph.html');
  fs.writeFileSync(out, viewerHtml(`window.__DATA__=${safeJson(data)};`));
  return { out, data };
}

function dataSignature(r) {
  const parts = [];
  for (const f of ['events.jsonl', 'descriptions.json']) {
    try { const s = fs.statSync(path.join(r, DATA, f)); parts.push(s.mtimeMs + ':' + s.size); } catch { parts.push('-'); }
  }
  try { const d = path.join(r, DATA, 'notes'); fs.readdirSync(d).forEach((f) => parts.push(f + ':' + fs.statSync(path.join(d, f)).mtimeMs)); } catch { /* 노트 없음 */ }
  return parts.join('|');
}

function createServer(r) {
  let cache = null; let sig = ''; let builtAt = 0;
  const get = () => {
    const s = dataSignature(r);
    if (!cache || s !== sig || Date.now() - builtAt > 5000) { cache = JSON.stringify(buildData(r)); sig = s; builtAt = Date.now(); }
    return cache;
  };
  return http.createServer((req, res) => {
    // 코드 조각이 담긴 데이터이므로 이 컴퓨터의 주소로 온 요청에만 답합니다 (DNS rebinding 방지).
    if (!/^(localhost|127\.0\.0\.1)(:\d+)?$/.test(req.headers.host || '')) { res.writeHead(403); return res.end(); }
    try {
      if (req.url.startsWith('/data.json')) {
        res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
        return res.end(get());
      }
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
      res.end(viewerHtml('window.__LIVE__=true;'));
    } catch (e) { res.writeHead(500); res.end(String((e && e.stack) || e)); }
  });
}

function serve(r, port) {
  const srv = createServer(r);
  srv.on('error', (e) => {
    console.error(e.code === 'EADDRINUSE' ? `포트 ${port}가 이미 사용 중이에요. 다른 번호로 실행해 주세요: mycena serve ${port + 1}` : e.message);
    process.exit(1);
  });
  srv.listen(port, '127.0.0.1', () => {
    const actual = srv.address().port;
    if (process.send) { // 확장이 띄운 서버: 포트를 알려주고, 확장이 끝나면 함께 종료
      process.send({ port: actual });
      process.on('disconnect', () => process.exit(0));
    }
    console.log(`\n  🍄 Mycena 실행 중 → http://localhost:${actual}\n  프로젝트: ${r}\n  Claude Code가 파일을 고치면 몇 초 안에 그래프에 불이 들어와요. (Ctrl+C로 종료)\n`);
  });
  return srv;
}

module.exports = { viewerHtml, writeStatic, createServer, serve };
