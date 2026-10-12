"use client";

import { useCallback, useEffect, useRef, useState, type PointerEvent } from "react";
import type { Types } from "@cornerstonejs/core";
import { CT_WINDOW_PRESETS, clampZoom, rangeToWindowLevel, windowLevelToRange, type VoiRange } from "../lib/window-level";

/**
 * Experimental local-only 2D DICOM stack. View operations never alter DICOM files.
 * MPR, measurements and diagnostic validation are NOT implemented.
 */
let startup: Promise<void> | null = null;
async function initCornerstone() {
  if (!startup) {
    startup = (async () => {
      const [core, loader] = await Promise.all([
        import("@cornerstonejs/core"),
        import("@cornerstonejs/dicom-image-loader"),
      ]);
      await core.init();
      await loader.init({ maxWebWorkers: 2 }); // Keep concurrency modest on 8 GB M1.
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

type DragState =
  | { id: number; tool: "pan"; x: number; y: number; pan: [number, number] }
  | { id: number; tool: "window"; x: number; y: number; width: number; center: number };
type Tool = "scroll" | "pan" | "window";

type SafariFullscreenElement = HTMLElement & { webkitRequestFullscreen?: () => void | Promise<void> };
type SafariFullscreenDocument = Document & {
  webkitFullscreenElement?: Element | null;
  webkitExitFullscreen?: () => void | Promise<void>;
};

export default function CornerstoneStack({ files, selectedIndex, onSliceChange, modality }: {
  files: File[];
  selectedIndex?: number;
  onSliceChange?: (index: number) => void;
  modality?: string;
}) {
  const container = useRef<HTMLElement>(null);
  const element = useRef<HTMLDivElement>(null);
  const viewport = useRef<Types.IStackViewport | null>(null);
  const engineRef = useRef<import("@cornerstonejs/core").RenderingEngine | null>(null);
  const initialVoi = useRef<VoiRange | null>(null);
  const drag = useRef<DragState | null>(null);
  const [current, setCurrent] = useState(0);
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(false);
  const [status, setStatus] = useState("Выберите DICOM-серию слева.");
  const [error, setError] = useState("");
  const [tool, setTool] = useState<Tool>("scroll");
  const [zoom, setZoom] = useState(1);
  const [ww, setWw] = useState("");
  const [wc, setWc] = useState("");
  const [fullscreen, setFullscreen] = useState(false);
  const request = useRef(0);
  const onSliceChangeRef = useRef(onSliceChange);
  onSliceChangeRef.current = onSliceChange;
  const initialIndex = useRef(selectedIndex ?? 0);
  const lastExternal = useRef(selectedIndex);

  function reflectVoi(range: VoiRange | null | undefined) {
    const next = rangeToWindowLevel(range);
    if (next) {
      setWw(String(Math.round(next.width * 100) / 100));
      setWc(String(Math.round(next.center * 100) / 100));
    }
  }

  useEffect(() => {
    if (!files.length || !element.current) return;
    let cancelled = false;
    let engine: import("@cornerstonejs/core").RenderingEngine | null = null;
    let release: (() => void) | null = null;
    let observer: ResizeObserver | null = null;
    viewport.current = null;
    initialVoi.current = null;
    setReady(false);
    setCurrent(0);
    setZoom(1);
    setWw("");
    setWc("");
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
      const registered = imageIds.map((imageId) => Number(imageId.split(":").pop()));
      release = () => {
        // Evict only this stack's decoded images; decache also releases datasets.
        for(const imageId of imageIds) {
          try {core.cache.removeImageLoadObject(imageId);} catch { /* already evicted */ }
        }
        registered.forEach(index=>{
          if(Number.isInteger(index))loader.wadouri.fileManager.remove(index);
        });
      };
      if (cancelled) return;
      engine = new core.RenderingEngine(`ora-engine-${crypto.randomUUID()}`);
      engineRef.current = engine;
      const viewportId = `ora-viewport-${crypto.randomUUID()}`;
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
      initialVoi.current = stack.getProperties().voiRange ?? null;
      reflectVoi(initialVoi.current);
      setCurrent(firstIndex);
      stack.render();
      setReady(true);
      setStatus("Cornerstone3D · локальный 2D-просмотр");
      // Fullscreen, sidebar resizes and Safari window geometry require canvas resize.
      observer = new ResizeObserver(() => {
        if (!cancelled && engineRef.current) {
          try { engineRef.current.resize(true, false); } catch { /* canvas may be unmounting */ }
        }
      });
      observer.observe(element.current!);
    })().catch((err: unknown) => {
      if (!cancelled) {
        setError(`Не удалось декодировать серию: ${errorText(err)}`);
        setStatus("Декодирование не завершено");
      }
    }).finally(() => {
      if (!cancelled) setBusy(false);
      else {try {release?.();} catch { /* late decode after unmount */ }}
    });

    return () => {
      cancelled = true;
      observer?.disconnect();
      request.current++;
      drag.current = null;
      viewport.current = null;
      setReady(false);
      engineRef.current = null;
      try { engine?.destroy(); } catch { /* partial GPU initialization */ }
      try { release?.(); } catch { /* decoder registry already cleaned */ }
    };
  }, [files]);

  // React's onWheel is sometimes passive. Register a non-passive wheel handler
  // on the imaging canvas to prevent Safari from scrolling the entire page.
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
  const goToRef = useRef(goTo);
  goToRef.current = goTo;
  const currentRef = useRef(current);
  currentRef.current = current;
  const toolRef = useRef(tool);
  toolRef.current = tool;
  useEffect(() => {
    const el = element.current;
    if (!el) return;
    const wheel = (event: WheelEvent) => {
      event.preventDefault();
      // Shift+wheel zooms. Plain wheel navigates slices, even in pan mode.
      if (event.shiftKey && viewport.current) {
        const target = viewport.current;
        const value = clampZoom(target.getZoom() * (event.deltaY > 0 ? 0.9 : 1.1));
        target.setZoom(value);
        target.render();
        setZoom(value);
      } else if (toolRef.current !== "window") {
        void goToRef.current(currentRef.current + (event.deltaY > 0 ? 1 : -1));
      }
    };
    el.addEventListener("wheel", wheel, { passive: false });
    return () => el.removeEventListener("wheel", wheel);
  }, []);

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

  useEffect(() => {
    const doc = document as SafariFullscreenDocument;
    const update = () => setFullscreen(doc.fullscreenElement === container.current || doc.webkitFullscreenElement === container.current);
    document.addEventListener("fullscreenchange", update);
    document.addEventListener("webkitfullscreenchange", update);
    return () => {
      document.removeEventListener("fullscreenchange", update);
      document.removeEventListener("webkitfullscreenchange", update);
    };
  }, []);

  const applyWindow = (width: number, center: number) => {
    if (!viewport.current || busy) return;
    try {
      const range = windowLevelToRange(width, center);
      viewport.current.setProperties({ voiRange: range });
      viewport.current.render();
      reflectVoi(range);
      setError("");
    } catch (err: unknown) { setError(errorText(err)); }
  };

  const zoomBy = (factor: number) => {
    const target = viewport.current;
    if (!target) return;
    const value = clampZoom(target.getZoom() * factor);
    target.setZoom(value);
    target.render();
    setZoom(value);
  };

  const resetDisplay = () => {
    const target = viewport.current;
    if (!target) return;
    target.resetCamera();
    setZoom(1);
    if (initialVoi.current) {
      target.setProperties({ voiRange: initialVoi.current });
      reflectVoi(initialVoi.current);
    }
    target.render();
    setError("");
  };

  const toggleFullscreen = async () => {
    const node = container.current as SafariFullscreenElement | null;
    if (!node) return;
    const doc = document as SafariFullscreenDocument;
    try {
      if (doc.fullscreenElement === node || doc.webkitFullscreenElement === node) {
        if (doc.exitFullscreen) await doc.exitFullscreen();
        else await doc.webkitExitFullscreen?.();
      } else if (node.requestFullscreen) await node.requestFullscreen();
      else if (node.webkitRequestFullscreen) await node.webkitRequestFullscreen();
      else throw new Error("Браузер не поддерживает полноэкранный режим для этого элемента.");
    } catch (err: unknown) { setError(`Полный экран: ${errorText(err)}`); }
  };

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    const target = viewport.current;
    if (!target || !ready || tool === "scroll" || event.button !== 0) return;
    if (tool === "pan") {
      const pan = target.getPan();
      drag.current = { id: event.pointerId, tool, x: event.clientX, y: event.clientY, pan: [pan[0], pan[1]] };
    } else {
      const values = rangeToWindowLevel(target.getProperties().voiRange ?? null);
      if (!values) { setError("Нет исходного окна: задайте WW и WC вручную."); return; }
      drag.current = { id: event.pointerId, tool, x: event.clientX, y: event.clientY, ...values };
    }
    event.currentTarget.setPointerCapture(event.pointerId);
    event.preventDefault();
  };

  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const state = drag.current;
    const target = viewport.current;
    if (!state || !target || state.id !== event.pointerId) return;
    if (state.tool === "pan") {
      target.setPan([state.pan[0] + event.clientX - state.x, state.pan[1] + event.clientY - state.y]);
      target.render();
    } else {
      const range = windowLevelToRange(
        Math.max(1, Math.min(10_000_000, state.width + (event.clientX - state.x) * Math.max(0.5, state.width / 400))),
        state.center + (event.clientY - state.y) * Math.max(0.5, state.width / 400),
      );
      target.setProperties({ voiRange: range });
      target.render();
      reflectVoi(range);
    }
  };

  const onPointerEnd = (event: PointerEvent<HTMLDivElement>) => {
    if (drag.current?.id !== event.pointerId) return;
    drag.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };

  return <section className="cs-stack" ref={container} aria-label="DICOM-серия">
    <div className="cs-view-header">
      <strong>DICOM Stack Viewer</strong>
      <span>{status}</span>
      <button type="button" disabled={!ready} onClick={resetDisplay}>Сбросить вид</button>
    </div>
    <div className="cs-tools" aria-label="Инструменты изображения">
      <div className="cs-tool-group" role="group" aria-label="Режим курсора">
        <button type="button" className={tool === "scroll" ? "active" : ""} onClick={() => setTool("scroll")}>Срезы</button>
        <button type="button" className={tool === "pan" ? "active" : ""} onClick={() => setTool("pan")}>Перемещение</button>
        <button type="button" className={tool === "window" ? "active" : ""} onClick={() => setTool("window")}>Окно мышью</button>
      </div>
      <div className="cs-tool-group" role="group" aria-label="Масштаб изображения">
        <button type="button" disabled={!ready} onClick={() => zoomBy(0.8)} aria-label="Уменьшить масштаб">−</button>
        <span className="cs-zoom-readout">{Math.round(zoom * 100)}%</span>
        <button type="button" disabled={!ready} onClick={() => zoomBy(1.25)} aria-label="Увеличить масштаб">+</button>
        <button type="button" disabled={!ready} onClick={() => void toggleFullscreen()}>{fullscreen ? "Свернуть" : "На весь экран"}</button>
      </div>
    </div>
    <div className="cs-window-row">
      <label>WW <input aria-label="Ширина окна WW" type="number" inputMode="decimal" min={1} value={ww} placeholder="—" onChange={e => setWw(e.target.value)}/></label>
      <label>WC <input aria-label="Уровень окна WC" type="number" inputMode="decimal" value={wc} placeholder="—" onChange={e => setWc(e.target.value)}/></label>
      <button type="button" disabled={!ready} onClick={() => applyWindow(Number(ww), Number(wc))}>Применить</button>
      {modality?.toUpperCase() === "CT" && <div className="cs-preset-list" role="group" aria-label="Стандартные окна КТ">
        {Object.entries(CT_WINDOW_PRESETS).map(([key, preset]) => <button type="button" key={key} disabled={!ready} title={`WW ${preset.width} / WC ${preset.center} HU`} onClick={() => applyWindow(preset.width, preset.center)}>{preset.label}</button>)}
      </div>}
    </div>
    <div
      className="cs-image"
      ref={element}
      data-tool={tool}
      tabIndex={0}
      aria-label="Просмотр DICOM: стрелки переключают срезы, Shift с колесом меняет масштаб"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerEnd}
      onPointerCancel={onPointerEnd}
      onKeyDown={(event) => {
        if (event.key === "ArrowDown" || event.key === "ArrowRight") { event.preventDefault(); void goTo(current + 1); }
        if (event.key === "ArrowUp" || event.key === "ArrowLeft") { event.preventDefault(); void goTo(current - 1); }
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
    <div className="cs-hint">Колесо — срезы · Shift+колесо — масштаб · режим «Перемещение» — перетаскивание · WW/WC — только отображение</div>
  </section>;
}
