import { app } from "electron";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

import { updaterContract } from "../../../shared/features/updater/contract";
import { defineRouter } from "../../core/router-factory";

const require = createRequire(import.meta.url);

const { os, log } = defineRouter({
  contract: { updater: updaterContract },
  debugNs: "neovate:updater",
});

export const updaterRouter = os.updater.router({
  check: os.updater.check.handler(({ context }) => {
    log("check handler");
    context.updaterService.check(true);
  }),

  install: os.updater.install.handler(({ context }) => {
    log("install handler");
    context.updaterService.install();
  }),

  getVersion: os.updater.getVersion.handler(() => app.getVersion()),

  getClaudeCodeSDKVersion: os.updater.getClaudeCodeSDKVersion.handler(() => {
    const sdkDir = path.dirname(require.resolve("@anthropic-ai/claude-agent-sdk"));
    const pkg = JSON.parse(readFileSync(path.join(sdkDir, "package.json"), "utf8"));
    return pkg.version;
  }),

  subscribe: os.updater.subscribe.handler(async function* ({ signal, context }) {
    yield context.updaterService.state;
    for await (const s of context.updaterService.publisher.subscribe("state", { signal })) {
      yield s;
    }
  }),
});
