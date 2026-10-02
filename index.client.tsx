/**
 * Client entry: registers the Vibrancy settings screen, applies the saved CSS
 * vars on load, and — since the SDK's toast is a component-only hook, not an
 * imperative call from `contribute()` — shows a
 * launch-time notice as a conditional sidebar item pointing at a surface
 * that renders the same Vibrancy screen, instead of a toast.
 *
 * The server's `latest` release is populated only by `checkUpdateRpc`
 * (`index.server.ts`'s in-memory `latest` starts `null`); nothing else polls
 * GitHub at startup, so `checkUpdateRpc` runs first here, then `statusRpc`
 * reads the now-populated field.
 *
 * This runs once per `contribute()` call. Both "Update & restart" and
 * "Rebuild & restart" (`client/VibrancyScreen.tsx`) restart Paseo, which
 * reloads every plugin and re-runs `contribute()` against the new build, so
 * a stale notice clears itself on the next launch rather than needing a
 * live subscription here.
 */

import type { PluginClientContext } from "@getpaseo/plugin/client";
import type { PluginCleanup } from "@getpaseo/plugin";

import { checkUpdateRpc, getSettingsRpc, statusRpc } from "./shared/rpc.ts";
import type { VibrancyStatus } from "./shared/rpc.ts";
import { compareVersions } from "./shared/version.ts";
import { applyVibrancyCss } from "./client/vibrancy-css.ts";
import VibrancyScreen from "./client/VibrancyScreen.tsx";

const UPDATE_SURFACE_ID = "vibrancy-update";

function updateNoticeTitle(status: VibrancyStatus): string | null {
  if (status.latest !== null && status.runningVersion !== null) {
    if (compareVersions(status.latest.version, status.runningVersion) > 0) {
      return `Paseo ${status.latest.version} available`;
    }
  }
  if (status.runningVibrancyBuild && !status.fingerprintMatches) {
    return "Vibrancy rebuild needed";
  }
  return null;
}

export default function contribute(client: PluginClientContext): PluginCleanup {
  const settingsCleanup = client.addSettingsScreen({
    id: "vibrancy",
    title: "Vibrancy",
    icon: "Sparkles",
    Component: VibrancyScreen,
  });

  let disposed = false;
  let updateCleanup: PluginCleanup | null = null;

  client
    .rpc(getSettingsRpc, {})
    .then((settings) => {
      if (!disposed) {
        applyVibrancyCss(settings);
      }
    })
    .catch((error: unknown) => {
      console.error("[vibrancy] getSettingsRpc failed on load", error);
    });

  client
    .rpc(checkUpdateRpc, {})
    .catch((error: unknown) => {
      console.error("[vibrancy] checkUpdateRpc failed on load", error);
    })
    .then(() => (disposed ? null : client.rpc(statusRpc, {})))
    .then((status) => {
      if (disposed || !status) {
        return;
      }
      const title = updateNoticeTitle(status);
      if (title === null) {
        return;
      }
      const surfaceCleanup = client.addScreen({ id: UPDATE_SURFACE_ID, title: "Vibrancy", Component: VibrancyScreen });
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
    .catch((error: unknown) => {
      console.error("[vibrancy] statusRpc failed on load", error);
    });

  return () => {
    disposed = true;
    updateCleanup?.();
    settingsCleanup();
  };
}
