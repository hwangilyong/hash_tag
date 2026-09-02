import type { AiJob, AiJobRequest, InspectorOptions, SelectionContext, SourceLocation } from "./types.js";

const SOURCE_ATTR = "data-ui-agent-source";
const COMPONENT_ATTR = "data-ui-agent-component";

function parseSource(value: string | null): SourceLocation | null {
  if (!value) return null;
  const match = value.match(/^(.*):(\d+):(\d+)$/);
  if (!match) return null;
  return { file: match[1], line: Number(match[2]), column: Number(match[3]) };
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
      if (!seen.has(key)) { seen.add(key); result.push(source); }
    }
    cursor = cursor.parentElement;
  }
  return result.slice(0, 12);
}

function toSelection(el: Element): SelectionContext | null {
  const source = sourceFromElement(el);
  if (!source) return null;
  return {
    id: crypto.randomUUID(),
    source,
    text: (el.textContent ?? "").trim().replace(/\s+/g, " ").slice(0, 240),
    role: el.getAttribute("role") ?? undefined,
    testId: el.getAttribute("data-testid") ?? undefined,
    ancestry: ancestryFor(el)
  };
}

function nearestLocatedElement(target: EventTarget | null): Element | null {
  if (!(target instanceof Element)) return null;
  return target.closest(`[${SOURCE_ATTR}]`);
}

function modifierPressed(event: MouseEvent, key: InspectorOptions["activationKey"]) {
  if (key === "Meta") return event.metaKey;
  if (key === "Control") return event.ctrlKey;
  return event.altKey;
}

