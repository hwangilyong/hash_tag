import type { Plugin } from "vite";
import { BridgeServer } from "./bridge.js";
import { injectSourceMetadata } from "./source-transform.js";
import type { LocatorPluginOptions } from "./types.js";

export function uiAgentLocator(options: LocatorPluginOptions = {}): Plugin {
  const enabled = options.enabled ?? true;
  const include = options.include ?? /\.[jt]sx$/;
  const exclude = options.exclude ?? /node_modules|dist|\.stories\.[jt]sx$/;
  let bridge: BridgeServer | undefined;

  return {
    name: "ui-agent-locator",
    apply: "serve",
    enforce: "pre",
    async configureServer(server) {
      if (!enabled || options.startBridge === false) return;
      bridge = new BridgeServer({ host: options.host, port: options.port, cwd: options.cwd, concurrency: options.concurrency, maxRetries: options.maxRetries, codexCommand: options.codexCommand, claudeCommand: options.claudeCommand });
      await bridge.start();
      server.httpServer?.once("close", () => void bridge?.stop());
    },
    transform(code, id) {
      if (!enabled || !include.test(id) || exclude.test(id)) return null;
      const transformed = injectSourceMetadata(code, id, { sourceAttribute: options.sourceAttribute, componentAttribute: options.componentAttribute });
      return transformed ? { code: transformed, map: null } : null;
    },
    transformIndexHtml() {
      if (!enabled) return [];
      const clientOptions = {
        bridgeUrl: options.bridgeUrl ?? `http://${options.host ?? "127.0.0.1"}:${options.port ?? 4317}`,
        provider: options.provider ?? "codex",
        activationKey: options.activationKey ?? "Alt",
        multiSelectKey: "Shift",
        demo: options.demo ?? false,
        maxSelections: options.maxSelections ?? 20
      };
      return [{ tag: "script", attrs: { type: "module" }, children: `import { installInspector } from "ui-agent-locator/client"; installInspector(${JSON.stringify(clientOptions)});`, injectTo: "body" }];
    }
  };
}

export default uiAgentLocator;
