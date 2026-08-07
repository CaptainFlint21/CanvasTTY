import { BrowserWindow, ipcMain } from "electron";
import type { IpcMainInvokeEvent } from "electron";
import { ORCS_DESKTOP_IPC } from "../../shared/orcsBridge";
import type { OrcsDesktopClient } from "../services/OrcsDesktopClient";

interface OrcsIpcDependencies {
  client: OrcsDesktopClient;
  getMainWindow(): BrowserWindow | null;
}

export function registerOrcsIpc({ client, getMainWindow }: OrcsIpcDependencies): void {
  ipcMain.handle(ORCS_DESKTOP_IPC.snapshotGet, (event) => {
    assertTrustedRenderer(event, getMainWindow);
    return client.getSnapshot();
  });
}

function assertTrustedRenderer(
  event: IpcMainInvokeEvent,
  getMainWindow: () => BrowserWindow | null
): void {
  const expected = getMainWindow();
  if (
    !expected
    || expected.isDestroyed()
    || event.sender !== expected.webContents
    || event.senderFrame !== expected.webContents.mainFrame
  ) {
    throw new Error("ORCS IPC is available only to the trusted CanvasTTY renderer.");
  }
}
