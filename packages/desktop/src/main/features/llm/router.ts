import { ORPCError } from "@orpc/server";

import { llmContract } from "../../../shared/features/llm/contract";
import { defineRouter } from "../../core/router-factory";

const { os, log } = defineRouter({
  contract: { llm: llmContract },
  debugNs: "neovate:llm",
  errorCode: "BAD_REQUEST",
});

function toORPCError(err: unknown): never {
  if (err instanceof ORPCError) throw err;
  const message = err instanceof Error ? err.message : String(err);
  log("handler error: %s", message);
  throw new ORPCError("BAD_REQUEST", { defined: true, message });
}

export const llmRouter = os.llm.router({
  isAvailable: os.llm.isAvailable.handler(async ({ context }) => {
    return { available: await context.llmService.isAvailable() };
  }),

  query: os.llm.query.handler(async ({ input, signal, context }) => {
    const { prompt, model, maxTokens, system, temperature } = input;
    try {
      const content = await context.llmService.query(prompt, {
        model,
        maxTokens,
        system,
        temperature,
        signal,
      });
      return { content };
    } catch (err) {
      toORPCError(err);
    }
  }),

  queryMessages: os.llm.queryMessages.handler(async ({ input, signal, context }) => {
    const { messages, model, maxTokens, system, temperature } = input;
    try {
      return await context.llmService.queryMessages(messages, {
        model,
        maxTokens,
        system,
        temperature,
        signal,
      });
    } catch (err) {
      toORPCError(err);
    }
  }),
});