export function installInspector(options: InspectorOptions = {}) {
  if ((window as any).__UI_AGENT_LOCATOR_INSTALLED__) return;
  (window as any).__UI_AGENT_LOCATOR_INSTALLED__ = true;

  const bridgeUrl = options.bridgeUrl ?? "http://127.0.0.1:4317";
  const activationKey = options.activationKey ?? "Alt";
  const maxSelections = options.maxSelections ?? 20;
  const selections: SelectionContext[] = [];
  let provider = options.provider ?? "codex";

  const style = document.createElement("style");
  style.textContent = `.ual-hover{position:fixed;z-index:2147483645;pointer-events:none;border:2px solid currentColor;border-radius:4px}.ual-pill{position:fixed;z-index:2147483646;pointer-events:none;font:12px/1.2 ui-monospace,monospace;background:#111;color:#fff;padding:4px 6px;border-radius:4px;max-width:70vw;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.ual-panel{position:fixed;right:16px;bottom:16px;z-index:2147483647;width:360px;max-width:calc(100vw - 32px);font:13px/1.4 system-ui,sans-serif;background:#fff;color:#111;border:1px solid #d9d9d9;border-radius:12px;box-shadow:0 16px 50px rgba(0,0,0,.18);padding:12px}.ual-row{display:flex;gap:8px;align-items:center}.ual-row>*{min-width:0}.ual-panel textarea{width:100%;min-height:88px;box-sizing:border-box;margin:8px 0;padding:8px;border:1px solid #ccc;border-radius:8px;resize:vertical}.ual-panel button,.ual-panel select{border:1px solid #ccc;background:#fafafa;border-radius:7px;padding:6px 8px}.ual-panel button{cursor:pointer}.ual-list{max-height:160px;overflow:auto;margin:8px 0}.ual-item{font:11px/1.35 ui-monospace,monospace;padding:5px 0;border-bottom:1px solid #eee}.ual-muted{color:#666}.ual-grow{flex:1}`;
  document.head.appendChild(style);

  const hoverBox = document.createElement("div");
  hoverBox.className = "ual-hover";
  hoverBox.hidden = true;
  const pill = document.createElement("div");
  pill.className = "ual-pill";
  pill.hidden = true;
  document.body.append(hoverBox, pill);

  const panel = document.createElement("div");
  panel.className = "ual-panel";
  panel.innerHTML = `<div class="ual-row"><strong class="ual-grow">UI Agent Locator</strong><span class="ual-muted">${activationKey}+Click</span></div><div class="ual-list"></div><textarea placeholder="선택한 UI에 대해 AI에게 요청할 작업을 입력하세요."></textarea><div class="ual-row"><select aria-label="AI provider"><option value="codex">Codex</option><option value="claude">Claude Code</option></select><button data-action="clear">Clear</button><button data-action="send" class="ual-grow">Send to AI</button></div>${options.demo ? `<div class="ual-row" style="margin-top:8px"><button data-prompt="선택한 UI의 레이아웃 문제를 찾아 수정해줘.">Fix layout</button><button data-prompt="선택한 UI를 리팩터링하고 관련 테스트를 보강해줘.">Refactor</button></div>` : ""}`;
  document.body.appendChild(panel);

  const list = panel.querySelector(".ual-list") as HTMLDivElement;
  const textarea = panel.querySelector("textarea") as HTMLTextAreaElement;
  const select = panel.querySelector("select") as HTMLSelectElement;

  function renderSelections() {
    list.innerHTML = selections.length
      ? selections.map((s, i) => `<div class="ual-item">${i + 1}. ${s.source.component ?? s.source.tag ?? "element"} · ${s.source.file}:${s.source.line}:${s.source.column}</div>`).join("")
      : `<div class="ual-muted">선택 없음 · ${activationKey}+Click, Shift+${activationKey}+Click 멀티 선택</div>`;
  }

  function drawHover(el: Element | null) {
    if (!el) { hoverBox.hidden = pill.hidden = true; return; }
    const source = sourceFromElement(el);
    if (!source) return drawHover(null);
    const rect = el.getBoundingClientRect();
    hoverBox.hidden = false; pill.hidden = false;
    Object.assign(hoverBox.style, { left: `${rect.left}px`, top: `${rect.top}px`, width: `${rect.width}px`, height: `${rect.height}px` });
    pill.textContent = `${source.component ?? source.tag ?? "element"} · ${source.file}:${source.line}:${source.column}`;
    pill.style.left = `${Math.max(4, rect.left)}px`;
    pill.style.top = `${Math.max(4, rect.top - 24)}px`;
  }

  window.addEventListener("mousemove", (event) => {
    if (!modifierPressed(event, activationKey)) return drawHover(null);
    drawHover(nearestLocatedElement(event.target));
  }, true);

  window.addEventListener("click", (event) => {
    if (!modifierPressed(event, activationKey)) return;
    const el = nearestLocatedElement(event.target);
    if (!el || panel.contains(el)) return;
    event.preventDefault(); event.stopPropagation();
    const selection = toSelection(el);
    if (!selection) return;
    if (!event.shiftKey) selections.length = 0;
    const key = `${selection.source.file}:${selection.source.line}:${selection.source.column}`;
    if (!selections.some((s) => `${s.source.file}:${s.source.line}:${s.source.column}` === key) && selections.length < maxSelections) selections.push(selection);
    renderSelections();
  }, true);

  panel.addEventListener("click", async (event) => {
    const target = event.target as HTMLElement;
    const action = target.dataset.action;
    if (target.dataset.prompt) { textarea.value = target.dataset.prompt; return; }
    if (action === "clear") { selections.length = 0; textarea.value = ""; renderSelections(); return; }
    if (action !== "send") return;
    const prompt = textarea.value.trim();
    if (!prompt || selections.length === 0) return;

    const request: AiJobRequest = { provider, prompt, selections: [...selections], metadata: { url: location.href, title: document.title } };
    target.setAttribute("disabled", "true"); target.textContent = "Queued…";
    try {
      const response = await fetch(`${bridgeUrl}/jobs`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(request) });
      if (!response.ok) throw new Error(await response.text());
      const job = (await response.json()) as AiJob;
      target.textContent = `Queued #${job.id.slice(0, 6)}`;
      textarea.value = "";
    } catch (error) {
      target.textContent = error instanceof Error ? error.message.slice(0, 40) : "Failed";
    } finally {
      setTimeout(() => { target.removeAttribute("disabled"); target.textContent = "Send to AI"; }, 1400);
    }
  });

  select.value = provider;
  select.addEventListener("change", () => { provider = select.value as "codex" | "claude"; });
  renderSelections();

  return { getSelections: () => [...selections], clear: () => { selections.length = 0; renderSelections(); } };
}
