# ui-agent-locator

Storybook Story를 만들지 않고 **실제 개발 중인 React/Vite 화면에서 UI를 직접 선택한 뒤, 정확한 JSX/TSX 소스 위치와 작업 요청을 Codex CLI 또는 Claude Code로 보내는 개발 도구**입니다.

기존 Story AI Addon에서 기획했던 AI 전송, 멀티 선택, 작업 큐, 파일 Lock, Retry/Cancel/Delete, 캐시 초기화, CLI Adapter, Demo 옵션을 유지하면서 가장 큰 제약이었던 **“AI 작업을 보내려면 Story를 먼저 만들어야 한다”**는 전제를 제거하는 것이 목적입니다.

## 핵심 변화

기존:

```text
Component 작성
→ Story 작성
→ Storybook 실행
→ Story에서 선택/코멘트
→ AI CLI 전송
```

현재:

```text
실제 React/Vite 앱 실행
→ Alt + Click으로 UI 선택
→ JSX/TSX source 위치 확인
→ 작업 요청 입력
→ Local Bridge
→ Queue / File Lock
→ Codex CLI 또는 Claude Code
→ 파일 수정
→ Vite HMR로 즉시 확인
```

**Storybook은 필요하지 않습니다.**

---

## 포함 기능

- Story 생성/Storybook 의존성 제거
- Vite 개발 서버에 Inspector 자동 주입
- React private Fiber API에 의존하지 않는 AST 기반 source metadata injection
- React 19+를 고려한 구조
- Hover source locator
- `Alt + Click` 단일 선택
- `Shift + Alt + Click` 멀티 선택
- DOM → JSX/TSX 파일/라인/컬럼 추적
- component/tag/text/role/test-id/source ancestry context 수집
- 한 번의 Send = 하나의 AI Job
- 여러 선택 대상을 하나의 Context Bundle로 전송
- 복합 컴포넌트 ancestry context 지원
- Codex CLI / Claude Code 선택
- Local HTTP + WebSocket Bridge
- 작업 Queue
- 파일 단위 Lock
- Lock 충돌 작업 `blocked` 처리
- Retry / Cancel / Delete
- 자동 Retry 횟수 설정
- Context Cache reset API
- 동시 실행 수 설정
- 독립 Bridge CLI 실행
- Demo quick prompt 옵션
- Production build에서는 자동 비활성화 (`apply: serve`)

---

## Architecture

```text
┌─────────────────────────────────────────────┐
│ Live React / Vite Application              │
│                                             │
│ JSX/TSX                                    │
│   ↓ Vite transform                         │
│ AST Source Metadata Injection              │
│   ↓                                        │
│ Rendered DOM                               │
│ data-ui-agent-source="src/...:42:7"        │
└───────────────────┬─────────────────────────┘
                    │
              Alt + Click
        Shift + Alt + Click
                    │
                    ▼
┌─────────────────────────────────────────────┐
│ Browser Inspector                          │
│ - hover highlight                          │
│ - file / line / column                     │
│ - component / tag                          │
│ - text / role / test-id                    │
│ - source ancestry                          │
│ - multi selection                          │
│ - prompt composer                          │
└───────────────────┬─────────────────────────┘
                    │ POST /jobs
                    ▼
┌─────────────────────────────────────────────┐
│ Local AI Bridge                            │
│ - Job Queue                                │
│ - File Lock                                │
│ - Retry / Cancel / Delete                  │
│ - Context Cache                            │
│ - WebSocket Job Events                     │
└──────────────┬────────────────┬─────────────┘
               │                │
               ▼                ▼
         Codex Adapter     Claude Adapter
               │                │
         codex exec          claude -p
               └───────┬────────┘
                       ▼
                  Repository
                       │
                       ▼
                    Vite HMR
```

---

## Installation

```bash
npm install -D ui-agent-locator
```

Node.js 20+가 필요합니다. 사용할 AI CLI는 별도 설치/로그인되어 있어야 합니다.

```bash
codex --version
claude --version
```

---

## Vite 설정

`vite.config.ts`

```ts
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { uiAgentLocator } from "ui-agent-locator/vite";

export default defineConfig({
  plugins: [
    react(),
    uiAgentLocator({
      provider: "codex",
      demo: true
    })
  ]
});
```

이후 기존 앱처럼 실행합니다.

```bash
npm run dev
```

Vite 개발 서버와 함께 Local Bridge가 기본 `127.0.0.1:4317`에서 실행됩니다.

플러그인은 `apply: "serve"`이므로 production build에는 Inspector/source metadata가 포함되지 않습니다.

