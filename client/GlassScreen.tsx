/**
 * Settings → Glass. Appearance edits `GlassSettings` live (CSS applied
 * immediately, `setGlassRpc` debounced 150ms so dragging a slider doesn't
 * flood the server). Build reports the running/built-from/latest versions
 * and drives rebuild/update, both of which restart Paseo.
 *
 * Also mounted (via `index.client.tsx`'s conditional `addSurface`) as the
 * launch-time "update available" / "rebuild needed" sidebar surface — same
 * component, same `PluginSurfaceProps` shape, so both call sites render the
 * full screen rather than a trimmed-down notice.
 */

import { useEffect, useRef, useState } from "react";
import { Text, View } from "react-native";

import type { PluginSurfaceProps } from "@getpaseo/plugin/client";
import { useRpc } from "@getpaseo/plugin/client";
import {
  SettingsAction,
  SettingsCard,
  SettingsRow,
  SettingsSection,
  SettingsSelect,
  SettingsSwitch,
} from "@getpaseo/plugin/client/ui";
import { useToast } from "@getpaseo/plugin/client/react-native";

import { GLASS_DEFAULTS, MATERIALS } from "../shared/glass.ts";
import type { GlassSettings } from "../shared/glass.ts";
import { buildRpc, checkUpdateRpc, getGlassRpc, setGlassRpc, statusRpc } from "../shared/rpc.ts";
import type { GlassStatus } from "../shared/rpc.ts";
import { compareVersions } from "../shared/version.ts";
import { applyGlassCss } from "./glass-css.ts";
import RangeRow from "./RangeRow.tsx";

const SET_GLASS_DEBOUNCE_MS = 150;

/** `0-60` for the blur slider's native-platform fallback (discrete steps). */
const BLUR_STEPS = [0, 10, 20, 30, 40, 50, 60];
/** `0-100%` for the tint slider's native-platform fallback. */
const TINT_STEPS = [0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100];

const MATERIAL_OPTIONS = MATERIALS.map((material) => ({
  // "under-window" -> "Under Window": humanize the hyphenated material id.
  label: material
    .split("-")
    .map((word) => word[0]!.toUpperCase() + word.slice(1))
    .join(" "),
  value: material,
}));

