'use strict';
// vscode 모듈 없이 검사할 수 있는 확장용 도우미. 웹뷰 메시지는 저장소의 노트 내용에서 비롯될 수 있어 믿지 않습니다.
const path = require('path');

// 프로젝트 안의 파일만 열어 줍니다 (노트에 ../../ 같은 경로가 있어도 밖으로 나가지 않게)
function safeFilePath(root, rel) {
  if (typeof rel !== 'string' || !rel) return null;
  const abs = path.resolve(root, rel);
  return abs.startsWith(path.resolve(root) + path.sep) ? abs : null;
}

function browserUrl(port, ref) {
  const known = ref && (ref.kind === 'node' || ref.kind === 'change') && typeof ref.id === 'string';
  const hash = known ? '#' + new URLSearchParams({ [ref.kind]: ref.id }) : '';
  return `http://localhost:${port}/${hash}`;
}

module.exports = { safeFilePath, browserUrl };
