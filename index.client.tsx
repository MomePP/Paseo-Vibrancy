/**
 * Client entry: registers the Glass settings screen, applies the saved CSS
 * vars on load, and — per controller ruling R4 (the SDK's toast is a
 * component-only hook, not an imperative call from `contribute()`) — shows a
 * launch-time notice as a conditional sidebar item pointing at a surface
 * that renders the same Glass screen, instead of a toast.
 *
 * The check runs once per `contribute()` call. Both "Update & restart" and
 * "Rebuild & restart" (`client/GlassScreen.tsx`) restart Paseo, which
 * reloads every plugin and re-runs `contribute()` against the new build, so
 * a stale notice clears itself on the next launch rather than needing a
 * live subscription here.
 */

import type { PluginClientContext } from "@getpaseo/plugin/client";
import type { PluginCleanup } from "@getpaseo/plugin";

import { getGlassRpc, statusRpc } from "./shared/rpc.ts";
import type { GlassStatus } from "./shared/rpc.ts";
import { compareVersions } from "./shared/version.ts";
import { applyGlassCss } from "./client/glass-css.ts";
import GlassScreen from "./client/GlassScreen.tsx";

const UPDATE_SURFACE_ID = "glass-update";

function updateNoticeTitle(status: GlassStatus): string | null {
  if (status.latest !== null && status.runningVersion !== null) {
    if (compareVersions(status.latest.version, status.runningVersion) > 0) {
      return `Paseo ${status.latest.version} available`;
    }
  }
  if (status.runningGlassBuild && !status.fingerprintMatches) {
    return "Glass rebuild needed";
  }
  return null;
}

export default function contribute(client: PluginClientContext): PluginCleanup {
  const settingsCleanup = client.addSettingsScreen({
    id: "glass",
    title: "Glass",
    icon: "Sparkles",
    Component: GlassScreen,
  });

  let updateCleanup: PluginCleanup | null = null;

  client
    .rpc(getGlassRpc, {})
    .then(applyGlassCss)
    .catch(() => {});

  client
    .rpc(statusRpc, {})
    .then((status) => {
      const title = updateNoticeTitle(status);
      if (title === null) {
        return;
      }
      const surfaceCleanup = client.addSurface(UPDATE_SURFACE_ID, GlassScreen);
      const sidebarCleanup = client.addSidebarItem({
        id: UPDATE_SURFACE_ID,
        title,
        icon: "Sparkles",
        surface: UPDATE_SURFACE_ID,
      });
      updateCleanup = () => {
        sidebarCleanup();
        surfaceCleanup();
      };
    })
    .catch(() => {});

  return () => {
    updateCleanup?.();
    settingsCleanup();
  };
}
