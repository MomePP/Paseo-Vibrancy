import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

import {
  cachedPristine,
  checkLatest,
  compareVersions,
  downloadVerified,
  fetchRelease,
  parseMacYml,
  pickLatest,
  verifyPaseoSignature,
  type GithubRelease,
} from "../server/release.ts";
import type { Release } from "../shared/rpc.ts";

const execFileAsync = promisify(execFile);
const fixtureYml = readFileSync(
  join(fileURLToPath(new URL(".", import.meta.url)), "fixtures", "beta3-mac.yml"),
  "utf8",
);

test("compareVersions orders numeric prerelease parts and release over prerelease", () => {
  assert.ok(compareVersions("0.11.0-beta.3", "0.11.0-beta.10") < 0);
  assert.ok(compareVersions("0.11.0-beta.10", "0.11.0") < 0);
  assert.ok(compareVersions("0.11.0-beta.3", "0.11.0") < 0);
  assert.equal(compareVersions("0.11.0", "0.11.0"), 0);
});

test("pickLatest skips drafts and picks the highest version including prereleases", () => {
  const releases: GithubRelease[] = [
    { tag_name: "v0.11.0-beta.4", draft: true, prerelease: true },
    { tag_name: "v0.11.0-beta.3", draft: false, prerelease: true },
    { tag_name: "v0.10.2", draft: false, prerelease: false },
  ];
  assert.equal(pickLatest(releases)?.tag_name, "v0.11.0-beta.3");
});

test("pickLatest with only a draft returns null", () => {
  assert.equal(pickLatest([{ tag_name: "v0.11.0-beta.4", draft: true, prerelease: true }]), null);
});

test("parseMacYml finds the arm64 zip entry's size and sha512", () => {
  const release = parseMacYml(
    fixtureYml,
    "0.11.0-beta.3",
    "https://github.com/getpaseo/paseo/releases/download/v0.11.0-beta.3/Paseo-0.11.0-beta.3-arm64.zip",
  );
  assert.ok(release.zipUrl.endsWith("Paseo-0.11.0-beta.3-arm64.zip"));
  assert.equal(release.size, 179110962);
  assert.equal(release.sha512, "jYwoLTUDSifUiNcMtuyH5ya+25Carjzhyu3xkdct11tFZNd7+Biabi7D5beKXExlBNGJezxC7Fa4DZWYixQfIQ==");
});

test("checkLatest returns an error result on network failure, never throws", async () => {
  const result = await checkLatest({
    fetch: (() => Promise.reject(new Error("getaddrinfo ENOTFOUND"))) as typeof fetch,
  });
  assert.equal(result.release, null);
  assert.match(result.error ?? "", /ENOTFOUND/);
});

test("checkLatest resolves a release through the beta-mac.yml asset", async (t) => {
  const server = createServer((req, res) => {
    if (req.url === "/releases?per_page=20") {
      const body: GithubRelease[] = [
        {
          tag_name: "v0.11.0-beta.3",
          draft: false,
          prerelease: true,
          assets: [
            { name: "beta-mac.yml", browser_download_url: "http://ignored/beta-mac.yml" },
            { name: "Paseo-0.11.0-beta.3-arm64.zip", browser_download_url: "http://ignored/zip" },
          ],
        },
      ];
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify(body));
      return;
    }
    res.statusCode = 404;
    res.end("not found");
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => server.close());
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("expected AddressInfo");
  const apiUrl = `http://127.0.0.1:${address.port}/releases`;

  const fakeFetch = (async (input: string | URL, init?: RequestInit) => {
    const url = String(input);
    if (url === "http://ignored/beta-mac.yml") {
      return new Response(fixtureYml, { status: 200 });
    }
    return fetch(url, init);
  }) as typeof fetch;

  const result = await checkLatest({ fetch: fakeFetch, apiUrl });
  assert.equal(result.error, null);
  assert.equal(result.release?.version, "0.11.0-beta.3");
  assert.equal(result.release?.zipUrl, "http://ignored/zip");
  assert.equal(result.release?.size, 179110962);
});

test("fetchRelease fetches a single tagged release by version", async (t) => {
  const server = createServer((req, res) => {
    if (req.url === "/releases/tags/v0.11.0-beta.3") {
      const body: GithubRelease = {
        tag_name: "v0.11.0-beta.3",
        draft: false,
        prerelease: true,
        assets: [
          { name: "latest-mac.yml", browser_download_url: "http://ignored/latest-mac.yml" },
          { name: "Paseo-0.11.0-beta.3-arm64.zip", browser_download_url: "http://ignored/zip" },
        ],
      };
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify(body));
      return;
    }
    res.statusCode = 404;
    res.end("not found");
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => server.close());
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("expected AddressInfo");
  const apiUrl = `http://127.0.0.1:${address.port}/releases`;

  const fakeFetch = (async (input: string | URL, init?: RequestInit) => {
    const url = String(input);
    if (url === "http://ignored/latest-mac.yml") {
      return new Response(fixtureYml, { status: 200 });
    }
    return fetch(url, init);
  }) as typeof fetch;

  const release = await fetchRelease("0.11.0-beta.3", { fetch: fakeFetch, apiUrl });
  assert.equal(release.version, "0.11.0-beta.3");
  assert.equal(release.zipUrl, "http://ignored/zip");
});

