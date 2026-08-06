import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";

import { BrowserAutomationService } from "../src/main/services/browser/BrowserAutomationService.ts";

class FakeDebugger extends EventEmitter {
  attached = false;
  commandHandler = null;

  attach() {
    this.attached = true;
  }

  detach() {
    this.attached = false;
  }

  isAttached() {
    return this.attached;
  }

  async sendCommand(method, params) {
    if (this.commandHandler) return this.commandHandler(method, params);
    return {};
  }
}

class FakeWebContents extends EventEmitter {
  debugger = new FakeDebugger();

  isDestroyed() {
    return false;
  }
}

test("Electron dialogs remain pending until trusted browser handling answers them", async () => {
  const contents = new FakeWebContents();
  let electronDefaultHandlerCalled = false;
  contents.on("-run-dialog", () => {
    electronDefaultHandlerCalled = true;
  });

  const snapshots = [];
  const automation = new BrowserAutomationService();
  await automation.register("tab-dialog", contents, 3, (dialog) => snapshots.push(dialog));

  let inputPending = false;
  let releaseInput = () => {};
  contents.debugger.commandHandler = (method) => {
    if (method !== "Input.dispatchMouseEvent") return {};
    inputPending = true;
    return new Promise((resolve) => {
      releaseInput = () => {
        inputPending = false;
        resolve({});
      };
    });
  };
  const session = automation.sessions.get("tab-dialog");
  const input = automation.commandAllowDialog(session, "Input.dispatchMouseEvent", { type: "mouseReleased" });

  let answer = null;
  contents.emit("-run-dialog", {
    dialogType: "prompt",
    messageText: "Name?",
    defaultPromptText: "Ada"
  }, (accept, promptText) => {
    answer = { accept, promptText };
    releaseInput();
  });

  assert.deepEqual(await input, { completed: false });

  assert.equal(electronDefaultHandlerCalled, false);
  assert.deepEqual(snapshots.at(-1), {
    tabId: "tab-dialog",
    type: "prompt",
    message: "Name?",
    defaultPrompt: "Ada",
    openedAt: snapshots.at(-1).openedAt
  });
  assert.equal(answer, null);

  await automation.handleDialog("tab-dialog", true, "Grace");
  assert.deepEqual(answer, { accept: true, promptText: "Grace" });
  assert.equal(inputPending, false);
  assert.equal(snapshots.at(-1), null);
  automation.unregister("tab-dialog");
});
