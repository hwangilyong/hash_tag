# ui-agent-locator

Storybook Story를 만들지 않고 **실제 React/Vite 화면에서 비개발자가 원하는 UI를 직접 클릭해 수정 요청을 남기면, 내부적으로 정확한 JSX/TSX 소스와 AI Coding CLI를 연결하는 Visual Review 도구**입니다.

핵심 목적은 개발자가 소스를 빨리 찾는 것보다 **비개발자가 파일명, 컴포넌트, Git, CLI, 프롬프트 구조를 몰라도 화면만 보고 개발 수정 요청을 전달할 수 있게 하는 것**입니다.

## 사용자 경험

```text
실제 앱 화면
  ↓ Alt + Click
바꾸고 싶은 영역 선택
  ↓
"어떻게 바꾸고 싶나요?"
  ↓
요청 추가
  ↓ 다른 영역도 반복 가능
수정 요청 보내기
  ↓
요청 대기 중 → 수정 중 → 수정 완료
  ↓
화면에서 결과 확인
```

비개발자 기본 UI에는 다음 정보를 노출하지 않습니다.

```text
파일 절대경로 / line / column
Codex / Claude CLI
Job ID / File Lock
AST / Source Metadata
```

필요한 기술 정보는 `고급 정보`와 `작업 상세` 안에서만 확인합니다.

## 기존 Story AI Addon에서 이어받은 개념

- 화면 요소별 코멘트/수정 요청
- 여러 요청을 한 번에 전송
- 한 번의 전송 = 하나의 Job
- Queue
- 파일 Lock
- blocked 자동 재평가
- Retry / Cancel / Delete
- Demo quick request
- Codex / Claude Adapter

가장 큰 차이는 **Story를 먼저 만들 필요가 없다는 것**입니다.

```text
기존
Component → Story 작성 → Storybook → Comment → AI

현재
실제 앱 → 화면 클릭 → 수정 요청 → Source Context 자동 수집
       → Queue / Lock → AI Coding CLI → Vite HMR
```

## 현재 구현된 기능

- [x] Storybook/Story 생성 의존성 제거
- [x] React/Vite 개발 화면에 Visual Review UI 자동 주입
- [x] Inspector UI를 closed Shadow DOM으로 기존 앱 UI/CSS와 격리
- [x] AST 기반 JSX/TSX Source Metadata Injection
- [x] React private Fiber API 비의존 Locator
- [x] `Alt + Click`으로 화면 영역 선택
- [x] 선택 영역별 자연어 수정 요청 작성
- [x] 여러 영역의 요청을 하나의 Context Bundle / Job으로 일괄 전송
- [x] visible text / role / test-id / selector / rect / attributes 수집
- [x] source ancestry 수집
- [x] Browser에는 repo-relative path만 유지
- [x] Bridge에서 canonical absolute path로 정규화
- [x] repository root 밖 경로 차단
- [x] 절대경로 기준 File Lock
- [x] Codex CLI Adapter
- [x] Claude Code Adapter
- [x] Local HTTP Bridge
- [x] WebSocket Job Event
- [x] Queue / Retry / Cancel / Delete
- [x] Lock 충돌 blocked 처리 및 자동 재실행
- [x] 비개발자 친화적 Job 상태 문구
- [x] 기술 정보는 고급 정보로 분리
- [x] Context Cache reset API
- [x] 동시 실행 수 설정
- [x] Demo quick request 옵션
- [x] production build 자동 비활성화 (`apply: serve`)
- [x] GitHub Actions TypeScript build 검증

## Visual Review 흐름

화면에서 원하는 영역을 선택합니다.

```text
Alt + Click
```

예:

```text
검색 버튼 선택
→ "버튼을 조금 크게 하고 파란색으로 바꿔주세요"
→ 요청 추가

검색 결과 표 선택
→ "행 간격을 조금 더 넓혀주세요"
→ 요청 추가

수정 요청 보내기 (2)
```

내부적으로는 다음처럼 처리됩니다.

