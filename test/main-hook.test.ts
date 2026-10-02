import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync, readFileSync, watch } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname, basename } from "node:path";
import vm from "node:vm";

import { PG_JS } from "../server/main-hook.ts";

type Listener = (...args: unknown[]) => void;

interface FakeWindow {
  setVibrancy: (material: string | null) => void;
  getNativeWindowHandle: () => Buffer;
  vibrancyCalls: Array<string | null>;
  on: (event: string, listener: Listener) => void;
  fireShow: () => void;
}

interface BlurCall {
  handle: Buffer;
  radius: number;
}

interface Sandbox {
  windows: FakeWindow[];
  blurCalls: BlurCall[];
  createdListeners: Listener[];
  module: { exports: unknown };
  fireBrowserWindowCreated: (win: FakeWindow) => void;
}

function makeWindow(): FakeWindow {
  const showListeners: Listener[] = [];
  const win: FakeWindow = {
    vibrancyCalls: [],
    setVibrancy: (material) => win.vibrancyCalls.push(material),
    getNativeWindowHandle: () => Buffer.alloc(8),
    on: (event, listener) => {
      if (event === "show") {
        showListeners.push(listener);
      }
    },
    fireShow: () => {
      for (const listener of showListeners) {
        listener();
      }
    },
  };
  return win;
}

// Evaluates PG_JS in a fresh vm context against a real settings directory
// (real fs + real fs.watch, per the brief) with fake electron/process.dlopen.
function loadPgJs(userDataDir: string): Sandbox {
  const windows: FakeWindow[] = [];
  const blurCalls: BlurCall[] = [];
  const createdListeners: Listener[] = [];

  const fakeElectron = {
    app: {
      getPath: (_name: string) => userDataDir,
      on: (event: string, listener: Listener) => {
        if (event === "browser-window-created") {
          createdListeners.push(listener);
        }
      },
    },
    BrowserWindow: {
      getAllWindows: () => windows,
    },
  };

  const fakeRequire = (name: string) => {
    if (name === "electron") return fakeElectron;
    if (name === "fs") return { readFileSync, watch };
    if (name === "path") return { join, dirname, basename };
    throw new Error(`unexpected require: ${name}`);
  };

  const fakeProcess = {
    dlopen: (addonModule: { exports: Record<string, unknown> }, _filename: string) => {
      addonModule.exports.setBlur = (handle: Buffer, radius: number) => {
        blurCalls.push({ handle, radius });
      };
    },
  };

  const moduleObj: { exports: unknown } = { exports: {} };
  const context = vm.createContext({
    module: moduleObj,
    exports: moduleObj.exports,
    require: fakeRequire,
    process: fakeProcess,
    __dirname: userDataDir,
    setTimeout,
    clearTimeout,
    console,
  });
  vm.runInContext(PG_JS, context);

  return {
    windows,
    blurCalls,
    createdListeners,
    module: moduleObj,
    fireBrowserWindowCreated: (win) => {
      windows.push(win);
      for (const listener of createdListeners) {
        listener({}, win);
      }
    },
  };
}

test("applies blur 30 with no material by default (no settings file)", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "glass-pg-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  const sandbox = loadPgJs(dir);
  const win = makeWindow();
  sandbox.fireBrowserWindowCreated(win);

  assert.deepEqual(win.vibrancyCalls, [null]);
  assert.equal(sandbox.blurCalls.at(-1)?.radius, 30);
});

test("re-applies glass when a window emits show (not yet ordered on screen at creation)", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "glass-pg-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  const sandbox = loadPgJs(dir);
  const win = makeWindow();
  sandbox.fireBrowserWindowCreated(win);
  sandbox.blurCalls.length = 0;
  win.vibrancyCalls.length = 0;

  win.fireShow();

  assert.deepEqual(win.vibrancyCalls, [null]);
  assert.equal(sandbox.blurCalls.at(-1)?.radius, 30);
});

test("material switches off blur", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "glass-pg-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  writeFileSync(join(dir, "paseo-glass.json"), JSON.stringify({ material: "hud" }));

  const sandbox = loadPgJs(dir);
  const win = makeWindow();
  sandbox.fireBrowserWindowCreated(win);

  assert.deepEqual(win.vibrancyCalls, ["hud"]);
  assert.equal(sandbox.blurCalls.at(-1)?.radius, 0);
});

test("corrupt settings file falls back to defaults", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "glass-pg-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  writeFileSync(join(dir, "paseo-glass.json"), "{nope");

  const sandbox = loadPgJs(dir);
  const win = makeWindow();
  sandbox.fireBrowserWindowCreated(win);

  assert.deepEqual(win.vibrancyCalls, [null]);
  assert.equal(sandbox.blurCalls.at(-1)?.radius, 30);
});

test("file change re-applies to open windows", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "glass-pg-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  const sandbox = loadPgJs(dir);
  const win = makeWindow();
  sandbox.fireBrowserWindowCreated(win);

  const settingsFile = join(dir, "paseo-glass.json");
  const payload = JSON.stringify({ material: "sidebar" });

  // Real waits (not fake timers): PG_JS's own fs.watch + 50 ms debounce run on
  // the host event loop inside a vm context we don't control the clock of, so
  // this polls for the real platform fs.watch -> setTimeout signal instead of
  // guessing a fixed duration. macOS's FSEvents-backed fs.watch can also miss
  // a write that lands before the watch stream has finished arming, so the
  // write is reissued every 200 ms until the effect is observed rather than
  // relying on the very first write landing.
  const deadline = Date.now() + 2000;
  let lastWriteAt = 0;
  while (win.vibrancyCalls.at(-1) !== "sidebar" && Date.now() < deadline) {
    if (Date.now() - lastWriteAt >= 200) {
      writeFileSync(settingsFile, payload);
      lastWriteAt = Date.now();
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }

  assert.equal(
    win.vibrancyCalls.at(-1),
    "sidebar",
    `timed out after 2s waiting for the debounced fs.watch re-apply; calls so far: ${JSON.stringify(win.vibrancyCalls)}`,
  );
});

test("module export is true", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "glass-pg-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  const sandbox = loadPgJs(dir);
  assert.equal(sandbox.module.exports, true);
});
