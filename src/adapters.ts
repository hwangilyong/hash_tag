import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import type { AiJob, AiProvider, BridgeOptions } from "./types.js";

export interface RunningAdapter { process: ChildProcessWithoutNullStreams; result: Promise<string>; }

function buildPrompt(job: AiJob): string {
  const targets = job.selections.map((selection, index) => {
    const s = selection.source;
    const ancestry = selection.ancestry.map((a) => `${a.component ?? a.tag ?? "element"}@${a.file}:${a.line}`).join(" > ");
    return [`${index + 1}. ${s.file}:${s.line}:${s.column}`, `   component: ${s.component ?? "unknown"}`, `   tag: ${s.tag ?? "unknown"}`, selection.text ? `   text: ${selection.text}` : "", ancestry ? `   ancestry: ${ancestry}` : ""].filter(Boolean).join("\n");
  }).join("\n");
  const notes = job.notes?.length ? `\nAdditional notes:\n${job.notes.map((n) => `- ${n}`).join("\n")}` : "";
  return `You are working in the current repository.\n\nThe user selected these live UI source locations:\n${targets}\n\nTask:\n${job.prompt}${notes}\n\nInspect related files as needed. Make the requested code changes directly in the repository. Keep changes scoped to the request, preserve existing conventions, and run relevant checks when available.`;
}

function spawnCli(command: string, args: string[], cwd: string): RunningAdapter {
  const child = spawn(command, args, { cwd, env: process.env, stdio: ["pipe", "pipe", "pipe"] });
  let stdout = ""; let stderr = "";
  child.stdout.setEncoding("utf8"); child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk) => (stdout += chunk)); child.stderr.on("data", (chunk) => (stderr += chunk));
  const result = new Promise<string>((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (code) => code === 0 ? resolve(stdout || stderr) : reject(new Error(`${command} exited with code ${code ?? "unknown"}\n${stderr || stdout}`)));
  });
  return { process: child, result };
}

export function executeWithAdapter(provider: AiProvider, job: AiJob, options: BridgeOptions): RunningAdapter {
  const prompt = buildPrompt(job); const cwd = options.cwd ?? process.cwd();
  if (provider === "claude") return spawnCli(options.claudeCommand ?? "claude", ["-p", prompt], cwd);
  return spawnCli(options.codexCommand ?? "codex", ["exec", prompt], cwd);
}
