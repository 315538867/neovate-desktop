import { BrowserWindow, dialog } from "electron";

import { electronContract } from "../../../shared/features/electron/contract";
import { defineRouter } from "../../core/router-factory";

const { os, log } = defineRouter({
  contract: { electron: electronContract },
  debugNs: "neovate:electron",
});

export const electronRouter = os.electron.router({
  dialog: os.electron.dialog.router({
    showOpenDialog: os.electron.dialog.showOpenDialog.handler(async ({ input }) => {
      log("dialog.showOpenDialog", input);
      const win = BrowserWindow.getFocusedWindow();
      const result = win
        ? await dialog.showOpenDialog(win, input)
        : await dialog.showOpenDialog(input);
      log("dialog.showOpenDialog result", {
        canceled: result.canceled,
        count: result.filePaths.length,
      });
      return result;
    }),
  }),
  window: os.electron.window.router({
    isFullScreen: os.electron.window.isFullScreen.handler(({ context }) => {
      const win = context.mainApp.windowManager.mainWindow;
      return win?.isFullScreen() ?? false;
    }),
  }),
});
