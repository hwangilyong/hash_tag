#!/usr/bin/env node
import { startBridge } from "./bridge.js";

function arg(name: string) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const port = Number(arg("--port") ?? process.env.UI_AGENT_PORT ?? 4317);
const host = arg("--host") ?? process.env.UI_AGENT_HOST ?? "127.0.0.1";
const cwd = arg("--cwd") ?? process.cwd();
const concurrency = Number(arg("--concurrency") ?? 1);
const maxRetries = Number(arg("--retries") ?? 0);

await startBridge({
  port,
  host,
  cwd,
  concurrency,
  maxRetries,
  codexCommand: process.env.UI_AGENT_CODEX_COMMAND,
  claudeCommand: process.env.UI_AGENT_CLAUDE_COMMAND
});

console.log(`ui-agent-locator bridge listening on http://${host}:${port}`);