---

## UI 선택

### 단일 선택

```text
Alt + Click
```

기존 선택을 비우고 현재 요소를 선택합니다.

### 멀티 선택

```text
Shift + Alt + Click
```

기존 선택을 유지하면서 요소를 추가합니다.

예:

```text
Header.tsx:31
SearchBar.tsx:74
FilterButton.tsx:22
Table.tsx:118
```

요청:

```text
선택한 컴포넌트들의 spacing을 동일한 디자인 토큰으로 정리해줘.
```

이 경우 4개의 Job이 아니라:

```text
4 selections + 1 prompt = 1 Context Bundle = 1 Job
```

으로 처리합니다.

---

## Source Locator 방식

React 내부의 private Fiber field만 이용해 source를 찾지 않고 Vite transform 단계에서 JSX AST에 source metadata를 삽입합니다.

원본:

```tsx
export function UserCard() {
  return <section className="card">...</section>;
}
```

개발 서버 transform 결과 개념:

```tsx
export function UserCard() {
  return (
    <section
      data-ui-agent-source="src/components/UserCard.tsx:2:10"
      data-ui-agent-component="UserCard"
      data-ui-agent-tag="section"
      className="card"
    >
      ...
    </section>
  );
}
```

Custom Component 호출부에 무조건 attribute를 넣지 않고 **실제로 DOM이 되는 intrinsic JSX node에 source metadata를 삽입**합니다. Custom Component가 임의 props를 DOM까지 전달하지 않는 문제를 피하기 위한 선택입니다.

---

## AI Job Context

브라우저가 Bridge에 전달하는 구조:

```json
{
  "provider": "codex",
  "prompt": "모바일에서 레이아웃이 깨지는 문제를 수정해줘.",
  "selections": [
    {
      "source": {
        "file": "src/components/UserCard.tsx",
        "line": 83,
        "column": 12,
        "component": "UserCard",
        "tag": "section"
      },
      "text": "홍길동 프로필",
      "ancestry": []
    }
  ]
}
```

CLI에는 source 위치와 component context가 포함된 작업 Prompt로 변환됩니다.

```text
The user selected these live UI source locations:

1. src/components/UserCard.tsx:83:12
   component: UserCard
   tag: section

Task:
모바일에서 레이아웃이 깨지는 문제를 수정해줘.

Inspect related files as needed and make the requested changes.
```

---

## 복합 컴포넌트

복합 컴포넌트의 내부 DOM을 선택하면 선택 위치만 보내는 것이 아니라 상위 DOM에 존재하는 source metadata를 따라 ancestry context도 함께 수집합니다.

```text
App
> UserPage
> UserProfileCard
> AvatarArea
> img (selected)
```

AI는 선택 source에서 시작해서 관련 부모/자식 파일을 추가 탐색할 수 있습니다.

---

## Queue 정책

기존 Story AI Addon 기획을 유지합니다.

### 1 Send = 1 Job

여러 Selection/코멘트 성격의 Context가 있어도 사용자가 한 번 Send한 요청은 하나의 작업 단위입니다.

### 상태

```text
queued
blocked
running
succeeded
failed
cancelled
```

### 동시 실행

기본값:

```text
concurrency = 1
```

파일이 겹치지 않는 Job을 병렬 처리하려면:

```ts
uiAgentLocator({
  concurrency: 3
});
```

---

## File Lock

Lock 기준은 기본적으로:

```text
repository(cwd) + filepath
```

입니다.

예:

```text
Job #31
src/components/UserCard.tsx
RUNNING
```

중 같은 파일을 대상으로 Job #32가 들어오면:

```text
Job #32
BLOCKED
```

가 되고 Job #31 종료 후 자동 재평가됩니다.

이 구조는 기존 Addon에서 기획했던 **백그라운드에서 Lock이 걸린 Job이 실행되려 할 때 충돌을 감지하고 대기/재시도하는 기능**의 기반입니다.

---

## Retry / Cancel / Delete

### Retry

```http
POST /jobs/:id/retry
```

### Cancel

```http
POST /jobs/:id/cancel
```

실행 중 CLI process에 `SIGTERM`을 보내고 queued/blocked Job이면 대기열에서 제거합니다.

### Delete

```http
DELETE /jobs/:id
```

실행 중인 Job은 삭제하지 않습니다.

### 자동 Retry

```ts
uiAgentLocator({
  maxRetries: 2
});
```

---

## Cache reset

기존 Addon 기획에 있던 캐시 초기화 인터페이스도 유지합니다.

