#!/usr/bin/env node
'use strict';
const path = require('path');

const HELP = `Mycena — Claude Code가 무엇을, 왜, 어떻게 바꿨는지 빛나는 관계 그래프로 보여줍니다

  mycena init [--global]       현재 프로젝트(또는 전역)에 Claude Code 훅 설치
  mycena uninstall [--global]  훅 제거 (기록은 남겨 둠)
  mycena import                훅 설치 전의 Claude 작업을 대화 기록에서 가져오기
  mycena serve [port]          실시간 그래프 뷰어 실행 (기본 4321)
  mycena build [root] [out]    .mycena/graph.html 정적 파일 생성`;

const [cmd, ...args] = process.argv.slice(2);
const isHook = cmd && cmd.startsWith('hook-');
const cwd = () => path.resolve(process.env.MYCENA_ROOT || process.cwd());

try {
  if (cmd === 'hook-pre') require('../src/hooks').hookPre();
  else if (cmd === 'hook-post') require('../src/hooks').hookPost();
  else if (cmd === 'hook-stop') process.stdout.write(require('../src/hooks').hookStop());
  else if (cmd === 'init') {
    const { settings } = require('../src/install').init(cwd(), { global: args.includes('--global') });
    console.log(`✅ 설치 완료\n   훅: ${settings}\n   슬래시 명령: /mycena-describe (기존 코드 전체 설명 생성)\n\n실행 중인 Claude Code 세션은 새로 시작해 주세요. 그다음: mycena serve`);
  } else if (cmd === 'uninstall') {
    const { settings, changed } = require('../src/install').uninstall(cwd(), { global: args.includes('--global') });
    console.log(changed ? `✅ 훅을 제거했어요: ${settings}` : '설치된 훅이 없어요.');
  } else if (cmd === 'import') {
    const r = require('../src/transcript').importHistory(cwd());
    console.log(`✅ 대화 기록 ${r.transcripts}개에서 수정 ${r.added}건을 새로 가져왔어요.\n   위치: ${r.dir}`);
  } else if (cmd === 'build') {
    const { out, data } = require('../src/output').writeStatic(path.resolve(args[0] || cwd()), args[1]);
    console.log(`✅ ${out}\n   파일 ${data.nodes.filter((n) => n.kind === 'file').length}개 · 연결 ${data.edges.length}개 · Claude 작업 ${data.changes.length}개`);
  } else if (cmd === 'serve') require('../src/output').serve(cwd(), args[0] === undefined ? 4321 : Number(args[0]));
  else console.log(HELP);
} catch (e) {
  // 훅이 실패해도 Claude Code 작업은 절대 막지 않음
  process.stderr.write(`[mycena] ${isHook ? (e && e.stack) || e : e.message}\n`);
  process.exit(isHook ? 0 : 1);
}
