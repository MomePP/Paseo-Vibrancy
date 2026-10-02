/**
 * The Vibrancy settings screen. Appearance edits `VibrancySettings` live (CSS applied
 * immediately, `setSettingsRpc` debounced 150ms so dragging a slider doesn't
 * flood the server). Build reports the running/built-from/latest versions
 * and drives rebuild/update, both of which restart Paseo.
 *
 * Also mounted (via `index.client.tsx`'s conditional `addScreen`) as the
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

import { VIBRANCY_DEFAULTS, MATERIALS, TERMINAL_DEFAULTS } from "../shared/vibrancy.ts";
import type { VibrancySettings } from "../shared/vibrancy.ts";
import { buildRpc, checkUpdateRpc, getSettingsRpc, setSettingsRpc, statusRpc } from "../shared/rpc.ts";
import type { VibrancyStatus } from "../shared/rpc.ts";
import { compareVersions } from "../shared/version.ts";
import { applyVibrancyCss } from "./vibrancy-css.ts";
import RangeRow from "./RangeRow.tsx";

const SET_SETTINGS_DEBOUNCE_MS = 150;

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

const range = (min: number, max: number, step: number) =>
  Array.from({ length: Math.round((max - min) / step) + 1 }, (_, i) => Math.round((min + i * step) * 1000) / 1000);

/** Native-platform fallbacks for the terminal range rows (discrete steps). */
const FONT_SIZE_STEPS = range(8, 32, 0.5);
const LINE_HEIGHT_STEPS = range(1, 2, 0.05);
const PADDING_STEPS = range(0, 40, 1);

const WEIGHT_OPTIONS = range(100, 900, 100).map((n) => ({ label: String(n), value: String(n) }));
const CURSOR_OPTIONS = [
  { label: "Bar", value: "bar" as const },
  { label: "Block", value: "block" as const },
  { label: "Underline", value: "underline" as const },
];
const ANSI_OPTIONS = [
  { label: "Oxocarbon", value: "oxocarbon" as const },
  { label: "Paseo default", value: "paseo" as const },
];