```http
POST /cache/reset
```

현재는 확장 포인트이며 이후 다음 캐싱에 사용할 수 있습니다.

- file summary
- component dependency graph
- previous inspection result
- source map
- repository index
- prompt context

---

## CLI Adapters

현재 기본 Provider:

```text
Codex
Claude Code
```

기본 실행:

```bash
codex exec "<prompt>"
```

```bash
claude -p "<prompt>"
```

Adapter 계층을 분리했기 때문에 이후 아래를 추가할 수 있습니다.

```text
Gemini CLI
Aider
OpenCode
MCP Agent
사내 Agent CLI
```

---

## Separate Bridge mode

Vite process와 Bridge를 분리하려면:

```ts
uiAgentLocator({
  startBridge: false,
  bridgeUrl: "http://127.0.0.1:4317"
});
```

별도 실행:

```bash
npx ui-agent-locator --cwd ./my-project
```

옵션:

```bash
ui-agent-locator \
  --host 127.0.0.1 \
  --port 4317 \
  --cwd . \
  --concurrency 2 \
  --retries 1
```

---

## Demo 옵션

기존 기획에서 정의한 Demo는 별도 제품 로직이 아니라 **기능 확인용 샘플링 UI**입니다.

```ts
uiAgentLocator({
  demo: true
});
```

Inspector에 quick prompt가 추가됩니다.

```text
Fix layout
Refactor
```

---

## Bridge API

```http
GET    /health
GET    /jobs
POST   /jobs
GET    /jobs/:id
POST   /jobs/:id/retry
POST   /jobs/:id/cancel
DELETE /jobs/:id
POST   /cache/reset
```

실시간 Job event:

```text
ws://127.0.0.1:4317/events
```

---

## Security

Bridge 기본 host는 반드시 로컬인:

```text
127.0.0.1
```

을 사용합니다.

AI CLI가 실제 repository 파일을 수정할 수 있으므로 Bridge를 외부 네트워크에 공개하는 것을 권장하지 않습니다.

---

## 현재 구현 범위

### Phase 1

- [x] Storybook dependency 제거
- [x] 일반 React/Vite 개발 화면 대상
- [x] Vite dev plugin
- [x] AST source metadata injection
- [x] hover locator
- [x] single selection
- [x] multi selection
- [x] component/source context
- [x] ancestry context
- [x] prompt composer
- [x] Codex adapter
- [x] Claude Code adapter
- [x] Queue
- [x] File Lock
- [x] blocked job
- [x] Retry
- [x] Cancel
- [x] Delete
- [x] automatic Retry
- [x] Context Cache reset endpoint
- [x] WebSocket job events
- [x] Demo option

### Phase 2

- [ ] Inspector 내부 Queue drawer
- [ ] Lock 충돌 경고 UI
- [ ] `Queue anyway / Retry later / Cancel` UX
- [ ] CLI stdout/stderr 실시간 streaming
- [ ] AI 변경 Diff preview
- [ ] Apply / Reject workflow
- [ ] Undo last AI job
- [ ] 선택 영역 Screenshot context
- [ ] Console error context
- [ ] Network error context
- [ ] 브라우저에서 Job별 로그 확인
- [ ] React component tree 보조 추적
- [ ] sourcemap fallback locator

### Phase 3

- [ ] Chrome extension mode
- [ ] VS Code extension
- [ ] JetBrains plugin
- [ ] Vue
- [ ] Svelte
- [ ] Next.js
- [ ] Remix
- [ ] MCP transport
- [ ] Git worktree per Job
- [ ] Git branch per Job
- [ ] Agent orchestration

---

## 기존 Story AI Addon과의 관계

기존 제품 개념:

```text
Story AI Review
Story / Comment → AI
```

현재 제품:

```text
UI Agent Locator
Live Application UI
→ Source Locator
→ Context Bundle
→ Queue / Lock
→ AI Coding CLI
```

즉 기존 기획을 버린 것이 아니라 **Storybook에 묶여 있던 AI 작업 오케스트레이션 레이어를 일반 개발 화면으로 확장한 버전**입니다.

## Product definition

`ui-agent-locator`는 Storybook addon이 아닙니다.

```text
UI inspection
+ source locator
+ AI task composer
+ local agent bridge
+ job orchestration
```

을 묶은 **Live Application → Coding Agent Bridge**입니다.

> 화면에서 문제를 발견한 개발자가 Story를 만들거나 대상 파일을 직접 찾지 않고, 문제 UI를 클릭해서 바로 AI coding agent에게 작업을 넘긴다.
