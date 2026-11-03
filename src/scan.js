'use strict';
// 그래프에 올릴 파일 목록과 파일별 git 기록을 모읍니다.
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { DATA, toPosix } = require('./util');

const IGNORE_DIRS = new Set(['node_modules', 'dist', 'build', 'out', 'target', 'venv', '__pycache__', 'coverage', 'obj', 'vendor']);
const CODE_EXT = new Set(['.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs', '.vue', '.svelte', '.py', '.java', '.kt',
  '.go', '.rb', '.php', '.cs', '.css', '.scss', '.html', '.sql', '.yml', '.yaml', '.properties', '.gradle', '.kts',
  '.xml', '.json', '.md', '.sh', '.prisma', '.toml', '.swift', '.rs', '.c', '.h', '.cpp']);
const SPECIAL_NAMES = new Set(['Dockerfile', 'Makefile']);
const IGNORE_FILES = new Set(['package-lock.json', 'yarn.lock', 'pnpm-lock.yaml', 'tsconfig.tsbuildinfo']);
const MAX_FILES = 1500;
const MAX_READ = 300 * 1024;

function gitOut(r, args) {
  return execFileSync('git', ['-C', r, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 64 * 1024 * 1024 });
}

const skipDir = (name) => name.startsWith('.') || IGNORE_DIRS.has(name) || name === DATA;
const wanted = (name) => {
  const ext = path.extname(name).toLowerCase();
  return (CODE_EXT.has(ext) || SPECIAL_NAMES.has(name)) && !IGNORE_FILES.has(name);
};

// git 저장소면 .gitignore를 존중하는 목록을 쓰고, 아니면 폴더를 직접 훑습니다.
function listPaths(r) {
  try {
    return gitOut(r, ['ls-files', '-co', '--exclude-standard', '-z']).split('\0').filter(Boolean)
      .filter((rel) => !rel.split('/').slice(0, -1).some(skipDir));
  } catch { /* git 저장소가 아님 */ }
  const out = [];
  const walk = (d) => {
    let ents; try { ents = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of ents) {
      const abs = path.join(d, e.name);
      if (e.isDirectory()) { if (!skipDir(e.name)) walk(abs); } else if (e.isFile()) out.push(toPosix(path.relative(r, abs)));
    }
  };
  walk(r);
  return out;
}

function scanFiles(r) {
  const out = [];
  for (const rel of listPaths(r).sort()) {
    if (out.length >= MAX_FILES) break;
    const name = path.posix.basename(rel);
    if (!wanted(name)) continue;
    const abs = path.join(r, rel);
    let st; try { st = fs.statSync(abs); } catch { continue; } // git에는 있지만 지워진 파일
    if (!st.isFile()) continue;
    let text = '';
    if (st.size <= MAX_READ) { try { text = fs.readFileSync(abs, 'utf8'); } catch { /* 읽기 실패는 내용 없이 표시 */ } }
    out.push({ rel, ext: path.extname(name).toLowerCase(), text, name });
  }
  return out;
}

// 파일별 최근 커밋 (Claude가 만들지 않은 코드도 "언제, 왜 이렇게 됐는지" 볼 수 있도록)
function gitHistory(r, perFile = 5, maxCommits = 400) {
  const map = new Map();
  let raw;
  try { raw = gitOut(r, ['log', `-n${maxCommits}`, '--no-renames', '--format=%x01%h%x02%an%x02%at%x02%s', '--name-only']); } catch { return map; }
  for (const block of raw.split('\x01')) {
    if (!block.trim()) continue;
    const [head, ...names] = block.split('\n');
    const [hash, author, at, subject] = head.split('\x02');
    const commit = { hash, author, time: Number(at) * 1000, subject };
    for (const name of names) {
      if (!name) continue;
      if (!map.has(name)) map.set(name, []);
      if (map.get(name).length < perFile) map.get(name).push(commit);
    }
  }
  return map;
}

module.exports = { scanFiles, gitHistory };
