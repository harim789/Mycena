'use strict';
const fs = require('fs');
const path = require('path');

const DATA = '.mycena';
const toPosix = (p) => p.split(path.sep).join('/');
const clip = (s, n) => (typeof s === 'string' && s.length > n ? s.slice(0, n) + `\n…(${s.length - n}자 생략)` : s);

function projectRoot(inp) {
  return path.resolve(process.env.CLAUDE_PROJECT_DIR || (inp && inp.cwd) || process.cwd());
}

// .mycena/.gitignore 를 함께 두어, 어떤 프로젝트에서든 코드 조각이 든 원본 기록이 커밋되지 않게 합니다.
function dataDir(r) {
  const d = path.join(r, DATA);
  fs.mkdirSync(path.join(d, 'notes'), { recursive: true });
  const gi = path.join(d, '.gitignore');
  if (!fs.existsSync(gi)) fs.writeFileSync(gi, 'events.jsonl\ngraph.html\ntmp/\n');
  return d;
}

// 코드 내용을 기록에 남기면 안 되는 파일 (.env.example 같은 견본은 제외)
function isSecretPath(rel) {
  const name = path.posix.basename(rel);
  if (/\.(example|sample|template|dist)$/i.test(name)) return false;
  return /^\.env(\..+)?$/i.test(name) || /\.(pem|key|p12|pfx|keystore|jks)$/i.test(name) || /^id_(rsa|dsa|ecdsa|ed25519)/i.test(name) || /^(credentials?|secrets?)(\.[^.]+)?$/i.test(name);
}

// 프로젝트 안의 파일이면 상대경로를, Mycena가 추적하지 않을 경로면 null을 돌려줍니다.
function trackablePath(root, file) {
  const rel = toPosix(path.relative(root, path.resolve(root, file)));
  if (!rel || rel === '..' || rel.startsWith('../') || path.isAbsolute(rel)) return null;
  if (rel.startsWith(DATA + '/') || rel.startsWith('.claude/') || rel.startsWith('.git/')) return null;
  return rel;
}

module.exports = { DATA, toPosix, clip, projectRoot, dataDir, isSecretPath, trackablePath };
