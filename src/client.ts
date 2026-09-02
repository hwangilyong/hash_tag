import type {
  AiJob,
  AiJobRequest,
  InspectorOptions,
  SelectionContext,
  SourceLocation
} from "./types.js";

const SOURCE_ATTR = "data-ui-agent-source";
const COMPONENT_ATTR = "data-ui-agent-component";
const INTERNAL_ATTRS = new Set([
  SOURCE_ATTR,
  COMPONENT_ATTR,
  "data-ui-agent-tag"
]);

function parseSource(value: string | null): SourceLocation | null {
  if (!value) return null;
  const match = value.match(/^(.*):(\d+):(\d+)$/);
  if (!match) return null;
  return {
    file: match[1],
    line: Number(match[2]),
    column: Number(match[3])
  };
}

function sourceFromElement(el: Element): SourceLocation | null {
  const source = parseSource(el.getAttribute(SOURCE_ATTR));
  if (!source) return null;
  source.component = el.getAttribute(COMPONENT_ATTR) ?? undefined;
  source.tag = el.getAttribute("data-ui-agent-tag") ?? el.tagName.toLowerCase();
  return source;
}

function ancestryFor(el: Element): SourceLocation[] {
  const result: SourceLocation[] = [];
  let cursor: Element | null = el.parentElement;
  const seen = new Set<string>();

  while (cursor) {
    const source = sourceFromElement(cursor);
    if (source) {
      const key = `${source.file}:${source.line}:${source.column}`;
      if (!seen.has(key)) {
        seen.add(key);
        result.push(source);
      }
    }
    cursor = cursor.parentElement;
  }

  return result.slice(0, 12);
}

function selectorFor(el: Element): string {
  const parts: string[] = [];
  let cursor: Element | null = el;

  while (cursor && parts.length < 6) {
    let part = cursor.tagName.toLowerCase();
    const id = cursor.getAttribute("id");
    if (id) {
      part += `#${CSS.escape(id)}`;
      parts.unshift(part);
      break;
    }

    const testId = cursor.getAttribute("data-testid");
    if (testId) {
      part += `[data-testid="${CSS.escape(testId)}"]`;
      parts.unshift(part);
      break;
    }

    const parent = cursor.parentElement;
    if (parent) {
      const siblings = Array.from(parent.children).filter(
        (candidate) => candidate.tagName === cursor!.tagName
      );
      if (siblings.length > 1) {
        part += `:nth-of-type(${siblings.indexOf(cursor) + 1})`;
      }
    }

    parts.unshift(part);
    cursor = parent;
  }

  return parts.join(" > ");
}

function attributesFor(el: Element): Record<string, string> {
  const attributes: Record<string, string> = {};
  for (const attribute of Array.from(el.attributes).slice(0, 24)) {
    if (INTERNAL_ATTRS.has(attribute.name)) continue;
    attributes[attribute.name] = attribute.value.slice(0, 300);
  }
  return attributes;
}

function toSelection(el: Element): SelectionContext | null {
  const source = sourceFromElement(el);
  if (!source) return null;
  const rect = el.getBoundingClientRect();

  return {
    id: crypto.randomUUID(),
    source,
    text: (el.textContent ?? "").trim().replace(/\s+/g, " ").slice(0, 240),
    role: el.getAttribute("role") ?? undefined,
    testId: el.getAttribute("data-testid") ?? undefined,
    selector: selectorFor(el),
    rect: {
      x: Math.round(rect.x),
      y: Math.round(rect.y),
      width: Math.round(rect.width),
      height: Math.round(rect.height)
    },
    attributes: attributesFor(el),
    ancestry: ancestryFor(el)
  };
}

function nearestLocatedElement(target: EventTarget | null): Element | null {
  if (!(target instanceof Element)) return null;
  return target.closest(`[${SOURCE_ATTR}]`);
}

