import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import type { AiJob, AiProvider, BridgeOptions } from "./types.js";

export interface RunningAdapter {
  process: ChildProcessWithoutNullStreams;
  result: Promise<string>;
}

function buildPrompt(job: AiJob): string {
  const projectRoot = typeof job.metadata?.projectRoot === "string"
    ? job.metadata.projectRoot
    : "unknown";

  const targets = job.selections.map((selection, index) => {
    const s = selection.source;
    const ancestry = selection.ancestry
      .map((a) => `${a.component ?? a.tag ?? "element"}@${a.file}:${a.line}:${a.column}`)
      .join(" > ");
    const rect = selection.rect
      ? `${selection.rect.x},${selection.rect.y},${selection.rect.width},${selection.rect.height}`
      : "";
    const attributes = selection.attributes && Object.keys(selection.attributes).length
      ? JSON.stringify(selection.attributes)
      : "";

    return [
      `TARGET ${index + 1}`,
      `absolute_file: ${s.file}`,
      s.relativeFile ? `repo_relative_file: ${s.relativeFile}` : "",
      `line: ${s.line}`,
      `column: ${s.column}`,
      `component: ${s.component ?? "unknown"}`,
      `tag: ${s.tag ?? "unknown"}`,
      selection.role ? `role: ${selection.role}` : "",
      selection.testId ? `test_id: ${selection.testId}` : "",
      selection.selector ? `selector: ${selection.selector}` : "",
      selection.text ? `visible_text: ${selection.text}` : "",
      rect ? `viewport_rect: ${rect}` : "",
      attributes ? `attributes: ${attributes}` : "",
      ancestry ? `ancestry: ${ancestry}` : "",
      selection.request ? `target_request:\n${selection.request}` : ""
    ].filter(Boolean).join("\n");
  }).join("\n\n");

  const notes = job.notes?.length
    ? `\n\n[NOTES]\n${job.notes.map((n) => `- ${n}`).join("\n")}`
    : "";

  return `[UI_AGENT_LOCATOR_JOB]\nversion: 2\njob_id: ${job.id}\nprovider: ${job.provider}\nproject_root: ${projectRoot}\n\n[TARGETS]\n${targets}\n\n[USER_REQUEST]\n${job.prompt}${notes}\n\n[INSTRUCTIONS]\n- Treat absolute_file as the canonical file location.\n- Each TARGET's target_request is authoritative for that visual target.\n- Inspect related files as necessary to understand the existing implementation.\n- Apply all requested UI changes as one coherent change set.\n- Preserve existing behavior and public APIs unless a target request explicitly requires otherwise.\n- Make the requested code changes directly in the current repository.\n- Keep changes scoped to the requests and preserve existing conventions.\n- Run relevant checks when available.\n- Return a short non-technical verification summary suitable for the requester.\n[/UI_AGENT_LOCATOR_JOB]`;
}

function spawnCli(command: string, args: string[], cwd: string): RunningAdapter {
  const child = spawn(command, args, {
    cwd,
    env: process.env,
    stdio: ["pipe", "pipe", "pipe"]
  });
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk) => (stdout += chunk));
  child.stderr.on("data", (chunk) => (stderr += chunk));
  const result = new Promise<string>((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (code) =>
      code === 0
        ? resolve(stdout || stderr)
        : reject(
            new Error(
              `${command} exited with code ${code ?? "unknown"}\n${stderr || stdout}`
            )
          )
    );
  });
  return { process: child, result };
}

export function executeWithAdapter(
  provider: AiProvider,
  job: AiJob,
  options: BridgeOptions
): RunningAdapter {
  const prompt = buildPrompt(job);
  const cwd = options.cwd ?? process.cwd();
  if (provider === "claude") {
    return spawnCli(options.claudeCommand ?? "claude", ["-p", prompt], cwd);
  }
  return spawnCli(options.codexCommand ?? "codex", ["exec", prompt], cwd);
}
