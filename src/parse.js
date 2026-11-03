'use strict';
// 소스 파일에서 import·선언·API 주소를 정규식으로 뽑고, 파일의 역할을 분류합니다.

const JS_EXT = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.vue', '.svelte'];
function allMatches(re, s, fn) { re.lastIndex = 0; let m; while ((m = re.exec(s))) fn(m); }

function parseFile(f) {
  const p = { imports: [], decls: [], endpoints: [], annotations: [], pkg: null };
  const t = f.text;
  if (!t) return p;
  const ext = f.ext;
  if (JS_EXT.includes(ext)) {
    allMatches(/import\s+(?:type\s+)?([\w$*{}\s,]+?)\s+from\s+['"]([^'"]+)['"]|import\s+['"]([^'"]+)['"]|export\s+(?:\*|\{[^}]*\})\s+from\s+['"]([^'"]+)['"]|require\(\s*['"]([^'"]+)['"]\s*\)|import\(\s*['"]([^'"]+)['"]\s*\)/g, t, (m) => {
      const spec = m[2] || m[3] || m[4] || m[5] || m[6];
      const syms = (m[1] || '').replace(/[{}]/g, ',').split(',').map((s) => s.trim().replace(/^\*\s+as\s+/, '').split(/\s+as\s+/)[0]).filter((s) => s && s !== 'type');
      p.imports.push({ spec, symbols: syms });
    });
    allMatches(/export\s+(?:default\s+)?(?:async\s+)?(?:function\*?|class|const|let|var|interface|type|enum)\s+([A-Za-z_$][\w$]*)/g, t, (m) => p.decls.push(m[1]));
    allMatches(/\b(?:app|router|server)\.(get|post|put|delete|patch)\(\s*['"`]([^'"`]+)/g, t, (m) => p.endpoints.push(`${m[1].toUpperCase()} ${m[2]}`));
  } else if (ext === '.py') {
    allMatches(/^\s*from\s+(\.*[\w.]*)\s+import\s+\(?([^\n#)]+)/gm, t, (m) => p.imports.push({ spec: m[1], symbols: m[2].split(',').map((s) => s.trim().split(/\s+as\s+/)[0]).filter(Boolean), py: true, from: true }));
    allMatches(/^\s*import\s+([\w.]+(?:\s*,\s*[\w.]+)*)/gm, t, (m) => m[1].split(',').forEach((s) => p.imports.push({ spec: s.trim(), symbols: [], py: true })));
    allMatches(/^(?:async\s+)?def\s+(\w+)|^class\s+(\w+)/gm, t, (m) => p.decls.push(m[1] || m[2]));
    allMatches(/@\w+\.(get|post|put|delete|patch|route)\(\s*['"]([^'"]+)/g, t, (m) => p.endpoints.push(`${m[1] === 'route' ? 'ANY' : m[1].toUpperCase()} ${m[2]}`));
  } else if (ext === '.java' || ext === '.kt') {
    const pm = /^\s*package\s+([\w.]+)/m.exec(t); if (pm) p.pkg = pm[1];
    allMatches(/^\s*import\s+(?:static\s+)?([\w.]+(?:\.\*)?)\s*;?/gm, t, (m) => p.imports.push({ spec: m[1], symbols: [m[1].split('.').pop()], jvm: true }));
    allMatches(/@(RestController|Controller|Service|Repository|Component|Entity|Configuration|SpringBootApplication|Mapper|ControllerAdvice|RestControllerAdvice|Table|Embeddable|EnableWebSecurity|SpringBootTest|Test)\b/g, t, (m) => { if (!p.annotations.includes(m[1])) p.annotations.push(m[1]); });
    const typeRe = /\b(class|interface|enum|record|object)\s+(\w+)/g;
    typeRe.lastIndex = 0; const firstType = typeRe.exec(t); const classIdx = firstType ? firstType.index : 0;
    let prefix = '';
    allMatches(/@(Get|Post|Put|Delete|Patch|Request)Mapping\s*(?:\(\s*(?:(?:value|path)\s*=\s*)?\{?\s*"([^"]*)")?/g, t, (m) => {
      if (m.index < classIdx) { if (m[1] === 'Request') prefix = m[2] || ''; return; }
      p.endpoints.push(`${m[1] === 'Request' ? 'ANY' : m[1].toUpperCase()} ${(prefix + (m[2] || '')) || '/'}`);
    });
    const cls = f.name.replace(/\.(java|kt)$/, '');
    allMatches(ext === '.kt' ? /\bfun\s+(\w+)/g : /(?:public|protected)\s+(?:static\s+)?(?:final\s+)?[\w<>\[\],.?\s]{1,80}?\s+(\w+)\s*\(/g, t, (m) => {
      if (m[1] !== cls && !p.decls.includes(m[1]) && !['if', 'for', 'while', 'switch', 'catch', 'return', 'new'].includes(m[1])) p.decls.push(m[1]);
    });
  } else if (ext === '.xml') {
    const ns = /namespace\s*=\s*"([\w.]+)"/.exec(t); if (ns) p.imports.push({ spec: ns[1], symbols: [ns[1].split('.').pop()], jvm: true });
  } else if (ext === '.md') {
    allMatches(/\]\((\.{0,2}\/?[^)\s#:]+\.\w+)\)/g, t, (m) => p.imports.push({ spec: m[1].startsWith('.') ? m[1] : './' + m[1], symbols: [], rel: true }));
    allMatches(/\[\[([^\]|#]+)/g, t, (m) => p.imports.push({ spec: m[1].trim(), symbols: [], wiki: true }));
  } else if (ext === '.html') {
    allMatches(/(?:src|href)\s*=\s*["'](\.{0,2}\/?[^"':#?]+\.(?:js|css|ts|html))["']/g, t, (m) => p.imports.push({ spec: m[1].startsWith('.') || m[1].startsWith('/') ? m[1] : './' + m[1], symbols: [], rel: true }));
  } else if (ext === '.css' || ext === '.scss') {
    allMatches(/@(?:import|use)\s+['"]([^'"]+)['"]/g, t, (m) => p.imports.push({ spec: m[1].startsWith('.') ? m[1] : './' + m[1], symbols: [], rel: true }));
  }
  p.decls = p.decls.slice(0, 30);
  p.endpoints = p.endpoints.slice(0, 30);
  return p;
}

const ROLES = {
  controller: ['API 컨트롤러', '브라우저나 앱에서 들어온 요청을 가장 먼저 받아, 알맞은 서비스로 넘겨주는 "접수 창구"예요.'],
  service: ['서비스 (비즈니스 로직)', '실제 규칙과 처리를 담당하는 "주방"이에요. 접수 창구(컨트롤러)가 받은 주문을 여기서 요리해요.'],
  repository: ['저장소 (DB 접근)', '데이터베이스에 데이터를 넣고 꺼내는 "창고 관리인"이에요.'],
  entity: ['엔티티 (DB 테이블 모델)', 'DB 테이블의 한 줄을 코드 객체로 옮겨 놓은 "설계도"예요.'],
  config: ['설정 클래스', '앱이 켜질 때 어떻게 동작할지 정해두는 "환경 설정판"이에요.'],
  app: ['애플리케이션 시작점', '앱 전체를 켜는 "전원 스위치"예요.'],
  advice: ['전역 예외 처리', '어디서 에러가 나든 한곳에서 받아 깔끔한 응답으로 바꿔주는 "고객센터"예요.'],
  dto: ['DTO (데이터 전달 객체)', '계층 사이에서 필요한 데이터만 담아 나르는 "택배 상자"예요.'],
  exception: ['예외 클래스', '"이런 문제가 생겼어요"를 이름 붙여 표현하는 "경고 표지판"이에요.'],
  test: ['테스트', '코드가 의도대로 동작하는지 자동으로 확인하는 "검수 담당자"예요.'],
  util: ['유틸리티', '여러 곳에서 꺼내 쓰는 "공구함"이에요.'],
  security: ['보안 / 인증', '누가 들어올 수 있는지 확인하는 "출입 관리 게이트"예요.'],
  component: ['UI 컴포넌트', '화면의 한 조각(버튼, 카드 등)을 그리는 "레고 블록"이에요.'],
  page: ['페이지', '사용자가 보는 한 화면 전체예요. 여러 컴포넌트(레고 블록)를 조립해 만들어요.'],
  hook: ['React 훅', '여러 화면에서 재사용하는 동작(데이터 불러오기 등)을 담은 "리모컨 버튼"이에요.'],
  api: ['API 호출', '서버와 대화하는 "전화기" 역할이에요.'],
  store: ['상태 관리', '앱 전체가 함께 보는 데이터를 보관하는 "공용 게시판"이에요.'],
  route: ['API 라우트', '어떤 주소로 요청이 오면 무엇을 할지 정하는 "안내 데스크"예요.'],
  appconfig: ['앱 설정 파일', 'DB 주소, 포트 같은 실행 환경 값을 적어둔 "설정 메모"예요.'],
  build: ['빌드·의존성 설정', '어떤 라이브러리를 쓰고 어떻게 빌드할지 적은 "장보기 목록 + 조립 설명서"예요.'],
  sql: ['SQL 스크립트', 'DB에 직접 내리는 명령을 적은 파일이에요.'],
  doc: ['문서', '사람이 읽기 위한 설명 문서예요.'],
  docker: ['도커 설정', '앱을 담아 어디서든 똑같이 실행하게 해주는 "컨테이너 상자" 레시피예요.'],
  model: ['데이터 모델', '데이터의 생김새(필드 구성)를 정의한 "양식지"예요.'],
  style: ['스타일', '화면의 색, 크기, 배치를 정하는 "인테리어 설계"예요.'],
  code: ['코드 파일', ''],
};
function detectRole(f, p) {
  const a = p.annotations, n = f.name, lp = f.rel.toLowerCase();
  const pick = (k) => ({ key: k, label: ROLES[k][0], explain: ROLES[k][1] });
  if (a.includes('SpringBootApplication')) return pick('app');
  if (a.includes('ControllerAdvice') || a.includes('RestControllerAdvice')) return pick('advice');
  if (a.includes('Test') || a.includes('SpringBootTest') || /(^|\/)(tests?|__tests__)\//.test(lp) || /\.(test|spec)\.\w+$|Tests?\.(java|kt)$|^test_.*\.py$/.test(n)) return pick('test');
  if (a.includes('RestController') || a.includes('Controller')) return pick('controller');
  if (a.includes('Service')) return pick('service');
  if (a.includes('Repository') || a.includes('Mapper')) return pick('repository');
  if (a.includes('Entity') || a.includes('Table') || a.includes('Embeddable')) return pick('entity');
  if (a.includes('EnableWebSecurity') || /(security|auth|jwt)/i.test(n)) return pick('security');
  if (a.includes('Configuration')) return pick('config');
  if (/(Dto|Request|Response)\.(java|kt|ts)$/.test(n) || /\/dto\//.test(lp)) return pick('dto');
  if (/Exception\.(java|kt)$/.test(n)) return pick('exception');
  if (/^application.*\.(ya?ml|properties)$/.test(n) || n === '.env') return pick('appconfig');
  if (/^(build\.gradle(\.kts)?|settings\.gradle(\.kts)?|pom\.xml|package\.json|requirements\.txt|pyproject\.toml)$/.test(n)) return pick('build');
  if (n === 'Dockerfile' || n.startsWith('docker-compose')) return pick('docker');
  if (f.ext === '.sql') return pick('sql');
  if (f.ext === '.md') return pick('doc');
  if (f.ext === '.css' || f.ext === '.scss') return pick('style');
  if (p.endpoints.length) return pick('route');
  if (/\/hooks?\//.test(lp) || /^use[A-Z]/.test(n)) return pick('hook');
  if (/\/(pages|views|screens)\//.test(lp) || /\/app\/.*page\.(t|j)sx$/.test(lp)) return pick('page');
  if (/\/components?\//.test(lp) || (/\.(jsx|tsx|vue|svelte)$/.test(n))) return pick('component');
  if (/\/(store|stores|redux|slices?)\//.test(lp)) return pick('store');
  if (/\/(api|services?|client)\//.test(lp)) return pick(/\.(java|kt|py)$/.test(n) ? 'service' : 'api');
  if (/\/(models?|schemas?|domain)\//.test(lp)) return pick('model');
  if (/\/(utils?|helpers?|lib|common)\//.test(lp)) return pick('util');
  if (/controller/i.test(n)) return pick('controller');
  if (/service/i.test(n)) return pick('service');
  if (/repository|dao/i.test(n)) return pick('repository');
  return pick('code');
}

// 파일 맨 앞의 설명 주석·독스트링·문단을 찾아, 맞춤 설명이 없을 때의 요약으로 씁니다.
const NOT_DOC = /^(copyright|license|licensed|eslint|prettier|@ts-|@flow|spdx|generated|auto-generated|todo)/i;
function cleanDoc(s) {
  const line = String(s || '').split('\n').map((l) => l.replace(/^\s*(?:\/\*+|\*+\/?|\/\/+|#+|<!--)\s?/, '').replace(/\s*(?:\*\/|-->)\s*$/, '').trim())
    .filter((l) => l && !l.startsWith('@')).slice(0, 3).join(' ').trim();
  if (!line || NOT_DOC.test(line)) return '';
  return line.length > 240 ? line.slice(0, 239) + '…' : line;
}
function leadingDoc(f) {
  const t = f.text;
  if (!t) return '';
  const head = t.slice(0, 4000).replace(/^#!.*\n/, '').replace(/^\s*(['"])use strict\1;?\s*/, '');
  if (f.ext === '.md') {
    const para = head.split(/\n\s*\n/).map((b) => b.trim()).find((b) => b && !/^(#|\||```|!\[|<|---|-\s|\*\s)/.test(b));
    return para ? cleanDoc(para.replace(/[*_`]/g, '')) : '';
  }
  if (f.ext === '.html') { const m = /<title>([^<]+)<\/title>/i.exec(head); return m ? m[1].trim() : ''; }
  if (f.ext === '.py') {
    const m = /^\s*(?:"""([\s\S]*?)"""|'''([\s\S]*?)''')/.exec(head);
    if (m) return cleanDoc(m[1] || m[2]);
  }
  const block = /^\s*(\/\*[\s\S]*?\*\/)/.exec(head);
  if (block) return cleanDoc(block[1]);
  const lines = /^\s*((?:(?:\/\/|#)[^\n]*\n)+)/.exec(head);
  return lines ? cleanDoc(lines[1]) : '';
}

module.exports = { JS_EXT, parseFile, detectRole, leadingDoc };
