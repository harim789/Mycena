'use strict';
// 도구 호출 하나를 "어떤 파일이 어떻게 바뀌었나" 기록 한 건으로 바꿉니다. 훅과 과거 기록 가져오기가 함께 씁니다.
const { clip, isSecretPath, trackablePath } = require('./util');

const FILE_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit']);

function slimPatch(patch) {
  if (!Array.isArray(patch)) return null;
  let budget = 400;
  const out = patch.map((h) => {
    const lines = (h.lines || []).slice(0, Math.max(0, budget));
    budget -= lines.length;
    return { oldStart: h.oldStart, newStart: h.newStart, lines: lines.map((l) => clip(l, 400)) };
  }).filter((h) => h.lines.length);
  return out.length ? out : null;
}

function makeFileEvent({ root, tool, input, response, session, ts, id, ctx, imported }) {
  const ti = input || {};
  const fp = ti.file_path || ti.notebook_path;
  if (!fp || !FILE_TOOLS.has(tool)) return null;
  const rel = trackablePath(root, fp);
  if (!rel) return null;
  const resp = response && typeof response === 'object' ? response : {};
  const kind = tool === 'Write' ? (resp.type === 'update' ? 'rewrite' : 'create') : 'edit';
  const ev = { id: id || null, ts, session: session || 'unknown', tool, kind, file: rel, edits: [], patch: null, said: (ctx && ctx.said) || '', request: (ctx && ctx.request) || '' };
  if (imported) ev.imported = true;
  if (isSecretPath(rel)) { ev.redacted = true; return ev; }
  ev.patch = slimPatch(resp.structuredPatch);
  if (!ev.patch) {
    let edits;
    if (tool === 'MultiEdit' && Array.isArray(ti.edits)) edits = ti.edits.map((e) => ({ old: e.old_string, new: e.new_string }));
    else if (tool === 'Write') edits = [{ old: null, new: ti.content }];
    else if (tool === 'NotebookEdit') edits = [{ old: null, new: ti.new_source }];
    else edits = [{ old: ti.old_string, new: ti.new_string }];
    ev.edits = edits.slice(0, 20).map((e) => ({ old: clip(e.old, 4000), new: clip(e.new, 4000) }));
  }
  return ev;
}

module.exports = { FILE_TOOLS, slimPatch, makeFileEvent };
