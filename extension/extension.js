'use strict';
// VS Code 확장: 편집기 옆에 별 그래프 미리보기를 띄우고, 버튼 하나로 브라우저 전체 화면으로 넘겨줍니다.
const vscode = require('vscode');
const path = require('path');
const http = require('http');
const { fork } = require('child_process');
const { viewerHtml } = require('../src/output');
const { init, hookStatus } = require('../src/install');
const { safeFilePath, browserUrl } = require('./helpers');

const BIN = path.join(__dirname, '..', 'bin', 'mycena.js');
const POLL_MS = 2500;
const servers = new Map(); // 프로젝트 경로 -> { child, port }
const panels = new Map();  // 프로젝트 경로 -> WebviewPanel

function currentRoot() {
  const doc = vscode.window.activeTextEditor && vscode.window.activeTextEditor.document;
  const folder = (doc && vscode.workspace.getWorkspaceFolder(doc.uri)) || (vscode.workspace.workspaceFolders || [])[0];
  return folder ? folder.uri.fsPath : null;
}

// 그래프 분석이 에디터를 멈추지 않도록 서버는 별도 프로세스로 띄웁니다.
function ensureServer(root) {
  const running = servers.get(root);
  if (running) return running.ready;
  const child = fork(BIN, ['serve', '0'], { cwd: root, env: { ...process.env, MYCENA_ROOT: root }, silent: true });
  const entry = { child };
  entry.ready = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Mycena 서버가 시작되지 않았어요.')), 15000);
    child.once('message', (m) => { clearTimeout(timer); resolve(m.port); });
    child.once('error', (e) => { clearTimeout(timer); reject(e); });
    child.once('exit', () => { clearTimeout(timer); servers.delete(root); reject(new Error('Mycena 서버가 종료되었어요.')); });
  });
  servers.set(root, entry);
  return entry.ready;
}

function fetchData(port) {
  return new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port, path: '/data.json' }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (c) => { body += c; });
      res.on('end', () => { try { resolve(JSON.parse(body)); } catch (e) { reject(e); } });
    }).on('error', reject);
  });
}

async function openInBrowser(root, ref) {
  const port = await ensureServer(root);
  const external = await vscode.env.asExternalUri(vscode.Uri.parse(browserUrl(port, ref), true));
  await vscode.env.openExternal(external);
}

async function offerInstall(context, root) {
  const status = hookStatus(root);
  if (status === 'current') return;
  if (status === 'stale') { init(root); return; } // 확장 업데이트로 경로가 바뀌면 조용히 고칩니다
  if (context.workspaceState.get('mycena.installDeclined')) return;
  const yes = '설치';
  const pick = await vscode.window.showInformationMessage('이 프로젝트에서 Claude Code 작업을 기록할까요? 커밋되지 않는 로컬 설정에 훅을 추가합니다.', yes, '나중에');
  if (pick === yes) install(root);
  else if (pick) await context.workspaceState.update('mycena.installDeclined', true);
}

function install(root) {
  try {
    init(root);
    vscode.window.showInformationMessage('Mycena 훅을 설치했어요. Claude Code 세션을 새로 시작하면 기록됩니다.');
  } catch (e) { vscode.window.showErrorMessage(e.message); }
}

async function openPanel(context, root) {
  const existing = panels.get(root);
  if (existing) { existing.reveal(undefined, true); return; }
  const port = await ensureServer(root);
  const panel = vscode.window.createWebviewPanel('mycena', `Mycena — ${path.basename(root)}`,
    { viewColumn: vscode.ViewColumn.Beside, preserveFocus: true },
    { enableScripts: true, retainContextWhenHidden: true });
  panels.set(root, panel);
  panel.webview.html = viewerHtml('window.__EMBED__=true;');

  let version = null;
  const push = async () => {
    if (!panel.visible) return;
    try {
      const data = await fetchData(port);
      if (data.version === version) return;
      version = data.version;
      await panel.webview.postMessage({ type: 'data', data });
    } catch { /* 다음 주기에 다시 시도 */ }
  };
  const timer = setInterval(push, POLL_MS);
  panel.webview.onDidReceiveMessage(async (m) => {
    if (!m) return;
    if (m.type === 'ready') { version = null; push(); }
    else if (m.type === 'openBrowser') openInBrowser(root, m.ref).catch((e) => vscode.window.showErrorMessage(e.message));
    else if (m.type === 'openFile') {
      const abs = safeFilePath(root, m.path);
      if (abs) vscode.window.showTextDocument(vscode.Uri.file(abs), { viewColumn: vscode.ViewColumn.One, preview: true }).then(undefined, (e) => vscode.window.showErrorMessage(e.message));
    }
  }, undefined, context.subscriptions);
  panel.onDidDispose(() => { clearInterval(timer); panels.delete(root); }, undefined, context.subscriptions);
  offerInstall(context, root).catch((e) => vscode.window.showErrorMessage(e.message));
}

function withRoot(fn) {
  return () => {
    const root = currentRoot();
    if (!root) return vscode.window.showWarningMessage('Mycena를 쓰려면 프로젝트 폴더를 먼저 열어 주세요.');
    return Promise.resolve(fn(root)).catch((e) => vscode.window.showErrorMessage(e.message));
  };
}

function activate(context) {
  const item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 50);
  item.text = '$(sparkle) Mycena';
  item.tooltip = '별 그래프 미리보기 열기';
  item.command = 'mycena.open';
  item.show();
  context.subscriptions.push(item,
    vscode.commands.registerCommand('mycena.open', withRoot((root) => openPanel(context, root))),
    vscode.commands.registerCommand('mycena.openInBrowser', withRoot((root) => openInBrowser(root))),
    vscode.commands.registerCommand('mycena.install', withRoot((root) => install(root))));
}

function deactivate() {
  for (const { child } of servers.values()) child.kill();
  servers.clear();
}

module.exports = { activate, deactivate };
