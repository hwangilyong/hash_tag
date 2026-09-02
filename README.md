# ui-agent-locator

Storybook Story를 만들지 않고 **실제 React/Vite 개발 화면에서 UI를 직접 선택해 정확한 JSX/TSX 소스 위치와 작업 요청을 Codex CLI 또는 Claude Code로 보내는 도구**입니다.

기존 Story AI Addon에서 기획했던 선택/코멘트 기반 AI 전송, 멀티 선택, Queue, File Lock, Retry/Cancel/Delete, 캐시 초기화, CLI Adapter, Demo 옵션을 유지하면서 가장 큰 제약이었던 **“Story를 먼저 만들어야 한다”**는 전제를 제거합니다.

## 목표

```text
기존
Component → Story 작성 → Storybook → 선택/코멘트 → AI

현재
실제 앱 → UI 선택 → Source Locator → Context Bundle
       → Queue / Lock → Codex 또는 Claude Code → Vite HMR
```

Storybook은 필요하지 않습니다.

## 현재 구현된 기능

- [x] Storybook/Story 생성 의존성 제거
- [x] React/Vite 개발 화면에 Inspector 자동 주입
- [x] AST 기반 JSX/TSX Source Metadata Injection
- [x] React private Fiber API 비의존 기본 Locator
- [x] `Alt + Click` 단일 선택
- [x] `Shift + Alt + Click` 멀티 선택
- [x] file / line / column / component / tag 추적
- [x] text / role / test-id / source ancestry Context 수집
- [x] 복합 컴포넌트 Context 지원
- [x] 한 번의 Send = 하나의 AI Job
- [x] 여러 선택 대상을 하나의 Context Bundle로 전송
- [x] Codex CLI Adapter
- [x] Claude Code Adapter
- [x] Local HTTP Bridge
- [x] WebSocket Job Event
- [x] 작업 Queue
- [x] 파일 단위 Lock
- [x] Lock 충돌 Job `blocked` 처리
- [x] Inspector 내부 Job Queue UI
- [x] Lock 충돌 경고 표시
- [x] blocked Job 자동 재평가/실행
- [x] Retry / Cancel / Delete UI 및 API
- [x] 자동 Retry 설정
- [x] Context Cache reset API
- [x] 동시 실행 수 설정
- [x] 독립 Bridge CLI 실행
- [x] Demo quick prompt 옵션
- [x] production build 자동 비활성화 (`apply: serve`)
- [x] GitHub Actions TypeScript build 검증

## Architecture

```text
┌─────────────────────────────────────────────┐
│ Live React / Vite Application              │
│                                             │
│ JSX/TSX → Vite AST Transform               │
│          ↓                                  │
│ data-ui-agent-source="src/...:42:7"        │
└───────────────────┬─────────────────────────┘
                    │ Alt + Click
                    │ Shift + Alt + Click
                    ▼
┌─────────────────────────────────────────────┐
│ Browser Inspector                          │
│                                             │
│ Source / Component / Text / Ancestry       │
│ Multi Selection / Prompt Composer           │
│ Job Queue / Retry / Cancel / Delete         │
│ Lock Conflict Warning                       │
└───────────────────┬─────────────────────────┘
                    │ POST /jobs
                    ▼
┌─────────────────────────────────────────────┐
│ Local AI Bridge                            │
│ Queue / File Lock / Retry / Cache / Events │
└──────────────┬────────────────┬─────────────┘
               ▼                ▼
          codex exec        claude -p
               └───────┬────────┘
                       ▼
                  Repository
                       ▼
                    Vite HMR
```

## Installation

```bash
npm install -D ui-agent-locator
```

Node.js 20+가 필요하며 사용할 AI CLI가 설치/로그인되어 있어야 합니다.

```bash
codex --version
claude --version
```

## Vite 설정

```ts
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { uiAgentLocator } from "ui-agent-locator/vite";

export default defineConfig({
  plugins: [
    react(),
    uiAgentLocator({
      provider: "codex",
      demo: true,
      concurrency: 1,
      maxRetries: 1
    })
  ]
});
```

`npm run dev` 실행 시 기본적으로 Local Bridge가 `127.0.0.1:4317`에서 함께 실행됩니다.

## Selection

단일 선택:

```text
Alt + Click
```

멀티 선택:

```text
Shift + Alt + Click
```

예를 들어 네 개의 UI를 선택하고 한 번 전송하면:

```text
4 selections + 1 prompt = 1 Context Bundle = 1 Job
```

입니다. 즉 기존 Story AI Addon에서 여러 코멘트를 일괄 전송하는 기획과 동일하게 **사용자의 한 번의 Send가 Queue 작업 단위**입니다.