export default function VibrancyScreen({ theme, layout }: PluginSurfaceProps) {
  const toast = useToast();
  const getSettings = useRpc(getSettingsRpc);
  const setSettingsRemote = useRpc(setSettingsRpc);
  const fetchStatus = useRpc(statusRpc);
  const checkUpdate = useRpc(checkUpdateRpc);
  const build = useRpc(buildRpc);

  const [settings, setSettings] = useState<VibrancySettings>({ ...VIBRANCY_DEFAULTS, terminal: { ...TERMINAL_DEFAULTS } });
  const [settingsLoaded, setSettingsLoaded] = useState(false);
  const [status, setStatus] = useState<VibrancyStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const pollTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const unmountedRef = useRef(false);
  /** The most recently edited settings not yet confirmed saved; flushed on unmount. */
  const pendingRef = useRef<VibrancySettings | null>(null);

  const refreshStatus = () => {
    fetchStatus({})
      .then(setStatus)
      .catch((error: unknown) => {
        toast.error(error instanceof Error ? error.message : "Failed to load Vibrancy status");
      });
  };

  useEffect(() => {
    getSettings({})
      .then((loaded) => {
        setSettings(loaded);
        setSettingsLoaded(true);
        applyVibrancyCss(loaded);
      })
      .catch((error: unknown) => {
        toast.error(error instanceof Error ? error.message : "Failed to load Vibrancy settings");
      });
    refreshStatus();
    return () => {
      unmountedRef.current = true;
      clearTimeout(debounceRef.current);
      clearTimeout(pollTimerRef.current);
      const pending = pendingRef.current;
      pendingRef.current = null;
      if (pending) {
        setSettingsRemote(pending).catch((error: unknown) => {
          console.error("[vibrancy] failed to flush vibrancy settings on unmount", error);
        });
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function updateSettings(next: VibrancySettings) {
    setSettings(next);
    applyVibrancyCss(next);
    pendingRef.current = next;
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      const toSave = pendingRef.current;
      pendingRef.current = null;
      if (toSave) {
        setSettingsRemote(toSave)
          .then(() => {
            if (!unmountedRef.current) {
              refreshStatus();
            }
          })
          .catch((error: unknown) => {
            toast.error(error instanceof Error ? error.message : "Failed to save vibrancy settings");
          });
      }
    }, SET_SETTINGS_DEBOUNCE_MS);
  }

  /**
   * `vibrancy.build` returns as soon as the build is queued or busy (the
   * daemon's plugin RPCs time out at 30s, well short of a build),
   * so a non-busy response isn't the outcome: poll `vibrancy.status` every
   * second, keeping buttons disabled, until `building` flips back to
   * false, then surface the report/error it settled with.
   */
  async function pollUntilBuildDone(successMessage: string) {
    for (;;) {
      const { promise, resolve } = Promise.withResolvers<void>();
      pollTimerRef.current = setTimeout(resolve, 1000);
      await promise;
      if (unmountedRef.current) {
        return;
      }
      let latestStatus: VibrancyStatus;
      try {
        latestStatus = await fetchStatus({});
      } catch (error) {
        if (!unmountedRef.current) {
          toast.error(error instanceof Error ? error.message : "Failed to load Vibrancy status");
        }
        return;
      }
      if (unmountedRef.current) {
        return;
      }
      setStatus(latestStatus);
      if (!latestStatus.building) {
        if (latestStatus.lastError) {
          toast.error(latestStatus.lastError);
        } else {
          toast.show(successMessage);
        }
        return;
      }
    }
  }

  async function runBuild(input: { version?: string; restart: boolean }, successMessage: string) {
    setBusy(true);
    try {
      const queued = await build(input);
      if (!queued.ok) {
        toast.error(queued.error ?? "Build already running");
        return;
      }
      await pollUntilBuildDone(successMessage);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Build failed");
    } finally {
      if (!unmountedRef.current) {
        setBusy(false);
      }
      refreshStatus();
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
  const runningVibrancyBuild = status?.runningVibrancyBuild ?? false;
  const appearanceDisabled = !settingsLoaded || !runningVibrancyBuild || busy;
  const blurDisabled = appearanceDisabled || settings.material !== "none";
  const latest = status?.latest ?? null;
  const updateAvailable =
    latest !== null && status?.runningVersion != null && compareVersions(latest.version, status.runningVersion) > 0;

  const appearanceSection = (
    <SettingsSection title="Appearance">
      <SettingsCard>
        {!runningVibrancyBuild && (
          <SettingsRow label="Not running the Vibrancy build" hint="Rebuild below to enable live appearance controls." />
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
    </SettingsSection>
  );

  const terminal = settings.terminal;
  const terminalDisabled = !settingsLoaded;
  const overridden = new Set(terminal.followGhostty ? (status?.ghosttyOverrides ?? []) : []);
  const ghosttyHint = (key: string, hint?: string): string | undefined =>
    overridden.has(key) ? "Set by Ghostty config" : hint;
  const updateTerminal = (patch: Partial<VibrancySettings["terminal"]>) =>
    updateSettings({ ...settings, terminal: { ...terminal, ...patch } });

  const terminalSection = (
    <SettingsSection title="Terminal">
      <SettingsCard>
        <SettingsSwitch
          label="Follow Ghostty config"
          hint={
            overridden.has("fontFamily")
              ? "Ghostty's values win over the rows below; font family is also set by Ghostty config"
              : "Ghostty's values win over the rows below"
          }
          value={terminal.followGhostty}
          onValueChange={(followGhostty) => updateTerminal({ followGhostty })}
          disabled={terminalDisabled}
        />
        <SettingsSwitch
          label="Use Paseo's Code size"
          hint="Font size follows Settings > Appearance > Code"
          value={terminal.fontSize === null}
          onValueChange={(useCode) =>
            updateTerminal({ fontSize: useCode ? null : TERMINAL_DEFAULTS.fontSize })
          }
          disabled={terminalDisabled}
        />
        {isWeb ? (
          <RangeRow
            label="Font size"
            value={terminal.fontSize ?? TERMINAL_DEFAULTS.fontSize}
            min={8}
            max={32}
            step={0.5}
            disabled={terminalDisabled || terminal.fontSize === null}
            theme={theme}
            format={(size) => (terminal.fontSize === null ? "Paseo's Code size" : `${size} pt`)}
            onChange={(fontSize) => updateTerminal({ fontSize })}
          />
        ) : (
          <SettingsSelect
            label="Font size"
            value={String(terminal.fontSize ?? TERMINAL_DEFAULTS.fontSize)}
            options={FONT_SIZE_STEPS.map((n) => ({ label: `${n} pt`, value: String(n) }))}
            onValueChange={(v) => updateTerminal({ fontSize: Number(v) })}
            disabled={terminalDisabled || terminal.fontSize === null}
          />
        )}
        {isWeb ? (
          <RangeRow
            label="Line height"
            value={terminal.lineHeight}
            min={1}
            max={2}
            step={0.05}
            disabled={terminalDisabled || overridden.has("lineHeight")}
            theme={theme}
            format={(n) => ghosttyHint("lineHeight") ?? n.toFixed(2)}
            onChange={(lineHeight) => updateTerminal({ lineHeight })}
          />
        ) : (
          <SettingsSelect
            label="Line height"
            hint={ghosttyHint("lineHeight")}
            value={terminal.lineHeight.toFixed(2)}
            options={LINE_HEIGHT_STEPS.map((n) => ({ label: n.toFixed(2), value: n.toFixed(2) }))}
            onValueChange={(v) => updateTerminal({ lineHeight: Number(v) })}
            disabled={terminalDisabled || overridden.has("lineHeight")}
          />
        )}
        <SettingsSelect
          label="Font weight"
          hint={ghosttyHint("fontWeight")}
          value={String(terminal.fontWeight)}
          options={WEIGHT_OPTIONS}
          onValueChange={(v) => updateTerminal({ fontWeight: Number(v) })}
          disabled={terminalDisabled || overridden.has("fontWeight")}
        />
        <SettingsSelect
          label="Bold weight"
          hint={ghosttyHint("fontWeightBold")}
          value={String(terminal.fontWeightBold)}
          options={WEIGHT_OPTIONS}
          onValueChange={(v) => updateTerminal({ fontWeightBold: Number(v) })}
          disabled={terminalDisabled || overridden.has("fontWeightBold")}
        />
        <SettingsSelect
          label="Cursor"
          hint={ghosttyHint("cursorStyle")}
          value={terminal.cursorStyle}
          options={CURSOR_OPTIONS}
          onValueChange={(cursorStyle) => updateTerminal({ cursorStyle })}
          disabled={terminalDisabled || overridden.has("cursorStyle")}
        />
        {isWeb ? (
          <RangeRow
            label="Left padding"
            value={terminal.paddingLeft}
            min={0}
            max={40}
            step={1}
            disabled={terminalDisabled}
            theme={theme}
            format={(px) => `${px} px`}
            onChange={(paddingLeft) => updateTerminal({ paddingLeft })}
          />
        ) : (
          <SettingsSelect
            label="Left padding"
            value={String(terminal.paddingLeft)}
            options={PADDING_STEPS.map((n) => ({ label: `${n} px`, value: String(n) }))}
            onValueChange={(v) => updateTerminal({ paddingLeft: Number(v) })}
            disabled={terminalDisabled}
          />
        )}
        <SettingsSelect
          label="Terminal colours"
          value={terminal.ansi}
          options={ANSI_OPTIONS}
          onValueChange={(ansi) => updateTerminal({ ansi })}
          disabled={terminalDisabled}
        />
      </SettingsCard>
    </SettingsSection>
  );

  const needsRebuild = Boolean(status?.runningVibrancyBuild && !status.fingerprintMatches);

  const buildSection = (
    <SettingsSection title="Build">
      <SettingsCard>
        {needsRebuild && (
          <SettingsRow label="Rebuild to apply changes" hint="Terminal changes apply to the next build." />
        )}
        <SettingsRow label="Running version" hint={status?.runningVersion ?? "Unknown"} />
        <SettingsRow label="Built from" hint={status?.builtFrom ?? "Not a Vibrancy build"} />
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
          onPress={() => runBuild({ restart: true }, "Rebuilt the Vibrancy copy")}
          disabled={busy || status?.building}
        />
      </SettingsCard>
    </SettingsSection>
  );

  return (
    <>
      {appearanceSection}
      {terminalSection}
      {buildSection}
    </>
  );
}
