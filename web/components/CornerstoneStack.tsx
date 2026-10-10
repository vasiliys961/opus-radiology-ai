"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Isolated, experimental Cornerstone3D adapter. Nothing is imported or initialized
 * on the server, and data enters ONLY via wadouri.fileManager (local File objects).
 * This component deliberately does not claim 3D, measurements or diagnostic fitness.
 */
import type { Types } from "@cornerstonejs/core";

let startup: Promise<void> | null = null;
async function initCornerstone() {
  if (!startup) {
    startup = (async () => {
      const [core, loader] = await Promise.all([
        import("@cornerstonejs/core"),
        import("@cornerstonejs/dicom-image-loader"),
      ]);
      await core.init();
      await loader.init({ maxWebWorkers: 2 }); // M1 with 8 GB RAM; avoid a worker per core.
    })().catch((error: unknown) => {
      startup = null;
      throw error;
    });
  }
  return startup;
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

type ActiveViewport = {
  setImageIdIndex(index: number): Promise<string>;
  render(): void;
  resetCamera(): void;
};

export default function CornerstoneStack({ files, selectedIndex, onSliceChange }: {
  files: File[];
  selectedIndex?: number;
  onSliceChange?: (index: number) => void;
}) {
  const element = useRef<HTMLDivElement>(null);
  const viewport = useRef<ActiveViewport | null>(null);
  const [current, setCurrent] = useState(0);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("Выберите DICOM-серию слева.");
  const [error, setError] = useState("");
  const request = useRef(0);
  const onSliceChangeRef = useRef(onSliceChange);
  onSliceChangeRef.current = onSliceChange;
  const initialIndex = useRef(selectedIndex ?? 0);
  const lastExternal = useRef(selectedIndex);
  // External slice selection is handled by a separate effect, without reinitializing the engine.
  // The ref is used only at the start of a new mounted series.

  useEffect(() => {
    if (!files.length || !element.current) {
      viewport.current = null;
      return;
    }
    let cancelled = false;
    let engine: import("@cornerstonejs/core").RenderingEngine | null = null;
    let release: (() => void) | null = null;
    viewport.current = null;
    setCurrent(0);
    setBusy(true);
    setError("");
    setStatus("Инициализация декодера изображений…");

    (async () => {
      await initCornerstone();
      if (cancelled) return;
      const [core, loader] = await Promise.all([
        import("@cornerstonejs/core"),
        import("@cornerstonejs/dicom-image-loader"),
      ]);
      if (cancelled) return;
      const imageIds = files.map((file) => loader.wadouri.fileManager.add(file));
      // The file manager uses a global registry. Release only IDs owned by this view.
      const registered = imageIds.map((imageId) => Number(imageId.split(":").pop()));
      release = () => registered.forEach((index) => {
        if (Number.isInteger(index)) loader.wadouri.fileManager.remove(index);
      });
      if (cancelled) return;
      const renderingEngineId = `ora-engine-${crypto.randomUUID()}`;
      const viewportId = `ora-viewport-${crypto.randomUUID()}`;
      engine = new core.RenderingEngine(renderingEngineId);
      engine.enableElement({
        viewportId,
        element: element.current!,
        type: core.Enums.ViewportType.STACK,
        defaultOptions: { background: [0.02, 0.06, 0.09] },
      });
      const stack = engine.getViewport(viewportId) as Types.IStackViewport;
      setStatus(`Загрузка первого кадра (${files.length} файлов в серии)…`);
      const firstIndex = Math.min(Math.max(0, initialIndex.current), files.length - 1);
      await stack.setStack(imageIds, firstIndex);
      if (cancelled) return;
      viewport.current = stack;
      setCurrent(firstIndex);
      stack.render();
      setStatus("Просмотр через Cornerstone3D · локально в браузере");
    })().catch((err: unknown) => {
      if (!cancelled) {
        setError(`Не удалось декодировать серию: ${errorText(err)}`);
        setStatus("Декодирование не завершено");
      }
    }).finally(() => { if (!cancelled) setBusy(false); });

    return () => {
      cancelled = true;
      request.current++;
      viewport.current = null;
      try { engine?.destroy(); } catch { /* teardown on failed GPU init */ }
      try { release?.(); } catch { /* internal loader registry may already be cleared */ }
    };
  }, [files]);

  const goTo = useCallback(async (index: number) => {
    const target = viewport.current;
    if (!target || busy) return;
    const bounded = Math.min(Math.max(0, index), files.length - 1);
    const serial = ++request.current;
    setBusy(true);
    setError("");
    try {
      await target.setImageIdIndex(bounded);
      if (serial === request.current) {
        target.render();
        setCurrent(bounded);
        onSliceChangeRef.current?.(bounded);
      }
    } catch (err: unknown) {
      if (serial === request.current) setError(`Ошибка загрузки среза ${bounded + 1}: ${errorText(err)}`);
    } finally {
      if (serial === request.current) setBusy(false);
    }
  }, [busy, files.length]);

  // A slice chosen in the dashboard's file list should move the already mounted
  // viewport, not instantiate a second rendering engine.
  useEffect(() => {
    if (selectedIndex === undefined) return;
    if (selectedIndex === current) {
      lastExternal.current = selectedIndex;
      return;
    }
    if (selectedIndex === lastExternal.current || busy || !viewport.current) return;
    lastExternal.current = selectedIndex;
    void goTo(selectedIndex);
  }, [selectedIndex, current, busy, goTo]);

  return <section className="cs-stack" aria-label="DICOM-серия">
    <div className="cs-view-header">
      <strong>DICOM Stack Viewer</strong>
      <span>{status}</span>
      <button type="button" disabled={!viewport.current} onClick={() => { viewport.current?.resetCamera(); viewport.current?.render(); }}>Сбросить вид</button>
    </div>
    <div
      className="cs-image"
      ref={element}
      tabIndex={0}
      aria-label="Область просмотра срезов, стрелки вверх и вниз для переключения"
      onKeyDown={(event) => {
        if (event.key === "ArrowDown" || event.key === "ArrowRight") { event.preventDefault(); void goTo(current + 1); }
        if (event.key === "ArrowUp" || event.key === "ArrowLeft") { event.preventDefault(); void goTo(current - 1); }
      }}
      onWheel={(event) => {
        if (!files.length) return;
        // One wheel gesture -> one slice. No browser page scroll inside viewport.
        event.preventDefault();
        void goTo(current + (event.deltaY > 0 ? 1 : -1));
      }}
    />
    {busy && <div className="cs-loading" role="status">Обработка изображения…</div>}
    {error && <div role="alert" className="cs-error">{error}</div>}
    <div className="cs-slider-row">
      <button type="button" disabled={busy || current === 0} onClick={() => void goTo(current - 1)}>←</button>
      <label htmlFor="cs-slice">Срез {files.length ? current + 1 : 0} / {files.length}</label>
      <input id="cs-slice" type="range" min={0} max={Math.max(0, files.length - 1)} value={current} disabled={busy || files.length < 2} onChange={(event) => void goTo(Number(event.target.value))}/>
      <button type="button" disabled={busy || current === files.length - 1} onClick={() => void goTo(current + 1)}>→</button>
    </div>
  </section>;
}
