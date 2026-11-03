'use strict';
// Claude Code 설정에 Mycena 훅을 넣고 뺍니다. 사용자의 다른 설정은 건드리지 않습니다.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { dataDir } = require('./util');

const BIN = path.resolve(__dirname, '..', 'bin', 'mycena.js');
const ALLOW_NOTES = 'Edit(./.mycena/**)';
const isMine = (entry) => JSON.stringify(entry).includes('mycena.js');

// 형식이 잘못된 설정 파일을 빈 설정으로 덮어쓰면 사용자 설정이 날아가므로, 없을 때만 새로 만듭니다.
function readSettings(p) {
  let raw;
  try { raw = fs.readFileSync(p, 'utf8'); } catch (e) {
    if (e.code === 'ENOENT') return {};
    throw e;
  }
  try { return JSON.parse(raw); } catch (e) { throw new Error(`${p} 파일을 JSON으로 읽을 수 없어요. 고친 뒤 다시 실행해 주세요. (${e.message})`); }
}

// 훅 명령에는 이 컴퓨터의 절대경로가 들어가므로, 프로젝트별 설치는 커밋되지 않는 settings.local.json에 넣습니다.
function settingsPath(root, global, home) {
  return global ? path.join(home, '.claude', 'settings.json') : path.join(root, '.claude', 'settings.local.json');
}

function init(root, { global = false, home = os.homedir() } = {}) {
  const base = global ? path.join(home, '.claude') : path.join(root, '.claude');
  fs.mkdirSync(path.join(base, 'commands'), { recursive: true });
  const sp = settingsPath(root, global, home);
  const s = readSettings(sp);
  const cmd = (sub, timeout) => ({ type: 'command', command: `node ${JSON.stringify(BIN)} ${sub}`, timeout });
  s.hooks = s.hooks || {};
  const add = (event, entry) => { s.hooks[event] = (s.hooks[event] || []).filter((x) => !isMine(x)).concat(entry); };
  add('PreToolUse', { matcher: 'Bash', hooks: [cmd('hook-pre', 10)] });
  add('PostToolUse', { matcher: 'Edit|Write|MultiEdit|NotebookEdit|Bash', hooks: [cmd('hook-post', 10)] });
  add('Stop', { hooks: [cmd('hook-stop', 30)] });
  // 노트를 쓸 때마다 권한을 묻지 않도록 .mycena 폴더만 허용
  s.permissions = s.permissions || {};
  s.permissions.allow = s.permissions.allow || [];
  if (!s.permissions.allow.includes(ALLOW_NOTES)) s.permissions.allow.push(ALLOW_NOTES);
  fs.writeFileSync(sp, JSON.stringify(s, null, 2) + '\n');
  fs.copyFileSync(path.join(__dirname, '..', 'commands', 'mycena-describe.md'), path.join(base, 'commands', 'mycena-describe.md'));
  if (!global) {
    dataDir(root);
    const gi = path.join(root, '.gitignore');
    let cur = ''; try { cur = fs.readFileSync(gi, 'utf8'); } catch { /* 없음 */ }
    if (!cur.split('\n').includes('.claude/settings.local.json')) fs.appendFileSync(gi, (cur && !cur.endsWith('\n') ? '\n' : '') + '.claude/settings.local.json\n');
  }
  return { settings: sp };
}

function uninstall(root, { global = false, home = os.homedir() } = {}) {
  const sp = settingsPath(root, global, home);
  if (!fs.existsSync(sp)) return { settings: sp, changed: false };
  const s = readSettings(sp);
  for (const ev of Object.keys(s.hooks || {})) {
    s.hooks[ev] = s.hooks[ev].filter((x) => !isMine(x));
    if (!s.hooks[ev].length) delete s.hooks[ev];
  }
  if (s.hooks && !Object.keys(s.hooks).length) delete s.hooks;
  if (s.permissions && s.permissions.allow) {
    s.permissions.allow = s.permissions.allow.filter((x) => x !== ALLOW_NOTES);
    if (!s.permissions.allow.length) delete s.permissions.allow;
    if (!Object.keys(s.permissions).length) delete s.permissions;
  }
  fs.writeFileSync(sp, JSON.stringify(s, null, 2) + '\n');
  const base = global ? path.join(home, '.claude') : path.join(root, '.claude');
  fs.rmSync(path.join(base, 'commands', 'mycena-describe.md'), { force: true });
  return { settings: sp, changed: true };
}

// 훅 설치 상태: none(없음), current(이 위치), stale(다른 위치 — 확장 업데이트로 경로가 바뀐 경우)
function hookStatus(root, { home = os.homedir() } = {}) {
  let found = 'none';
  for (const sp of [settingsPath(root, false, home), settingsPath(root, true, home)]) {
    let raw = ''; try { raw = fs.readFileSync(sp, 'utf8'); } catch { continue; }
    if (!raw.includes('mycena.js')) continue;
    if (raw.includes(JSON.stringify(JSON.stringify(BIN)).slice(1, -1))) return 'current';
    found = 'stale';
  }
  return found;
}

module.exports = { init, uninstall, hookStatus };
