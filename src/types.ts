export type AiProvider = "codex" | "claude";

export type JobStatus =
  | "queued"
  | "blocked"
  | "running"
  | "succeeded"
  | "failed"
  | "cancelled";

export interface SourceLocation {
  /** Absolute path after Bridge normalization. Browser payload may initially contain a repo-relative path. */
  file: string;
  /** Stable repo-relative display path preserved after Bridge normalization. */
  relativeFile?: string;
  line: number;
  column: number;
  component?: string;
  tag?: string;
}

export interface SelectionContext {
  id: string;
  source: SourceLocation;
  text?: string;
  role?: string;
  testId?: string;
  ancestry: SourceLocation[];
}

export interface AiJobRequest {
  provider: AiProvider;
  prompt: string;
  selections: SelectionContext[];
  notes?: string[];
  metadata?: Record<string, unknown>;
}

export interface AiJob extends AiJobRequest {
  id: string;
  status: JobStatus;
  attempts: number;
  createdAt: string;
  startedAt?: string;
  finishedAt?: string;
  error?: string;
  output?: string;
  lockedFiles: string[];
}

export interface InspectorOptions {
  bridgeUrl?: string;
  provider?: AiProvider;
  activationKey?: "Alt" | "Meta" | "Control";
  multiSelectKey?: "Shift";
  demo?: boolean;
  maxSelections?: number;
}

export interface BridgeOptions {
  host?: string;
  port?: number;
  cwd?: string;
  concurrency?: number;
  maxRetries?: number;
  codexCommand?: string;
  claudeCommand?: string;
}

export interface LocatorPluginOptions extends InspectorOptions, BridgeOptions {
  enabled?: boolean;
  include?: RegExp;
  exclude?: RegExp;
  startBridge?: boolean;
  sourceAttribute?: string;
  componentAttribute?: string;
}
