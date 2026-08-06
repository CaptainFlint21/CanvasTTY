import assert from "node:assert/strict";
import test from "node:test";
import { isAllowedBrowserUrl, normalizeBrowserInput } from "../src/main/services/browserUrl.ts";

test("normalizes browser addresses and search queries without allowing privileged schemes", () => {
  assert.equal(normalizeBrowserInput("example.com"), "https://example.com/");
  assert.equal(normalizeBrowserInput("http://localhost:3000/path"), "http://localhost:3000/path");
  assert.equal(normalizeBrowserInput("canvas tty plugins"), "https://duckduckgo.com/?q=canvas%20tty%20plugins");
  assert.equal(normalizeBrowserInput("file:///etc/passwd"), "https://duckduckgo.com/?q=file%3A%2F%2F%2Fetc%2Fpasswd");
  assert.equal(isAllowedBrowserUrl("https://example.com"), true);
  assert.equal(isAllowedBrowserUrl("http://example.com"), true);
  assert.equal(isAllowedBrowserUrl("javascript:alert(1)"), false);
});
