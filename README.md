# Mycena

Claude Code가 **무엇을, 왜, 어떻게** 바꿨는지 빛나는 관계 그래프로 보여주는 도구입니다.

어둠 속에서 빛나는 버섯 Mycena(콩나물버섯속)처럼, 프로젝트라는 균사망에서 Claude가 방금 건드린 곳에만 불이 들어옵니다.

- 프로젝트의 파일은 **점**, 파일끼리의 import·참조는 **선**으로 그립니다.
- Claude가 **방금 작업한 파일은 초록 불빛**으로 숨 쉬듯 빛나고, 작업한 파일 사이로 빛 입자가 흐릅니다.
- **이전 작업**은 오래될수록 희미한 불빛으로 남습니다.
- **점을 클릭하면** 이 파일이 무슨 일을 하는지, Claude가 언제·왜·무엇을 바꿨는지, 실제 코드 diff와 git 기록을 보여줍니다.
- **선을 클릭하면** 두 파일이 어떤 관계인지, 무엇이 바뀌면 어디에 영향이 가는지 설명합니다.
- 왼쪽 **작업 기록**에서 과거 작업을 고르면 그 작업에서 건드린 파일들에 불이 들어옵니다.

Node.js 18 이상만 있으면 되고, 설치할 외부 패키지는 없습니다.

## 시작하기

```bash
git clone https://github.com/harim789/Mycena.git ~/tools/Mycena
cd ~/tools/Mycena && npm link        # mycena 명령 등록

cd ~/my-project
mycena init                          # 이 프로젝트에 Claude Code 훅 설치
mycena import                        # 훅 설치 전의 Claude 작업도 가져오기 (선택)
mycena serve                         # http://localhost:4321
```

이미 실행 중인 Claude Code 세션은 훅 설정을 다시 읽도록 새로 시작해 주세요. 모든 프로젝트에 한 번에 적용하려면 `mycena init --global`을 쓰면 됩니다.

서버를 켜지 않아도 Claude가 응답을 마칠 때마다 `.mycena/graph.html`이 갱신되니, 그 파일만 열어도 됩니다.

### 기존 코드 전체에 설명 붙이기

Claude Code에서 한 번 실행하세요.

```
/mycena-describe
```

Claude가 파일마다 `한 줄 요약 / 쉬운 설명 / 관련 개념 / 사용하는 파일과 이유`를 `.mycena/descriptions.json`에 씁니다. 이 설명이 없어도 파일 맨 앞의 주석, 역할 자동 분류, API 주소, 주요 함수 목록, git 기록은 표시됩니다.

## 어떻게 동작하나요?

| 구성 | 하는 일 |
|---|---|
| **PostToolUse 훅** | Claude가 파일을 고칠 때마다 diff, 사용자 요청, Claude의 말을 `.mycena/events.jsonl`에 기록 |
| **PreToolUse 훅** (Bash) | 셸 명령 전후의 git 작업 트리를 비교해 `sed`, `mv` 등으로 바뀐 파일도 찾아냄 |
| **Stop 훅** | 설명 없는 수정이 있으면 응답을 한 번 붙잡고 `제목 / 의도 / 이전→이후 / 파일별 무엇·왜 / 파일 간 관계 / 개념`을 쉬운 한국어 노트로 남기게 한 뒤 그래프를 다시 만듦 |
| **분석기** | Java·Kotlin(Spring, 같은 패키지 참조, MyBatis XML), JS/TS, Python, HTML/CSS, Markdown 링크를 읽어 연결선을 만들고 역할을 분류 |
| **뷰어** | 위 데이터를 force-directed 그래프로 그리는 HTML 한 장 (외부 요청 없음) |

## 조작법

| 동작 | 결과 |
|---|---|
| 점 위에 마우스 | 그 파일과 연결된 파일만 밝게 |
| 점 클릭 | 파일 설명 · Claude 작업 기록 · 코드 diff · git 기록 · 영향 범위 |
| 선 클릭 | 두 파일의 관계 설명 · 함께 바꾼 작업과 커밋 |
| 작업 기록 클릭 | 그 작업의 파일들에 불이 들어오고 화면이 이동 |
| 드래그 / 휠 | 이동 / 확대 |
| `F` / `Esc` | 전체 보기 / 패널 닫기 |
| 검색창 | 파일·개념 이름으로 찾기, Enter로 이동 |

## 저장되는 파일

```
.mycena/
├── events.jsonl        # 자동 기록 원본 (코드 조각 포함, 자동으로 gitignore)
├── graph.html          # 정적 뷰어 (자동으로 gitignore)
├── notes/*.json        # Claude가 남긴 작업 설명 (팀과 공유하려면 커밋)
└── descriptions.json   # /mycena-describe 결과 (팀과 공유하려면 커밋)
```

## 설치가 바꾸는 것

`mycena init`은 커밋되지 않는 `.claude/settings.local.json`에 훅과 `.mycena` 폴더 쓰기 권한(`Edit(./.mycena/**)`)을 추가하고, `.claude/commands/mycena-describe.md`를 복사합니다. 훅 명령에 이 저장소의 절대경로가 들어가므로, 저장소를 옮겼다면 `mycena init`을 다시 실행해 주세요. `mycena uninstall`로 되돌릴 수 있고, 기록은 남습니다.

## 설정

- 노트 요청을 끄고 자동 기록만 쓰기: 환경변수 `MYCENA_NO_NOTE=1`
- 훅은 실패해도 Claude Code 작업을 막지 않습니다. Stop 훅은 한 응답에서 최대 한 번만 노트를 요청합니다.
- `.env`, 인증서·키 파일은 수정 사실만 기록하고 코드 내용은 남기지 않습니다.
- 뷰어 서버는 `127.0.0.1`에서만 열립니다.

## 한계

- 연결선은 정적 분석이라 DI 컨테이너·리플렉션·동적 import는 놓칠 수 있습니다. Claude 노트의 `relations`가 점선으로 보완합니다.
- 셸 명령 추적은 git 저장소에서만 동작합니다. 같은 명령 안에서 커밋까지 하면 기록되지 않습니다.
- 셸로 수정한 파일의 diff는 그 명령만의 변경이 아니라 마지막 커밋과의 차이입니다.
- `mycena import`는 `~/.claude/projects`에 남아 있는 대화 기록만 읽으며, Edit·Write 계열 수정만 가져옵니다.
- 파일이 1,500개를 넘는 저장소는 앞쪽 1,500개만 분석합니다.

## 개발

```bash
npm test
```