## Source Locator 방식

원본:

```tsx
export function UserCard() {
  return <section className="card">...</section>;
}
```

개발 모드에서는 실제 DOM이 되는 intrinsic JSX node에 다음과 같은 metadata가 삽입됩니다.

```tsx
<section
  data-ui-agent-source="src/components/UserCard.tsx:2:10"
  data-ui-agent-component="UserCard"
  data-ui-agent-tag="section"
/>
```

Custom Component가 임의 props를 DOM으로 전달하지 않는 문제를 피하기 위해 실제 DOM JSX를 기본 Locator anchor로 사용합니다.

## Composite Component Context

선택한 요소뿐 아니라 상위 source ancestry도 함께 수집합니다.

```text
App
> UserPage
> UserProfileCard
> AvatarArea
> img (selected)
```

따라서 AI는 선택 source에서 시작해 연관 부모/자식 컴포넌트를 탐색할 수 있습니다.

## Job Queue / File Lock

Job 상태:

```text
queued
blocked
running
succeeded
failed
cancelled
```

기본 Lock 기준은 Bridge 하나가 하나의 repository/cwd를 담당한다는 전제에서 `filepath`입니다.

```text
Job #31 → src/components/UserCard.tsx → RUNNING
Job #32 → src/components/UserCard.tsx → BLOCKED
```

Job #31이 끝나면 #32는 자동으로 재평가되어 실행됩니다. Inspector Queue에서 blocked 상태와 충돌 경고를 확인하고 Cancel/Delete할 수 있습니다.

파일이 겹치지 않는 작업은 다음처럼 병렬 실행할 수 있습니다.

```ts
uiAgentLocator({ concurrency: 3 });
```

## Retry / Cancel / Delete

```http
POST   /jobs/:id/retry
POST   /jobs/:id/cancel
DELETE /jobs/:id
```

Inspector Queue UI에서도 동일한 작업을 수행할 수 있습니다.

자동 Retry:

```ts
uiAgentLocator({ maxRetries: 2 });
```

Cancel은 실행 중 CLI process에 `SIGTERM`을 전송합니다. 실행 중 Job은 직접 Delete하지 않습니다.

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

실시간 Job Event:

```text
ws://127.0.0.1:4317/events
```

## CLI Adapter

기본 Provider:

```text
Codex       → codex exec "<prompt>"
Claude Code → claude -p "<prompt>"
```

Adapter 계층을 분리했기 때문에 이후 Gemini CLI, Aider, OpenCode, MCP Agent, 사내 Agent CLI 등을 추가할 수 있습니다.

## Separate Bridge

Vite 프로세스와 Bridge를 분리하려면:

```ts
uiAgentLocator({
  startBridge: false,
  bridgeUrl: "http://127.0.0.1:4317"
});
```

```bash
npx ui-agent-locator --cwd ./my-project
```

## Demo

```ts
uiAgentLocator({ demo: true });
```

기존 Story AI Addon 기획대로 Demo는 제품 로직이 아니라 기능 확인용 quick prompt를 제공하는 옵션입니다.

## Security

Bridge 기본 bind 주소는 `127.0.0.1`입니다. AI CLI가 실제 repository 파일을 수정하므로 외부 네트워크 공개를 전제로 하지 않습니다.

## 다음 확장 대상

- [ ] CLI stdout/stderr 실시간 Streaming
- [ ] AI 변경 Diff Preview
- [ ] Apply / Reject
- [ ] Undo Last AI Job
- [ ] Screenshot Crop Context
- [ ] Console Error Context
- [ ] Network Error Context
- [ ] React Component Tree 보조 추적
- [ ] Source Map fallback locator
- [ ] Chrome Extension mode
- [ ] VS Code / JetBrains Extension
- [ ] Vue / Svelte / Next.js 지원
- [ ] MCP Transport
- [ ] Git Worktree/Branch per Job
- [ ] Agent Orchestration

## Product Definition

```text
기존 Story AI Addon
Story / Comment → AI

ui-agent-locator
Live Application UI
→ Source Locator
→ Context Bundle
→ Queue / Lock
→ AI Coding CLI
```

기존 기획을 폐기한 것이 아니라 **Storybook에 묶여 있던 AI 작업 오케스트레이션을 실제 개발 화면으로 확장한 버전**입니다.

> 화면에서 문제를 발견한 개발자가 Story를 만들거나 대상 파일을 직접 찾지 않고, 문제 UI를 클릭해 바로 AI coding agent에게 작업을 넘긴다.
