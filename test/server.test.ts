import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { BuildQueue, createHandlers } from "../index.server.ts";
import { readGlass, writeGlass } from "../server/glass-file.ts";
import { isGlassBuild, runningBundle } from "../server/status.ts";
import { GLASS_DEFAULTS } from "../shared/glass.ts";

test("writeGlass then readGlass round-trips", () => {
  const dir = mkdtempSync(join(tmpdir(), "glass-file-"));
  const file = join(dir, "paseo-glass.json");
  try {
    const settings = { material: "hud" as const, blurRadius: 12, tint: 0.4, paneGlass: false };
    writeGlass(settings, file);
    assert.deepEqual(readGlass(file), settings);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("readGlass on missing file falls back to defaults", () => {
  const dir = mkdtempSync(join(tmpdir(), "glass-file-"));
  try {
    assert.deepEqual(readGlass(join(dir, "missing.json")), GLASS_DEFAULTS);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("runningBundle resolves the outermost .app, not a nested helper", () => {
  const execPath = "/Users/x/Applications/Paseo-Vibrancy.app/Contents/Frameworks/Paseo Helper.app/Contents/MacOS/Paseo Helper";
  assert.equal(runningBundle(execPath), "/Users/x/Applications/Paseo-Vibrancy.app");
});

test("runningBundle returns null when no segment ends in .app", () => {
  assert.equal(runningBundle("/usr/local/bin/node"), null);
});

test("isGlassBuild is false for a dir without a stamp", () => {
  const dir = mkdtempSync(join(tmpdir(), "glass-bundle-"));
  try {
    mkdirSync(join(dir, "Contents", "Resources"), { recursive: true });
    assert.equal(isGlassBuild(dir), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("concurrent build is rejected", async () => {
  const queue = new BuildQueue();
  let release!: () => void;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  const first = queue.run(async () => {
    await pending;
    return "first";
  });
  await assert.rejects(() => queue.run(async () => "second"), /build already running/);
  release();
  assert.equal(await first, "first");
});

test("build handler reports a concurrent rejection instead of throwing", async () => {
  const dir = mkdtempSync(join(tmpdir(), "glass-handlers-"));
  try {
    let release!: () => void;
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    const handlers = createHandlers({
      glassFile: join(dir, "paseo-glass.json"),
      execPath: "/usr/local/bin/node",
      cachedPristine: () => join(dir, "pristine.app"),
      buildStaging: async () => {
        await pending;
        return { report: ["ok      fake"], missed: false };
      },
    });

    const inFlight = handlers.build({ version: "1.2.3", restart: false });
    const rejected = await handlers.build({ version: "1.2.3", restart: false });
    assert.equal(rejected.ok, false);
    assert.equal(rejected.error, "build already running");

    release();
    const result = await inFlight;
    assert.equal(result.ok, true);
    assert.deepEqual(result.report, ["ok      fake"]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("build handler reports a thrown error instead of letting it escape", async () => {
  const dir = mkdtempSync(join(tmpdir(), "glass-handlers-"));
  try {
    const handlers = createHandlers({
      glassFile: join(dir, "paseo-glass.json"),
      execPath: "/usr/local/bin/node",
      cachedPristine: () => join(dir, "pristine.app"),
      buildStaging: async () => {
        throw new Error("ditto failed");
      },
    });

    const result = await handlers.build({ version: "1.2.3", restart: false });
    assert.equal(result.ok, false);
    assert.equal(result.error, "ditto failed");
    assert.deepEqual(result.report, []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("build handler never restarts when restart is false, even with no running bundle", async () => {
  const dir = mkdtempSync(join(tmpdir(), "glass-handlers-"));
  try {
    let swapped = false;
    const handlers = createHandlers({
      glassFile: join(dir, "paseo-glass.json"),
      execPath: "/usr/local/bin/node",
      cachedPristine: () => join(dir, "pristine.app"),
      buildStaging: async () => ({ report: ["ok      fake"], missed: false }),
      startSwap: () => {
        swapped = true;
      },
    });

    const result = await handlers.build({ version: "1.2.3", restart: false });
    assert.equal(result.ok, true);
    assert.equal(swapped, false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("status reflects an injected non-glass running bundle", async () => {
  const dir = mkdtempSync(join(tmpdir(), "glass-handlers-"));
  try {
    const bundle = join(dir, "Paseo.app");
    mkdirSync(join(bundle, "Contents", "Resources"), { recursive: true });
    mkdirSync(join(bundle, "Contents", "MacOS"), { recursive: true });
    const plist = `<?xml version="1.0"?><plist><dict><key>CFBundleShortVersionString</key><string>1.2.3</string></dict></plist>`;
    writeFileSync(join(bundle, "Contents", "Info.plist"), plist, "utf8");

    const handlers = createHandlers({
      glassFile: join(dir, "paseo-glass.json"),
      execPath: join(bundle, "Contents", "MacOS", "Paseo"),
    });

    const status = await handlers.status();
    assert.equal(status.runningVersion, "1.2.3");
    assert.equal(status.runningGlassBuild, false);
    assert.equal(status.builtFrom, null);
    assert.equal(status.fingerprintMatches, false);
    assert.equal(status.building, false);
    assert.equal(status.latest, null);
    assert.deepEqual(status.lastReport, []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("getGlass/setGlass round-trip through the handlers", async () => {
  const dir = mkdtempSync(join(tmpdir(), "glass-handlers-"));
  try {
    const handlers = createHandlers({ glassFile: join(dir, "paseo-glass.json") });
    assert.deepEqual(await handlers.getGlass(), GLASS_DEFAULTS);

    const settings = { material: "sidebar" as const, blurRadius: 20, tint: 0.6, paneGlass: false };
    const written = await handlers.setGlass(settings);
    assert.deepEqual(written, settings);
    assert.deepEqual(await handlers.getGlass(), settings);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("checkUpdate handler records the release for status to report as latest", async () => {
  const dir = mkdtempSync(join(tmpdir(), "glass-handlers-"));
  try {
    const release = { version: "9.9.9", zipUrl: "https://example.com/x.zip", sha512: "abc", size: 1 };
    const handlers = createHandlers({
      glassFile: join(dir, "paseo-glass.json"),
      execPath: "/usr/local/bin/node",
      checkLatest: async () => ({ release, error: null }),
    });

    const result = await handlers.checkUpdate();
    assert.deepEqual(result, { release, error: null });
    assert.deepEqual((await handlers.status()).latest, release);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
