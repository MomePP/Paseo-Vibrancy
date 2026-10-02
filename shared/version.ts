/**
 * Semver-ish comparison (numeric prerelease parts compare numerically; a
 * release outranks any of its own prereleases:
 * `0.11.0-beta.3 < 0.11.0-beta.10 < 0.11.0`). The single canonical copy —
 * `server/release.ts` imports this rather than defining its own, and client
 * code imports it directly, since this file has no `node:` imports to leak
 * into the client bundle.
 */

function parseVersion(version: string): { main: number[]; pre: string[] | null } {
  const stripped = version.startsWith("v") ? version.slice(1) : version;
  const dash = stripped.indexOf("-");
  const mainStr = dash === -1 ? stripped : stripped.slice(0, dash);
  const preStr = dash === -1 ? null : stripped.slice(dash + 1);
  return {
    main: mainStr.split(".").map((n) => Number.parseInt(n, 10)),
    pre: preStr === null ? null : preStr.split("."),
  };
}

export function compareVersions(a: string, b: string): number {
  const pa = parseVersion(a);
  const pb = parseVersion(b);

  for (let i = 0; i < 3; i++) {
    const diff = (pa.main[i] ?? 0) - (pb.main[i] ?? 0);
    if (diff !== 0) return Math.sign(diff);
  }

  if (pa.pre === null && pb.pre === null) return 0;
  if (pa.pre === null) return 1;
  if (pb.pre === null) return -1;

  const len = Math.max(pa.pre.length, pb.pre.length);
  for (let i = 0; i < len; i++) {
    if (i >= pa.pre.length) return -1;
    if (i >= pb.pre.length) return 1;
    const x = pa.pre[i]!;
    const y = pb.pre[i]!;
    const xNum = /^\d+$/.test(x);
    const yNum = /^\d+$/.test(y);
    if (xNum && yNum) {
      const diff = Number.parseInt(x, 10) - Number.parseInt(y, 10);
      if (diff !== 0) return Math.sign(diff);
    } else if (xNum !== yNum) {
      return xNum ? -1 : 1;
    } else if (x !== y) {
      return x < y ? -1 : 1;
    }
  }
  return 0;
}