```text
Request 1 → source A
Request 2 → source B
        ↓
1 Context Bundle
        ↓
1 AI Job
```

## DOM과 Visual Review UI 분리

원래 React Application DOM 위에 Inspector CSS를 직접 섞지 않습니다.

```text
document
├─ 실제 React App
└─ <ui-agent-locator>
   └─ closed Shadow Root
      ├─ Hover Overlay
      ├─ Target Label
      └─ Visual Review Panel
```

선택 대상 자체에 outline/class를 추가하지 않고 `getBoundingClientRect()`를 이용해 별도 Overlay를 그립니다.

## Source Locator

개발 모드에서 실제 DOM이 되는 intrinsic JSX node에 최소 metadata를 넣습니다.

```tsx
<section
  data-ui-agent-source="src/components/UserCard.tsx:42:7"
  data-ui-agent-component="UserCard"
  data-ui-agent-tag="section"
/>
```

이 값은 Browser에서는 상대경로입니다. Bridge가 Job을 받으면 실행 프로젝트 root 기준으로 절대경로를 확정합니다.

```text
Browser
src/components/UserCard.tsx

Bridge / CLI / Lock
/Users/example/project/src/components/UserCard.tsx
```

절대경로는 canonical source 및 File Lock key로 사용하고, repo-relative path는 표시/추적용으로 함께 보존합니다.

## AI Context

각 Visual Request에는 사용자에게 보이지 않는 다음 Context가 같이 전달됩니다.

```text
사용자 요청
visible text
role / test-id
DOM selector
viewport rect
attributes
component / tag
source ancestry
absolute source file
line / column
```

CLI Adapter는 이를 공통 `UI_AGENT_LOCATOR_JOB` Envelope로 직렬화합니다. 각 `TARGET`에는 해당 화면 요소에 작성된 `target_request`가 포함됩니다.

## Job 상태

내부 상태와 사용자 표시를 분리합니다.

| 내부 상태 | 기본 UI |
| --- | --- |
| queued | 요청 대기 중 |
| blocked | 순서 대기 중 |
| running | 수정 중 |
| succeeded | 수정 완료 |
| failed | 수정하지 못했습니다 |
| cancelled | 요청 취소됨 |

`blocked`의 실제 원인이 File Lock 충돌이어도 기본 화면에는 기술 용어 대신 다음처럼 안내합니다.

```text
다른 수정 작업이 진행 중입니다.
완료 후 자동으로 시작됩니다.
```

## Installation

```bash
npm install -D ui-agent-locator
```

Node.js 20+와 사용할 AI CLI가 필요합니다.

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

`provider`는 개발/관리 설정이며 비개발자 Visual Review 화면에서는 노출하지 않습니다.

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

## Separate Bridge

```ts
uiAgentLocator({
  startBridge: false,
  bridgeUrl: "http://127.0.0.1:4317"
});
```

```bash
npx ui-agent-locator --cwd ./my-project
```

## Security

Bridge 기본 bind 주소는 `127.0.0.1`입니다. AI CLI가 실제 repository 파일을 수정하므로 외부 네트워크 공개를 기본 사용 방식으로 두지 않습니다.

## 다음 확장 대상

- [ ] AI 변경 전/후 Preview
- [ ] 비개발자용 변경 요약
- [ ] Apply / Reject
- [ ] Undo Last AI Job
- [ ] Screenshot Crop Context
- [ ] Console / Network Error Context
- [ ] CLI stdout/stderr Streaming
- [ ] Chrome Extension mode
- [ ] VS Code / JetBrains Extension
- [ ] Vue / Svelte / Next.js 지원
- [ ] MCP Transport
- [ ] Git Worktree/Branch per Job
- [ ] Agent Orchestration

## Product Definition

> 비개발자가 소스코드 위치나 개발 도구를 몰라도 실제 화면에서 원하는 부분을 클릭하고 자연어로 변경사항을 요청하면, 시스템이 관련 소스를 자동으로 찾아 AI Coding Agent에게 안전하게 작업을 전달한다.