export default function GlassScreen({ theme, layout }: PluginSurfaceProps) {
  const toast = useToast();
  const getGlass = useRpc(getGlassRpc);
  const setGlass = useRpc(setGlassRpc);
  const fetchStatus = useRpc(statusRpc);
  const checkUpdate = useRpc(checkUpdateRpc);
  const build = useRpc(buildRpc);

  const [settings, setSettings] = useState<GlassSettings>({ ...GLASS_DEFAULTS });
  const [settingsLoaded, setSettingsLoaded] = useState(false);
  const [status, setStatus] = useState<GlassStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  /** The most recently edited settings not yet confirmed saved; flushed on unmount. */
  const pendingRef = useRef<GlassSettings | null>(null);

  const refreshStatus = () => {
    fetchStatus({})
      .then(setStatus)
      .catch((error: unknown) => {
        toast.error(error instanceof Error ? error.message : "Failed to load Glass status");
      });
  };

  useEffect(() => {
    getGlass({})
      .then((loaded) => {
        setSettings(loaded);
        setSettingsLoaded(true);
        applyGlassCss(loaded);
      })
      .catch((error: unknown) => {
        toast.error(error instanceof Error ? error.message : "Failed to load Glass settings");
      });
    refreshStatus();
    return () => {
      clearTimeout(debounceRef.current);
      const pending = pendingRef.current;
      pendingRef.current = null;
      if (pending) {
        setGlass(pending).catch((error: unknown) => {
          console.error("[glass] failed to flush glass settings on unmount", error);
        });
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function updateSettings(next: GlassSettings) {
    setSettings(next);
    applyGlassCss(next);
    pendingRef.current = next;
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      const toSave = pendingRef.current;
      pendingRef.current = null;
      if (toSave) {
        setGlass(toSave).catch((error: unknown) => {
          toast.error(error instanceof Error ? error.message : "Failed to save glass settings");
        });
      }
    }, SET_GLASS_DEBOUNCE_MS);
  }

  async function runBuild(input: { version?: string; restart: boolean }, successMessage: string) {
    setBusy(true);
    try {
      const result = await build(input);
      if (result.error) {
        toast.error(result.error);
      } else if (result.ok) {
        toast.show(successMessage);
      }
      refreshStatus();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Build failed");
    } finally {
      setBusy(false);
    }
  }

  async function onCheckUpdate() {
    setBusy(true);
    try {
      const result = await checkUpdate({});
      if (result.error) {
        toast.error(result.error);
      } else if (result.release) {
        toast.show(`Paseo ${result.release.version} is the latest release`);
      } else {
        toast.show("No release found");
      }
      refreshStatus();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Check failed");
    } finally {
      setBusy(false);
    }
  }

  const isWeb = layout.platform === "web";
  const runningGlassBuild = status?.runningGlassBuild ?? false;
  const appearanceDisabled = !settingsLoaded || !runningGlassBuild || busy;
  const blurDisabled = appearanceDisabled || settings.material !== "none";
  const latest = status?.latest ?? null;
  const updateAvailable =
    latest !== null && status?.runningVersion != null && compareVersions(latest.version, status.runningVersion) > 0;

  return (
    <SettingsSection title="Glass">
      <SettingsCard>
        {!runningGlassBuild && (
          <SettingsRow label="Not running the Glass build" hint="Rebuild below to enable live appearance controls." />
        )}
        <SettingsSelect
          label="Material"
          value={settings.material}
          options={MATERIAL_OPTIONS}
          onValueChange={(material) => updateSettings({ ...settings, material })}
          disabled={appearanceDisabled}
        />
        {isWeb ? (
          <RangeRow
            label="Blur radius"
            value={settings.blurRadius}
            min={0}
            max={60}
            step={1}
            disabled={blurDisabled}
            theme={theme}
            onChange={(blurRadius) => updateSettings({ ...settings, blurRadius })}
          />
        ) : (
          <SettingsSelect
            label="Blur radius"
            value={String(settings.blurRadius)}
            options={BLUR_STEPS.map((n) => ({ label: String(n), value: String(n) }))}
            onValueChange={(v) => updateSettings({ ...settings, blurRadius: Number(v) })}
            disabled={blurDisabled}
          />
        )}
        {isWeb ? (
          <RangeRow
            label="Tint"
            value={Math.round(settings.tint * 100)}
            min={0}
            max={100}
            step={1}
            disabled={appearanceDisabled}
            theme={theme}
            format={(pct) => `${pct}%`}
            onChange={(pct) => updateSettings({ ...settings, tint: pct / 100 })}
          />
        ) : (
          <SettingsSelect
            label="Tint"
            value={String(Math.round(settings.tint * 100))}
            options={TINT_STEPS.map((n) => ({ label: `${n}%`, value: String(n) }))}
            onValueChange={(v) => updateSettings({ ...settings, tint: Number(v) / 100 })}
            disabled={appearanceDisabled}
          />
        )}
        <SettingsSwitch
          label="Main pane glass"
          value={settings.paneGlass}
          onValueChange={(paneGlass) => updateSettings({ ...settings, paneGlass })}
          disabled={appearanceDisabled}
        />
      </SettingsCard>

      <SettingsCard>
        <SettingsRow label="Running version" hint={status?.runningVersion ?? "Unknown"} />
        <SettingsRow label="Built from" hint={status?.builtFrom ?? "Not a Glass build"} />
        <SettingsRow label="Latest release" hint={latest?.version ?? "Unknown"} />
        {status && status.lastReport.length > 0 && (
          <SettingsRow label="Last build report">
            <View>
              {status.lastReport.map((line, index) => (
                <Text
                  key={index}
                  style={{
                    color: line.startsWith("MISSED") ? theme.colors.statusDanger : theme.colors.foreground,
                  }}
                >
                  {line}
                </Text>
              ))}
            </View>
          </SettingsRow>
        )}
        <SettingsAction
          label="Check for updates"
          actionLabel="Check"
          onPress={onCheckUpdate}
          disabled={busy || status?.building}
        />
        {updateAvailable && latest && (
          <SettingsAction
            label="Update & restart"
            hint={`Downloads and builds Paseo ${latest.version}`}
            actionLabel="Update & restart"
            onPress={() => runBuild({ version: latest.version, restart: true }, `Updated to ${latest.version}`)}
            disabled={busy || status?.building}
          />
        )}
        <SettingsAction
          label="Rebuild & restart"
          hint="Restarts Paseo and interrupts running agents"
          actionLabel="Rebuild & restart"
          onPress={() => runBuild({ restart: true }, "Rebuilt the Glass copy")}
          disabled={busy || status?.building}
        />
      </SettingsCard>
    </SettingsSection>
  );
}
