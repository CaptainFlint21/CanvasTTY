import { randomUUID } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { BrowserActor, BrowserCommand, BrowserElementRef, BrowserResult } from "../../../shared/contracts.ts";
import type { BrowserService } from "../BrowserService.ts";

const READY_TIMEOUT_MS = 12_000;
const SENTINEL = "canvastty-secret-must-not-leak";

export async function runBrowserElectronSmoke(
  service: BrowserService,
  origin: string,
  userDataPath: string
): Promise<void> {
  const parsedOrigin = new URL(origin);
  if (parsedOrigin.protocol !== "http:" || parsedOrigin.hostname !== "127.0.0.1") {
    throw new Error("Browser smoke fixture must be an HTTP loopback origin.");
  }
  const uploadPath = join(userDataPath, "fixture-upload.txt");
  await writeFile(uploadPath, "CanvasTTY upload fixture", { mode: 0o600 });
  service.setViewport({ x: 0, y: 0, width: 820, height: 620, visible: true, canvasScale: 1 });

  const actor: Extract<BrowserActor, { kind: "agent" }> = {
    kind: "agent",
    agentId: "electron-smoke-agent",
    provider: "codex",
    terminalSessionId: "electron-smoke-terminal",
    connectionId: "electron-smoke-connection",
    cwd: userDataPath
  };
  service.core.agentConnected(actor);
  let request = 0;
  const execute = async <T = unknown>(
    type: BrowserCommand["type"],
    args: Omit<BrowserCommand, "type" | "requestId"> = {}
  ): Promise<BrowserResult<T>> => {
    console.log(`CANVASTTY_BROWSER_SMOKE_STEP ${request + 1} ${type}`);
    const result = await service.core.execute(actor, {
      type,
      requestId: `electron-smoke-${++request}`,
      timeoutMs: 5_000,
      ...args
    });
    if (!result.ok) throw new Error(`${type} failed: ${JSON.stringify(result.error)}`);
    return result as BrowserResult<T>;
  };

  try {
    const opened = await execute("browser_new_tab", { url: `${origin}/` });
    const tabId = opened.tabId;
    if (!tabId) throw new Error("Browser smoke did not create a tab.");
    await execute("browser_list_tabs");
    await waitUntil(async () => service.getState().tabs.find((tab) => tab.id === tabId)?.status === "ready");

    const observed = await execute<{
      elements: Array<{ name: string; value?: string | null; ref: BrowserElementRef }>;
    }>("browser_observe", { tabId, limit: 200 });
    const elements = observed.data?.elements ?? [];
    const password = elements.find((element) => element.name === "Password");
    if (!password || password.value?.includes(SENTINEL)) {
      throw new Error("Password value leaked through browser_observe.");
    }
    const byName = (name: string): BrowserElementRef => {
      const element = elements.find((candidate) => candidate.name === name);
      if (!element) throw new Error(`Missing observed element: ${name}`);
      return element.ref;
    };
    const messageRef = byName("Message");
    const submitRef = byName("Submit");
    const selectRef = byName("Mode");
    const uploadRef = byName("Upload file");
    const dragSourceRef = byName("Drag source");
    const dragTargetRef = byName("Drag target");

    await execute("browser_hover", { tabId, ref: submitRef });
    await execute("browser_type", { tabId, ref: messageRef, text: "hello from agent" });
    await execute("browser_select", { tabId, ref: selectRef, values: ["safe"] });
    await execute("browser_upload", { tabId, ref: uploadRef, paths: [uploadPath] });
    await execute("browser_drag", {
      tabId,
      ref: dragSourceRef,
      targetRef: dragTargetRef,
      timeoutMs: 12_000
    });
    await execute("browser_wait_for", {
      tabId,
      condition: "text",
      value: "Drag completed",
      timeoutMs: 4_000
    });
    await execute("browser_click", { tabId, ref: submitRef });
    await execute("browser_wait_for", {
      tabId,
      condition: "text",
      value: "Submitted: hello from agent / safe",
      timeoutMs: 4_000
    });

    const page = await execute<{ text: string }>("browser_read_page", { tabId, limit: 500 });
    if (!page.data?.text.includes("Submitted: hello from agent / safe")) {
      throw new Error("Browser read_page missed the submitted fixture state.");
    }
    if (!page.data.text.includes("fixture-upload.txt")) {
      throw new Error("Browser upload did not reach the page file input.");
    }
    if (page.data.text.includes(SENTINEL)) throw new Error("Password value leaked through read_page.");
    const shot = await execute<{ mimeType: string; base64: string }>("browser_screenshot", { tabId });
    const screenshotBytes = Buffer.from(shot.data?.base64 ?? "", "base64").byteLength;
    if (!/^image\/(?:png|jpeg)$/.test(shot.data?.mimeType ?? "")
      || screenshotBytes < 1_000 || screenshotBytes > 340 * 1024) {
      throw new Error("Browser screenshot result is invalid.");
    }

    const dialogObservation = await execute<{
      elements: Array<{ name: string; ref: BrowserElementRef }>;
    }>("browser_observe", { tabId, limit: 200 });
    const alertRef = dialogObservation.data?.elements.find((element) => element.name === "Open dialog")?.ref;
    if (!alertRef) throw new Error("Dialog fixture was not observed.");
    await execute("browser_click", { tabId, ref: alertRef });
    await waitUntil(async () => service.getState().pendingDialog?.tabId === tabId);
    const pendingDialog = service.getState().pendingDialog;
    if (pendingDialog?.type !== "alert" || pendingDialog.message !== "CanvasTTY dialog fixture") {
      throw new Error(`Browser dialog metadata is invalid: ${JSON.stringify(pendingDialog)}`);
    }
    await execute("browser_handle_dialog", { tabId, accept: true });
    await execute("browser_wait_for", {
      tabId,
      condition: "text",
      value: "Dialog handled",
      timeoutMs: 4_000
    });

    const popupObservation = await execute<{
      elements: Array<{ name: string; ref: BrowserElementRef }>;
    }>("browser_observe", { tabId, limit: 200 });
    const popupRef = popupObservation.data?.elements.find((element) => element.name === "Open popup")?.ref;
    if (!popupRef) throw new Error("Popup fixture was not observed.");
    await execute("browser_click", { tabId, ref: popupRef });
    await waitUntil(async () => service.getState().tabs.length === 2);
    const popupTab = service.getState().tabs.find((tab) => tab.id !== tabId);
    if (!popupTab) throw new Error("Browser popup tab was not adopted by the browser core.");
    await waitUntil(async () => service.getState().tabs.find((tab) => tab.id === popupTab.id)?.status === "ready");
    const popupPage = await execute<{ text: string }>("browser_read_page", { tabId: popupTab.id, limit: 100 });
    if (!popupPage.data?.text.includes("Popup ready")) throw new Error("Browser popup content was not readable.");

    await execute("browser_activate_tab", { tabId });
    const downloadObservation = await execute<{
      elements: Array<{ name: string; ref: BrowserElementRef }>;
    }>("browser_observe", { tabId, limit: 200 });
    const downloadRef = downloadObservation.data?.elements.find(
      (element) => element.name === "Download fixture"
    )?.ref;
    if (!downloadRef) throw new Error("Download fixture was not observed.");
    await execute("browser_click", { tabId, ref: downloadRef });
    const download = await execute<{ status: string; fileName: string; savePath: string }>(
      "browser_download_wait",
      { tabId, timeoutMs: 5_000 }
    );
    if (download.data?.status !== "completed") throw new Error("Browser download did not complete.");
    if (download.data.fileName !== "fixture.txt"
      || await readFile(download.data.savePath, "utf8") !== "CanvasTTY download fixture") {
      throw new Error("Browser download contents are invalid.");
    }

    // Exercise wheel input after all ref-based controls have been used. Cached
    // refs deliberately keep their document identity, not a scroll-position lock.
    await execute("browser_scroll", { tabId, direction: "down" });
    await execute("browser_wait_for", {
      tabId,
      condition: "text",
      value: "Scroll completed",
      timeoutMs: 4_000
    });
    await execute("browser_scroll", { tabId, direction: "up" });

    await execute("browser_navigate", {
      tabId,
      url: `${origin}/next?q=visible&access_token=${SENTINEL}#fragment`
    });
    await waitUntil(async () => Boolean(
      service.getState().tabs.find((tab) => tab.id === tabId)?.url.includes("/next")
    ));
    const tabs = await execute<{ tabs: Array<{ id: string; url: string }> }>("browser_list_tabs");
    const safeUrl = tabs.data?.tabs.find((tab) => tab.id === tabId)?.url ?? "";
    if (safeUrl !== `${origin}/next`) {
      throw new Error(`Agent tab URL was not sanitized: ${safeUrl}`);
    }

    const stale = await service.core.execute(actor, {
      type: "browser_click",
      requestId: randomUUID(),
      tabId,
      ref: submitRef
    });
    if (stale.ok || stale.error?.code !== "STALE_REF") {
      throw new Error(`Old element reference was not rejected: ${JSON.stringify(stale)}`);
    }
  } finally {
    service.core.agentDisconnected(actor);
  }
}

async function waitUntil(check: () => Promise<boolean>): Promise<void> {
  const deadline = Date.now() + READY_TIMEOUT_MS;
  let lastError: unknown;
  while (Date.now() < deadline) {
    try {
      if (await check()) return;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  if (lastError instanceof Error) throw lastError;
  throw new Error(`Browser fixture did not reach the expected state in ${READY_TIMEOUT_MS} ms.`);
}
