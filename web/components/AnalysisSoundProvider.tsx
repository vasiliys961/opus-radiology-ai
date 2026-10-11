"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef,
  useState, type ReactNode } from "react";

/**
 * Local browser tone after successful processing; no microphone, remote files,
 * network requests or DICOM content are accessed. User action opt-in is required.
 */
export const SOUND_SETTING_KEY = "opus-radiology-completion-chime-v1";
type SoundContextState = {
  enabled: boolean;
  setSoundEnabled: (value: boolean) => void;
  previewChime: () => Promise<boolean>;
  armChime: () => Promise<boolean>;
  completionChime: () => Promise<boolean>;
};
const SoundContext = createContext<SoundContextState | null>(null);
type AudioCtx = AudioContext & { webkitAudioContext?: never };
function createAudioContext(): AudioContext | null {
  if (typeof window === "undefined") return null;
  const constructor = window.AudioContext ||
    (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  return constructor ? new constructor() : null;
}
function signalTone(context: AudioContext, frequency: number, start: number, duration: number) {
  const oscillator = context.createOscillator();
  const envelope = context.createGain();
  oscillator.type = "sine";
  oscillator.frequency.setValueAtTime(frequency, start);
  envelope.gain.setValueAtTime(0.0001, start);
  envelope.gain.exponentialRampToValueAtTime(0.13, start + 0.024);
  envelope.gain.exponentialRampToValueAtTime(0.0001, start + duration);
  oscillator.connect(envelope);
  envelope.connect(context.destination);
  oscillator.start(start);
  oscillator.stop(start + duration + 0.01);
  oscillator.onended = () => {
    oscillator.disconnect();
    envelope.disconnect();
  };
}
export function AnalysisSoundProvider({ children }: { children: ReactNode }) {
  const [enabled, setEnabled] = useState(false);
  const [ready, setReady] = useState(false);
  const audioRef = useRef<AudioContext | null>(null);
  useEffect(() => {
    try { setEnabled(window.localStorage.getItem(SOUND_SETTING_KEY) === "enabled"); }
    catch { /* private browsing: use an ephemeral preference */ }
    setReady(true);
    return () => {
      const context = audioRef.current;
      if (context) void context.close().catch(() => {});
      audioRef.current = null;
    };
  }, []);
  const setSoundEnabled = useCallback((value: boolean) => {
    setEnabled(value);
    try { window.localStorage.setItem(SOUND_SETTING_KEY, value ? "enabled" : "disabled"); }
    catch { /* no persistent storage */ }
  }, []);
  // Prime playback during a real user click. Safari may block a newly
  // created AudioContext several minutes later after an asynchronous AI call.
  const armChime = useCallback(async () => {
    const context = audioRef.current ?? createAudioContext();
    if (!context) return false;
    audioRef.current = context;
    try {
      if (context.state === "suspended") await context.resume();
      return context.state === "running";
    } catch {return false;}
  }, []);
  const ring = useCallback(async () => {
    if (!await armChime()) return false;
    const context = audioRef.current;
    if (!context) return false;
    try {
      const now = context.currentTime + 0.015;
      signalTone(context, 880, now, 0.17);
      signalTone(context, 1318.51, now + 0.12, 0.35);
      return true;
    } catch { return false; }
  }, [armChime]);
  const completionChime = useCallback(() => ready && enabled ? ring() : Promise.resolve(false),
    [ready, enabled, ring]);
  const value = useMemo(() => ({
    enabled: ready && enabled, setSoundEnabled,
    previewChime: ring, armChime, completionChime,
  }), [ready, enabled, setSoundEnabled, ring, armChime, completionChime]);
  return <SoundContext.Provider value={value}>{children}</SoundContext.Provider>;
}
export function useAnalysisSound(): SoundContextState {
  const context = useContext(SoundContext);
  if (!context) throw new Error("AnalysisSoundProvider missing");
  return context;
}
