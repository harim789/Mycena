'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');

const BIN = path.join(__dirname, '..', 'bin', 'mycena.js');

function tempProject(files = {}) {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'mycena-test-')));
  for (const [rel, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), text);
  }
  return dir;
}
function git(dir, ...args) {
  return execFileSync('git', ['-C', dir, '-c', 'user.name=t', '-c', 'user.email=t@example.com', ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
}
function gitProject(files) {
  const dir = tempProject(files);
  git(dir, 'init', '-q');
  git(dir, 'add', '.');
  git(dir, 'commit', '-qm', 'first');
  return dir;
}
function runHook(sub, payload, env = {}) {
  const res = spawnSync('node', [BIN, sub], { input: JSON.stringify(payload), encoding: 'utf8', env: { ...process.env, CLAUDE_PROJECT_DIR: payload.cwd, ...env } });
  return res;
}
const readEvents = (dir) => {
  const p = path.join(dir, '.mycena', 'events.jsonl');
  return fs.existsSync(p) ? fs.readFileSync(p, 'utf8').trim().split('\n').map((l) => JSON.parse(l)) : [];
};

module.exports = { BIN, tempProject, git, gitProject, runHook, readEvents };