function modifierPressed(
  event: MouseEvent,
  key: InspectorOptions["activationKey"]
) {
  if (key === "Meta") return event.metaKey;
  if (key === "Control") return event.ctrlKey;
  return event.altKey;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function elementLabel(selection: SelectionContext): string {
  const ariaLabel = selection.attributes?.["aria-label"]?.trim();
  if (ariaLabel) return ariaLabel.slice(0, 48);
  if (selection.text) return selection.text.slice(0, 48);

  const tag = selection.source.tag ?? "element";
  const friendly: Record<string, string> = {
    button: "버튼",
    input: "입력창",
    textarea: "입력 영역",
    select: "선택창",
    img: "이미지",
    a: "링크",
    table: "표",
    tr: "표 행",
    td: "표 셀",
    th: "표 제목",
    nav: "메뉴",
    header: "상단 영역",
    footer: "하단 영역",
    section: "화면 영역",
    form: "입력 폼"
  };

  return friendly[tag] ?? "화면 요소";
}

function statusLabel(status: AiJob["status"]): string {
  switch (status) {
    case "queued":
      return "요청 대기 중";
    case "blocked":
      return "순서 대기 중";
    case "running":
      return "수정 중";
    case "succeeded":
      return "수정 완료";
    case "failed":
      return "수정하지 못했습니다";
    case "cancelled":
      return "요청 취소됨";
  }
}

export function installInspector(options: InspectorOptions = {}) {
  if ((window as any).__UI_AGENT_LOCATOR_INSTALLED__) return;
  (window as any).__UI_AGENT_LOCATOR_INSTALLED__ = true;

  const bridgeUrl = options.bridgeUrl ?? "http://127.0.0.1:4317";
  const activationKey = options.activationKey ?? "Alt";
  const maxSelections = options.maxSelections ?? 20;
  const provider = options.provider ?? "codex";

  let draftSelection: SelectionContext | null = null;
  const requests: SelectionContext[] = [];
  let jobs: AiJob[] = [];

  const host = document.createElement("ui-agent-locator");
  Object.assign(host.style, {
    position: "fixed",
    inset: "0",
    width: "100vw",
    height: "100vh",
    pointerEvents: "none",
    zIndex: "2147483647"
  });
  const shadow = host.attachShadow({ mode: "closed" });

  const style = document.createElement("style");
  style.textContent = `
    :host{all:initial}
    *{box-sizing:border-box}
    .ual-hover{position:fixed;z-index:1;pointer-events:none;border:2px solid #6c5ce7;border-radius:6px;background:rgba(108,92,231,.06)}
    .ual-pill{position:fixed;z-index:2;pointer-events:none;font:12px/1.3 system-ui,sans-serif;background:#171717;color:#fff;padding:5px 8px;border-radius:6px;max-width:70vw;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    .ual-panel{position:fixed;right:16px;bottom:16px;z-index:3;pointer-events:auto;width:410px;max-width:calc(100vw - 32px);max-height:calc(100vh - 32px);overflow:auto;font:13px/1.45 system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;background:#fff;color:#171717;border:1px solid #ddd;border-radius:14px;box-shadow:0 18px 55px rgba(0,0,0,.2);padding:14px}
    .ual-title{font-size:15px;font-weight:750}.ual-help{margin-top:3px;color:#666;font-size:12px}
    .ual-row{display:flex;gap:8px;align-items:center}.ual-grow{flex:1;min-width:0}.ual-muted{color:#6f6f6f}.ual-small{font-size:11px}
    .ual-current{margin-top:12px;padding:10px;border:1px solid #e2ddff;background:#f8f7ff;border-radius:10px}.ual-current strong{display:block;margin-bottom:3px}
    .ual-empty{margin-top:12px;padding:12px;border:1px dashed #d2d2d2;border-radius:10px;color:#707070;text-align:center}
    textarea{width:100%;min-height:84px;box-sizing:border-box;margin:9px 0;padding:10px;border:1px solid #cfcfcf;border-radius:9px;resize:vertical;font:inherit;color:inherit;background:#fff;outline:none}textarea:focus{border-color:#6c5ce7;box-shadow:0 0 0 3px rgba(108,92,231,.10)}
    button{border:1px solid #d0d0d0;background:#fafafa;color:#171717;border-radius:8px;padding:7px 10px;font:inherit;cursor:pointer}button:hover{background:#f2f2f2}button:disabled{opacity:.5;cursor:default}.ual-primary{background:#6c5ce7;color:#fff;border-color:#6c5ce7;font-weight:700}.ual-primary:hover{background:#5a4bd1}.ual-secondary{background:#fff}
    .ual-requests{margin-top:12px}.ual-request{padding:10px 0;border-top:1px solid #eee}.ual-request:first-child{border-top:0}.ual-request-head{display:flex;gap:8px;align-items:flex-start}.ual-request-title{font-weight:700}.ual-request-text{margin-top:3px;color:#444;white-space:pre-wrap}.ual-icon-button{padding:2px 7px;border:0;background:transparent;font-size:16px;color:#777}
    .ual-banner{display:none;margin:10px 0;padding:9px 10px;border-radius:9px}.ual-banner[data-kind="warn"]{display:block;background:#fff4d6}.ual-banner[data-kind="ok"]{display:block;background:#eaf7ed}.ual-banner[data-kind="error"]{display:block;background:#fdecec}
    .ual-section-title{margin-top:14px;font-weight:750}.ual-jobs{margin-top:5px}.ual-job{padding:9px 0;border-top:1px solid #eee}.ual-job-head{display:flex;gap:8px;align-items:center}.ual-status{font-size:11px;font-weight:700}.ual-job-message{margin-top:3px;color:#666;font-size:12px}.ual-job-actions{display:flex;gap:6px;margin-top:7px}.ual-job-actions button{padding:5px 8px;font-size:12px}.ual-danger{color:#a22}
    details{margin-top:10px;border-top:1px solid #eee;padding-top:8px}summary{cursor:pointer;color:#666;font-size:12px}.ual-tech{margin-top:7px;padding:8px;background:#f6f6f6;border-radius:8px;font:10px/1.45 ui-monospace,SFMono-Regular,Menlo,monospace;white-space:pre-wrap;overflow-wrap:anywhere;color:#555}
    .ual-demo{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:4px}.ual-demo button{font-size:12px;padding:5px 8px}
  `;

  const hoverBox = document.createElement("div");
  hoverBox.className = "ual-hover";
  hoverBox.hidden = true;

  const pill = document.createElement("div");
  pill.className = "ual-pill";
  pill.hidden = true;

  const panel = document.createElement("div");
  panel.className = "ual-panel";
  panel.innerHTML = `
    <div class="ual-title">화면 수정 요청</div>
    <div class="ual-help">${activationKey} 키를 누른 채 바꾸고 싶은 화면 영역을 클릭하세요.</div>

    <div class="ual-current" hidden>
      <strong class="ual-current-label"></strong>
      <span class="ual-muted">이 영역을 어떻게 바꾸고 싶나요?</span>
      <textarea placeholder="예: 버튼을 조금 더 크게 하고 파란색으로 바꿔주세요."></textarea>
      ${options.demo ? `<div class="ual-demo"><button data-prompt="이 영역의 간격과 정렬을 자연스럽게 정리해주세요.">레이아웃 정리</button><button data-prompt="이 영역을 더 보기 쉽고 사용하기 편하게 개선해주세요.">사용성 개선</button></div>` : ""}
      <div class="ual-row">
        <button data-action="discard-draft" class="ual-secondary">선택 취소</button>
        <button data-action="add-request" class="ual-primary ual-grow">요청 추가</button>
      </div>
    </div>

    <div class="ual-empty">아직 수정 요청이 없습니다.</div>
    <div class="ual-requests"></div>

    <div class="ual-row" style="margin-top:12px">
      <button data-action="clear-all">전체 지우기</button>
      <button data-action="send" class="ual-primary ual-grow" disabled>수정 요청 보내기</button>
    </div>

    <div class="ual-banner"></div>

    <div class="ual-section-title">진행 상태 <span class="ual-job-count ual-muted"></span></div>
    <div class="ual-jobs"></div>

    <details>
      <summary>고급 정보</summary>
      <div class="ual-tech ual-advanced"></div>
    </details>
  `;

  shadow.append(style, hoverBox, pill, panel);
  document.documentElement.appendChild(host);

  const current = panel.querySelector(".ual-current") as HTMLDivElement;
  const currentLabel = panel.querySelector(".ual-current-label") as HTMLDivElement;
  const textarea = panel.querySelector("textarea") as HTMLTextAreaElement;
  const empty = panel.querySelector(".ual-empty") as HTMLDivElement;
  const requestsEl = panel.querySelector(".ual-requests") as HTMLDivElement;
  const sendButton = panel.querySelector('[data-action="send"]') as HTMLButtonElement;
  const banner = panel.querySelector(".ual-banner") as HTMLDivElement;
  const jobsEl = panel.querySelector(".ual-jobs") as HTMLDivElement;
  const jobCount = panel.querySelector(".ual-job-count") as HTMLSpanElement;
  const advanced = panel.querySelector(".ual-advanced") as HTMLDivElement;

  function showBanner(message: string, kind: "warn" | "ok" | "error") {
    banner.dataset.kind = kind;
    banner.textContent = message;
  }

  function clearBanner() {
    banner.removeAttribute("data-kind");
    banner.textContent = "";
  }

  function renderDraft() {
    current.hidden = !draftSelection;
    if (!draftSelection) {
      currentLabel.textContent = "";
      textarea.value = "";
      return;
    }
    currentLabel.textContent = `선택됨 · ${elementLabel(draftSelection)}`;
  }

  function renderRequests() {
    empty.hidden = requests.length > 0;
    sendButton.disabled = requests.length === 0;
    sendButton.textContent = requests.length
      ? `수정 요청 보내기 (${requests.length})`
      : "수정 요청 보내기";

    requestsEl.innerHTML = requests
      .map(
        (request, index) => `
          <div class="ual-request">
            <div class="ual-request-head">
              <div class="ual-grow">
                <div class="ual-request-title">${index + 1}. ${escapeHtml(elementLabel(request))}</div>
                <div class="ual-request-text">${escapeHtml(request.request ?? "")}</div>
              </div>
              <button class="ual-icon-button" data-remove-request="${request.id}" aria-label="요청 삭제">×</button>
            </div>
          </div>`
      )
      .join("");

    const draftInfo = draftSelection
      ? `${draftSelection.source.file}:${draftSelection.source.line}:${draftSelection.source.column}`
      : "none";
    advanced.textContent = [
      `engine: ${provider}`,
      `bridge: ${bridgeUrl}`,
      `draft_source: ${draftInfo}`,
      `saved_requests: ${requests.length}`
    ].join("\n");
  }

  function renderJobs() {
    const visible = [...jobs]
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, 8);

    jobCount.textContent = jobs.length ? `(${jobs.length})` : "";
    jobsEl.innerHTML = visible.length
      ? visible
          .map((job) => {
            const retryable = ["failed", "cancelled"].includes(job.status);
            const cancellable = ["queued", "blocked", "running"].includes(job.status);
            const deletable = job.status !== "running";
            const message =
              job.status === "blocked"
                ? "다른 수정 작업이 진행 중입니다. 완료 후 자동으로 시작됩니다."
                : job.status === "running"
                  ? `${job.selections.length}개의 요청을 반영하고 있습니다.`
                  : job.status === "succeeded"
                    ? "요청한 화면 수정이 완료되었습니다. 화면에서 결과를 확인해주세요."
                    : job.status === "failed"
                      ? "수정 과정에서 문제가 발생했습니다. 다시 요청할 수 있습니다."
                      : job.status === "queued"
                        ? "수정 요청이 순서대로 처리될 예정입니다."
                        : "이 요청은 취소되었습니다.";

            const tech = [
              `job: ${job.id}`,
              `engine: ${job.provider}`,
              `attempts: ${job.attempts}`,
              `files: ${job.lockedFiles.join(", ") || "none"}`,
              job.error ? `error: ${job.error}` : ""
            ].filter(Boolean).join("\n");

            return `<div class="ual-job">
              <div class="ual-job-head">
                <span class="ual-status">${escapeHtml(statusLabel(job.status))}</span>
                <span class="ual-muted ual-small">요청 ${job.selections.length}건</span>
              </div>
              <div class="ual-job-message">${escapeHtml(message)}</div>
              <div class="ual-job-actions">
                ${retryable ? `<button data-job-action="retry" data-job-id="${job.id}">다시 요청</button>` : ""}
                ${cancellable ? `<button data-job-action="cancel" data-job-id="${job.id}">취소</button>` : ""}
                ${deletable ? `<button data-job-action="delete" data-job-id="${job.id}">목록에서 삭제</button>` : ""}
              </div>
              <details>
                <summary>작업 상세</summary>
                <div class="ual-tech">${escapeHtml(tech)}</div>
              </details>
            </div>`;
          })
          .join("")
      : `<div class="ual-muted ual-small" style="padding:8px 0">아직 진행 중인 수정 작업이 없습니다.</div>`;
  }

  async function refreshJobs() {
    try {
      const response = await fetch(`${bridgeUrl}/jobs`);
      if (!response.ok) return;
      jobs = (await response.json()) as AiJob[];
      renderJobs();
    } catch {
      // The visual review UI remains usable while the local bridge starts.
    }
  }

  async function mutateJob(
    id: string,
    action: "retry" | "cancel" | "delete"
  ) {
    const response = await fetch(
      action === "delete"
        ? `${bridgeUrl}/jobs/${id}`
        : `${bridgeUrl}/jobs/${id}/${action}`,
      { method: action === "delete" ? "DELETE" : "POST" }
    );
    if (!response.ok && response.status !== 204) {
      throw new Error(await response.text());
    }
    await refreshJobs();
  }

  function connectEvents() {
    try {
      const url = new URL(bridgeUrl);
      url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
      url.pathname = "/events";
      const socket = new WebSocket(url);
      socket.addEventListener("message", (event) => {
        try {
          const payload = JSON.parse(String(event.data));
          if (payload?.type !== "job" || !payload.job) return;
          const incoming = payload.job as AiJob;
          const index = jobs.findIndex((job) => job.id === incoming.id);
          if (index >= 0) jobs[index] = incoming;
          else jobs.push(incoming);
          renderJobs();
        } catch {
          // Ignore malformed local event payloads.
        }
      });
      socket.addEventListener("close", () => setTimeout(connectEvents, 1500));
    } catch {
      setTimeout(connectEvents, 1500);
    }
  }

  function drawHover(el: Element | null) {
    if (!el) {
      hoverBox.hidden = true;
      pill.hidden = true;
      return;
    }

    const selection = toSelection(el);
    if (!selection) return drawHover(null);
    const rect = el.getBoundingClientRect();
    hoverBox.hidden = false;
    pill.hidden = false;
    Object.assign(hoverBox.style, {
      left: `${rect.left}px`,
      top: `${rect.top}px`,
      width: `${rect.width}px`,
      height: `${rect.height}px`
    });
    pill.textContent = `${elementLabel(selection)} · 클릭해서 수정 요청 작성`;
    pill.style.left = `${Math.max(4, rect.left)}px`;
    pill.style.top = `${Math.max(4, rect.top - 28)}px`;
  }

  function isInspectorEvent(event: Event) {
    return event.composedPath().includes(host);
  }

  window.addEventListener(
    "mousemove",
    (event) => {
      if (isInspectorEvent(event)) return drawHover(null);
      if (!modifierPressed(event, activationKey)) return drawHover(null);
      drawHover(nearestLocatedElement(event.target));
    },
    true
  );

  window.addEventListener(
    "click",
    (event) => {
      if (isInspectorEvent(event)) return;
      if (!modifierPressed(event, activationKey)) return;
      const el = nearestLocatedElement(event.target);
      if (!el) return;

      event.preventDefault();
      event.stopPropagation();
      const selection = toSelection(el);
      if (!selection) return;

      draftSelection = selection;
      clearBanner();
      renderDraft();
      renderRequests();
      textarea.focus();
    },
    true
  );

  panel.addEventListener("click", async (event) => {
    const target = event.target as HTMLElement;
    const jobAction = target.dataset.jobAction as
      | "retry"
      | "cancel"
      | "delete"
      | undefined;
    const jobId = target.dataset.jobId;

    if (jobAction && jobId) {
      target.setAttribute("disabled", "true");
      try {
        await mutateJob(jobId, jobAction);
      } catch (error) {
        showBanner(
          error instanceof Error ? error.message : String(error),
          "error"
        );
      } finally {
        target.removeAttribute("disabled");
      }
      return;
    }

    const removeRequestId = target.dataset.removeRequest;
    if (removeRequestId) {
      const index = requests.findIndex((request) => request.id === removeRequestId);
      if (index >= 0) requests.splice(index, 1);
      renderRequests();
      return;
    }

    if (target.dataset.prompt) {
      textarea.value = target.dataset.prompt;
      textarea.focus();
      return;
    }

    const action = target.dataset.action;

    if (action === "discard-draft") {
      draftSelection = null;
      renderDraft();
      renderRequests();
      return;
    }

    if (action === "add-request") {
      const requestText = textarea.value.trim();
      if (!draftSelection || !requestText) {
        showBanner("화면 영역을 선택하고 원하는 변경 내용을 입력해주세요.", "warn");
        return;
      }
      if (requests.length >= maxSelections) {
        showBanner(`한 번에 최대 ${maxSelections}개의 요청을 보낼 수 있습니다.`, "warn");
        return;
      }

      requests.push({
        ...draftSelection,
        id: crypto.randomUUID(),
        request: requestText
      });
      draftSelection = null;
      textarea.value = "";
      showBanner("요청을 추가했습니다. 다른 영역도 계속 선택할 수 있습니다.", "ok");
      renderDraft();
      renderRequests();
      return;
    }

    if (action === "clear-all") {
      draftSelection = null;
      requests.length = 0;
      textarea.value = "";
      clearBanner();
      renderDraft();
      renderRequests();
      return;
    }

    if (action !== "send") return;
    if (requests.length === 0) {
      showBanner("먼저 하나 이상의 수정 요청을 추가해주세요.", "warn");
      return;
    }

    const request: AiJobRequest = {
      provider,
      prompt:
        "Apply each target-specific visual UI change request. Treat each request independently, then ensure the combined result remains visually and behaviorally consistent.",
      selections: requests.map((selection) => ({ ...selection })),
      metadata: {
        url: location.href,
        title: document.title,
        requesterMode: "non-developer"
      }
    };

    target.setAttribute("disabled", "true");
    target.textContent = "요청 전달 중…";

    try {
      const response = await fetch(`${bridgeUrl}/jobs`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(request)
      });
      if (!response.ok) throw new Error(await response.text());

      const job = (await response.json()) as AiJob;
      const existing = jobs.findIndex((candidate) => candidate.id === job.id);
      if (existing >= 0) jobs[existing] = job;
      else jobs.push(job);

      requests.length = 0;
      draftSelection = null;
      textarea.value = "";
      renderDraft();
      renderRequests();
      renderJobs();

      if (job.status === "blocked") {
        showBanner(
          "다른 수정 작업이 진행 중입니다. 완료 후 이 요청이 자동으로 시작됩니다.",
          "warn"
        );
      } else {
        showBanner("수정 요청을 전달했습니다.", "ok");
      }
    } catch (error) {
      showBanner(
        error instanceof Error ? error.message : String(error),
        "error"
      );
    } finally {
      target.removeAttribute("disabled");
      target.textContent = requests.length
        ? `수정 요청 보내기 (${requests.length})`
        : "수정 요청 보내기";
      (target as HTMLButtonElement).disabled = requests.length === 0;
    }
  });

  renderDraft();
  renderRequests();
  renderJobs();
  void refreshJobs();
  connectEvents();

  return {
    getSelections: () => requests.map((selection) => ({ ...selection })),
    getJobs: () => [...jobs],
    clear: () => {
      draftSelection = null;
      requests.length = 0;
      renderDraft();
      renderRequests();
    },
    refreshJobs
  };
}
