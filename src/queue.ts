import { EventEmitter } from "node:events";
import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { executeWithAdapter } from "./adapters.js";
import type { AiJob, AiJobRequest, BridgeOptions } from "./types.js";

export class JobQueue extends EventEmitter {
  private jobs = new Map<string, AiJob>();
  private pending: string[] = [];
  private fileLocks = new Map<string, string>();
  private processes = new Map<string, ChildProcessWithoutNullStreams>();
  private contextCache = new Map<string, unknown>();
  private active = 0;

  constructor(private options: BridgeOptions = {}) { super(); }

  enqueue(request: AiJobRequest): AiJob {
    const lockedFiles = [...new Set(request.selections.map((s) => s.source.file))];
    const job: AiJob = { ...request, id: crypto.randomUUID(), status: "queued", attempts: 0, createdAt: new Date().toISOString(), lockedFiles };
    this.jobs.set(job.id, job);
    this.pending.push(job.id);
    this.tick();
    return structuredClone(job);
  }

  list(): AiJob[] { return [...this.jobs.values()].map((job) => structuredClone(job)); }
  get(id: string): AiJob | undefined { const job = this.jobs.get(id); return job ? structuredClone(job) : undefined; }

  retry(id: string): AiJob | undefined {
    const job = this.jobs.get(id);
    if (!job || job.status === "running") return undefined;
    this.pending = this.pending.filter((jobId) => jobId !== id);
    job.status = "queued";
    job.error = undefined;
    job.output = undefined;
    job.finishedAt = undefined;
    this.pending.push(id);
    this.tick();
    return structuredClone(job);
  }

  cancel(id: string): AiJob | undefined {
    const job = this.jobs.get(id);
    if (!job) return undefined;
    this.pending = this.pending.filter((jobId) => jobId !== id);
    job.status = "cancelled";
    job.finishedAt = new Date().toISOString();
    this.processes.get(id)?.kill("SIGTERM");
    if (!this.processes.has(id)) this.releaseLocks(job);
    this.emit("job", structuredClone(job));
    queueMicrotask(() => this.tick());
    return structuredClone(job);
  }

  delete(id: string): boolean {
    const job = this.jobs.get(id);
    if (!job || job.status === "running") return false;
    this.pending = this.pending.filter((jobId) => jobId !== id);
    return this.jobs.delete(id);
  }

  resetCache() { this.contextCache.clear(); }

  private canLock(job: AiJob): boolean {
    return job.lockedFiles.every((file) => !this.fileLocks.has(file) || this.fileLocks.get(file) === job.id);
  }
  private acquireLocks(job: AiJob) { for (const file of job.lockedFiles) this.fileLocks.set(file, job.id); }
  private releaseLocks(job: AiJob) { for (const file of job.lockedFiles) if (this.fileLocks.get(file) === job.id) this.fileLocks.delete(file); }

  private tick() {
    const concurrency = Math.max(1, this.options.concurrency ?? 1);
    for (const id of this.pending) {
      const candidate = this.jobs.get(id);
      if (candidate && candidate.status === "blocked" && this.canLock(candidate)) candidate.status = "queued";
    }

    while (this.active < concurrency) {
      const index = this.pending.findIndex((id) => {
        const job = this.jobs.get(id);
        return Boolean(job && job.status !== "cancelled" && this.canLock(job));
      });
      if (index < 0) {
        for (const id of this.pending) {
          const blocked = this.jobs.get(id);
          if (blocked && blocked.status === "queued") blocked.status = "blocked";
        }
        return;
      }

      const [id] = this.pending.splice(index, 1);
      const job = this.jobs.get(id);
      if (!job || job.status === "cancelled") continue;
      void this.run(job);
    }
  }

  private async run(job: AiJob) {
    this.active += 1;
    this.acquireLocks(job);
    job.status = "running";
    job.attempts += 1;
    job.startedAt = new Date().toISOString();
    job.finishedAt = undefined;
    this.emit("job", structuredClone(job));

    try {
      const running = executeWithAdapter(job.provider, job, this.options);
      this.processes.set(job.id, running.process);
      const output = await running.result;
      if (job.status !== "cancelled") {
        job.output = output;
        job.status = "succeeded";
      }
    } catch (error) {
      if (job.status !== "cancelled") {
        job.error = error instanceof Error ? error.message : String(error);
        const maxRetries = this.options.maxRetries ?? 0;
        if (job.attempts <= maxRetries) {
          job.status = "queued";
          this.pending.push(job.id);
        } else {
          job.status = "failed";
        }
      }
    } finally {
      this.processes.delete(job.id);
      this.releaseLocks(job);
      if (job.status !== "queued") job.finishedAt = new Date().toISOString();
      this.active -= 1;
      this.emit("job", structuredClone(job));
      queueMicrotask(() => this.tick());
    }
  }
}
