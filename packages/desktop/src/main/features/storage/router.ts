import { storageContract } from "../../../shared/features/storage/contract";
import { defineRouter } from "../../core/router-factory";

const { os } = defineRouter({
  contract: { storage: storageContract },
  debugNs: "neovate:storage",
});

export const storageRouter = os.storage.router({
  get: os.storage.get.handler(({ input, context }) => {
    return context.storage.scoped(input.namespace).get(input.key, input.defaultValue);
  }),

  set: os.storage.set.handler(({ input, context }) => {
    context.storage.scoped(input.namespace).set(input.key, input.value);
  }),

  shallowMerge: os.storage.shallowMerge.handler(({ input, context }) => {
    context.storage.scoped(input.namespace).set(input.object);
  }),

  has: os.storage.has.handler(({ input, context }) => {
    return context.storage.scoped(input.namespace).has(input.key);
  }),

  delete: os.storage.delete.handler(({ input, context }) => {
    context.storage.scoped(input.namespace).delete(input.key);
  }),

  appendToArray: os.storage.appendToArray.handler(({ input, context }) => {
    context.storage.scoped(input.namespace).appendToArray(input.key, input.value);
  }),

  getAll: os.storage.getAll.handler(({ input, context }) => {
    return context.storage.scoped(input.namespace).store;
  }),
});
