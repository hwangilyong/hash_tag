import { existsSync, realpathSync } from "node:fs";
import path from "node:path";
import type { SourceLocation } from "./types.js";

export function resolveProjectRoot(cwd?: string): string {
  const resolved = path.resolve(cwd ?? process.cwd());
  return existsSync(resolved) ? realpathSync.native(resolved) : resolved;
}

function isInsideRoot(root: string, target: string): boolean {
  const relative = path.relative(root, target);
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}

export function normalizeSourceLocation(location: SourceLocation, projectRoot: string): SourceLocation {
  const original = location.relativeFile ?? location.file;
  const withoutQuery = original.replace(/[?#].*$/, "");
  const resolved = path.isAbsolute(withoutQuery)
    ? path.normalize(withoutQuery)
    : path.resolve(projectRoot, withoutQuery);
  const absoluteFile = existsSync(resolved) ? realpathSync.native(resolved) : resolved;

  if (!isInsideRoot(projectRoot, absoluteFile)) {
    throw new Error(`Source path is outside project root: ${original}`);
  }

  const relativeFile = path.relative(projectRoot, absoluteFile).split(path.sep).join("/");

  return {
    ...location,
    file: absoluteFile,
    relativeFile
  };
}
