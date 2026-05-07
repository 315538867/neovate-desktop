import { stateContract } from "../../../shared/features/state/contract";
import { defineRouter } from "../../core/router-factory";

const { os } = defineRouter({
  contract: { state: stateContract },
  debugNs: "neovate:state",
});

export const stateRouter = os.state.router({
  load: os.state.load.handler(({ input, context }) => {
    return context.stateStore.load(input.key);
  }),

  save: os.state.save.handler(({ input, context }) => {
    context.stateStore.save(input.key, input.data);
  }),
});