test("verifyPaseoSignature rejects a non-Paseo (Apple-signed) app", async () => {
  await assert.rejects(() => verifyPaseoSignature("/System/Applications/Calculator.app"));
});

test("downloadVerified rejects a sha512 mismatch and leaves the cache dir empty", async (t) => {
  const srcDir = mkdtempSync(join(tmpdir(), "glass-release-src-"));
  t.after(() => rmSync(srcDir, { recursive: true, force: true }));
  writeFileSync(join(srcDir, "marker.txt"), "not a real app, just zip payload\n");

  const zipDir = mkdtempSync(join(tmpdir(), "glass-release-zip-"));
  t.after(() => rmSync(zipDir, { recursive: true, force: true }));
  const zipPath = join(zipDir, "Paseo-0.11.0-beta.3-arm64.zip");
  await execFileAsync("ditto", ["-c", "-k", "--sequesterRsrc", srcDir, zipPath]);
  const zipBytes = readFileSync(zipPath);

  const server = createServer((_req, res) => {
    res.setHeader("content-type", "application/zip");
    res.end(zipBytes);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => server.close());
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("expected AddressInfo");

  const cacheDir = mkdtempSync(join(tmpdir(), "glass-release-cache-"));
  t.after(() => rmSync(cacheDir, { recursive: true, force: true }));

  const release: Release = {
    version: "0.11.0-beta.3",
    zipUrl: `http://127.0.0.1:${address.port}/Paseo-0.11.0-beta.3-arm64.zip`,
    sha512: "not-the-real-hash==",
    size: zipBytes.length,
  };

  await assert.rejects(() => downloadVerified(release, cacheDir), /sha512 mismatch/);
  assert.deepEqual(readdirSync(cacheDir), []);
});

test("downloadVerified's post-download sweep removes only strictly-older pristine copies", async (t) => {
  const zipDir = mkdtempSync(join(tmpdir(), "glass-release-sweep-zip-"));
  t.after(() => rmSync(zipDir, { recursive: true, force: true }));
  const zipPath = join(zipDir, "Paseo-0.11.0-beta.3-arm64.zip");
  // Real, Apple/Developer-ID-signed app, zipped the way electron-builder's own
  // archiver does it (top-level `Paseo.app` entry) — nothing else can pass
  // verifyPaseoSignature's real `codesign` check.
  await execFileAsync("ditto", ["-c", "-k", "--keepParent", "--sequesterRsrc", "/Applications/Paseo.app", zipPath]);
  const zipBytes = readFileSync(zipPath);
  const sha512 = createHash("sha512").update(zipBytes).digest("base64");

  const server = createServer((_req, res) => {
    res.end(zipBytes);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => server.close());
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("expected AddressInfo");

  const cacheDir = mkdtempSync(join(tmpdir(), "glass-release-sweep-cache-"));
  t.after(() => rmSync(cacheDir, { recursive: true, force: true }));
  for (const version of ["0.11.0-beta.5", "0.11.0-beta.1"]) {
    const dir = join(cacheDir, `Paseo-${version}.app`);
    mkdirSync(dir);
    writeFileSync(join(dir, "marker"), version);
  }

  const release: Release = {
    version: "0.11.0-beta.3",
    zipUrl: `http://127.0.0.1:${address.port}/Paseo-0.11.0-beta.3-arm64.zip`,
    sha512,
    size: zipBytes.length,
  };

  const finalPath = await downloadVerified(release, cacheDir);
  assert.equal(finalPath, join(cacheDir, "Paseo-0.11.0-beta.3.app"));
  const entries = readdirSync(cacheDir).sort();
  assert.deepEqual(entries, ["Paseo-0.11.0-beta.3.app", "Paseo-0.11.0-beta.5.app"]);
});

test("cachedPristine returns null when no pristine copy exists and the path once one does", () => {
  const cacheDir = mkdtempSync(join(tmpdir(), "glass-release-cached-"));
  try {
    assert.equal(cachedPristine("0.11.0-beta.3", cacheDir), null);
    writeFileSync(join(cacheDir, "not-an-app"), "x");
    const appDir = join(cacheDir, "Paseo-0.11.0-beta.3.app");
    writeFileSync(join(cacheDir, "Paseo-0.11.0-beta.3.app-marker"), "x");
    // cachedPristine only checks existence of the exact app path.
    assert.equal(cachedPristine("0.11.0-beta.3", cacheDir), null);
    writeFileSync(appDir, "pretend-app");
    assert.equal(cachedPristine("0.11.0-beta.3", cacheDir), appDir);
  } finally {
    rmSync(cacheDir, { recursive: true, force: true });
  }
});
