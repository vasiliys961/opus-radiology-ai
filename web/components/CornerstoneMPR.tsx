"use client";

import { useEffect, useRef, useState, type KeyboardEvent, type MouseEvent, type WheelEvent } from "react";
import type { Types } from "@cornerstonejs/core";
import { alignCameraWithPoint, crosshairAfterScroll, insideImageExtent, safeSliceIndex, type Vec3 } from "../lib/mpr-navigation";

const PLANE_NAMES = ["axial", "coronal", "sagittal"] as const;
type Plane = typeof PLANE_NAMES[number];
type Readout = { index: number; total: number };
type Crosshair = { x: number; y: number } | null;
type Readouts = Record<Plane, Readout>;
type Crosshairs = Record<Plane, Crosshair>;
type Runtime = {
  step: (plane: Plane, delta: number) => void;
  pick: (plane: Plane, x: number, y: number) => void;
  reset: () => void;
};

const emptyReadouts = (): Readouts => ({ axial:{index:0,total:1}, coronal:{index:0,total:1}, sagittal:{index:0,total:1} });
const emptyCrosshairs = (): Crosshairs => ({ axial:null, coronal:null, sagittal:null });
const captions: Record<Plane,string> = { axial:"АКСИАЛЬНАЯ", coronal:"КОРОНАЛЬНАЯ", sagittal:"САГИТТАЛЬНАЯ" };

/**
 * Research-only interactive MPR with a single patient-space crosshair point.
 * All input stays in the browser and is gated by checkMprEligibility upstream.
 * This is NOT a calibrated diagnostic viewer or a measurement instrument.
 */
export default function CornerstoneMPR({ files }: { files: File[] }) {
  const axial = useRef<HTMLDivElement>(null);
  const coronal = useRef<HTMLDivElement>(null);
  const sagittal = useRef<HTMLDivElement>(null);
  const runtime = useRef<Runtime | null>(null);
  const [status, setStatus] = useState("Подготовка MPR…");
  const [error, setError] = useState("");
  const [ready, setReady] = useState(false);
  const [readouts, setReadouts] = useState<Readouts>(emptyReadouts);
  const [crosshairs, setCrosshairs] = useState<Crosshairs>(emptyCrosshairs);

  useEffect(() => {
    const elements = { axial:axial.current, coronal:coronal.current, sagittal:sagittal.current };
    if (!files.length || PLANE_NAMES.some(p => !elements[p])) return;
    let cancelled = false;
    let dispose: (() => void) | null = null;
    let observer: ResizeObserver | null = null;
    const id = crypto.randomUUID();
    const volumeId = `ora-mpr-${id}`;
    runtime.current = null;
    setReady(false);
    setCrosshairs(emptyCrosshairs());
    setReadouts(emptyReadouts());
    setStatus("Подготовка MPR…");
    setError("");

    (async () => {
      const [core, loader] = await Promise.all([
        import("@cornerstonejs/core"),
        import("@cornerstonejs/dicom-image-loader"),
      ]);
      await core.init();
      await loader.init({ maxWebWorkers: 2 });
      if (cancelled) return;

      const imageIds = files.map(file => loader.wadouri.fileManager.add(file));
      const fileIndices = imageIds.map(imageId => Number(imageId.split(":").pop()));
      let engine: import("@cornerstonejs/core").RenderingEngine | null = null;
      let volumeAllocated = false;
      const release = () => {
        observer?.disconnect();
        observer = null;
        runtime.current = null;
        try { engine?.destroy(); } catch { /* GPU device may be lost */ }
        engine = null;
        if (volumeAllocated) {
          try { core.cache.removeVolumeLoadObject(volumeId); } catch { /* missing volume */ }
          volumeAllocated = false;
        }
        for (const imageId of imageIds) {
          try { core.cache.removeImageLoadObject(imageId); } catch { /* already evicted */ }
        }
        for (const index of fileIndices) {
          if (Number.isInteger(index)) {
            try { loader.wadouri.fileManager.remove(index); } catch { /* already removed */ }
          }
        }
      };
      dispose = release;
      try {
        for (let i = 0; i < imageIds.length; i++) {
          if (cancelled) return;
          if (i % 5 === 0) setStatus(`Загрузка кадров для MPR: ${i + 1} / ${imageIds.length}`);
          await core.imageLoader.loadAndCacheImage(imageIds[i]);
        }
        if (cancelled) return;
        setStatus("Проверка геометрии и сборка объёма…");
        const volume = await core.volumeLoader.createAndCacheVolumeFromImages(volumeId, imageIds);
        volumeAllocated = true;
        if (cancelled) return;
        if (!volume || volume.dimensions?.[2] !== imageIds.length) {
          throw new Error("Полученный объём не соответствует количеству кадров серии.");
        }
        engine = new core.RenderingEngine(`ora-mpr-engine-${id}`);
        const ids = PLANE_NAMES.map(plane => `ora-mpr-${plane}-${id}`);
        engine.setViewports([
          { viewportId: ids[0], type: core.Enums.ViewportType.ORTHOGRAPHIC, element: elements.axial!, defaultOptions: { orientation: core.Enums.OrientationAxis.AXIAL } },
          { viewportId: ids[1], type: core.Enums.ViewportType.ORTHOGRAPHIC, element: elements.coronal!, defaultOptions: { orientation: core.Enums.OrientationAxis.CORONAL } },
          { viewportId: ids[2], type: core.Enums.ViewportType.ORTHOGRAPHIC, element: elements.sagittal!, defaultOptions: { orientation: core.Enums.OrientationAxis.SAGITTAL } },
        ]);
        await core.setVolumesForViewports(engine, [{ volumeId }], ids);
        if (cancelled) return;
        const views = Object.fromEntries(PLANE_NAMES.map((p,i) => [p, engine!.getViewport(ids[i]) as Types.IVolumeViewport])) as Record<Plane,Types.IVolumeViewport>;
        for (const p of PLANE_NAMES) views[p].resetCamera();
        const initialFocal = views.axial.getCamera().focalPoint;
        if (!initialFocal || !initialFocal.every(Number.isFinite)) {
          throw new Error("Не удалось получить начальный центр MPR-объёма.");
        }
        let point = [...initialFocal] as Vec3;

        const synchronize = (next: Vec3) => {
          if (cancelled) return;
          if (!next.every(Number.isFinite)) return;
          point = next;
          const nextReadouts = emptyReadouts();
          const nextCrosshairs = emptyCrosshairs();
          for (const p of PLANE_NAMES) {
            const v = views[p];
            const camera = v.getCamera();
            const pose = alignCameraWithPoint(camera.focalPoint as Vec3, camera.position as Vec3,
              camera.viewPlaneNormal as Vec3, point);
            v.setCamera(pose);
            v.render();
            // Read back the actual displayed slice from Cornerstone, not a guessed
            // anatomical axis. Acquisition orientation may be oblique.
            const info = core.utilities.getVolumeViewportScrollInfo(v as Parameters<typeof core.utilities.getVolumeViewportScrollInfo>[0], volumeId);
            const total = Math.max(1, Math.round(info.numScrollSteps) + 1);
            nextReadouts[p] = { index:safeSliceIndex(info.currentStepIndex,total), total };
            const canvas = v.worldToCanvas(point);
            if (canvas?.every(Number.isFinite)) nextCrosshairs[p] = { x: canvas[0], y: canvas[1] };
          }
          setReadouts(nextReadouts);
          setCrosshairs(nextCrosshairs);
        };
        const step = (plane: Plane, delta: number) => {
          if (cancelled || !Number.isFinite(delta) || !delta) return;
          try {
            const v = views[plane];
            const info = core.utilities.getVolumeViewportScrollInfo(v as Parameters<typeof core.utilities.getVolumeViewportScrollInfo>[0], volumeId);
            const total = Math.max(1, Math.round(info.numScrollSteps) + 1);
            const current = safeSliceIndex(info.currentStepIndex, total);
            const next = safeSliceIndex(current + Math.trunc(delta), total);
            if (next === current) return;
            const before = [...v.getCamera().focalPoint] as Vec3;
            core.utilities.scroll(v as Parameters<typeof core.utilities.scroll>[0], {delta:next - current, volumeId});
            const afterCamera = v.getCamera();
            const updated = crosshairAfterScroll(point, before, afterCamera.focalPoint as Vec3,
              afterCamera.viewPlaneNormal as Vec3);
            synchronize(updated);
          } catch (cause: unknown) {
            setError(`Ошибка переключения плоскости ${captions[plane]}: ${cause instanceof Error ? cause.message : String(cause)}`);
          }
        };
        const pick = (plane: Plane, x: number, y: number) => {
          if (cancelled || !Number.isFinite(x) || !Number.isFinite(y)) return;
          try {
            const v = views[plane];
            const world = v.canvasToWorld([x,y]) as Vec3;
            if (!world?.every(Number.isFinite)) return;
            const index = core.utilities.transformWorldToIndex(volume.imageData, world) as number[];
            if (!insideImageExtent(index, volume.dimensions)) {
              setStatus("Точка за пределами объёма. Выберите анатомию внутри изображения.");
              return;
            }
            synchronize([...world] as Vec3);
            setStatus("Связанные перекрестия · кликайте на изображение или листайте плоскости");
          } catch (cause: unknown) {
            setError(`Не удалось выбрать точку: ${cause instanceof Error ? cause.message : String(cause)}`);
          }
        };
        runtime.current = {
          step, pick,
          reset: () => {
            for (const p of PLANE_NAMES) views[p].resetCamera();
            synchronize([...views.axial.getCamera().focalPoint] as Vec3);
          },
        };
        synchronize(point);
        observer = new ResizeObserver(() => {
          if (cancelled || !engine) return;
          try {
            engine.resize(true,false);
            synchronize(point);
          } catch { /* resize during teardown */ }
        });
        for (const p of PLANE_NAMES) observer.observe(elements[p]!);
        setReady(true);
        setStatus("MPR: колесо мыши — срезы, клик — связанная точка, ползунок — положение");
      } finally {
        if (cancelled) release();
      }
    })().catch((cause: unknown) => {
      if (!cancelled) {
        setError(cause instanceof Error ? cause.message : "Не удалось построить объём.");
        setStatus("MPR не построен. Обычный просмотр DICOM доступен.");
        setReady(false);
      }
      dispose?.();
    });
    return () => { cancelled = true; runtime.current = null; dispose?.(); };
  }, [files]);

  const onWheel = (event: WheelEvent<HTMLDivElement>, plane: Plane) => {
    if (!ready) return;
    event.preventDefault();
    runtime.current?.step(plane,event.deltaY > 0 ? 1 : -1);
  };
  const onClick = (event: MouseEvent<HTMLDivElement>, plane: Plane) => {
    if (!ready) return;
    const rect = event.currentTarget.getBoundingClientRect();
    runtime.current?.pick(plane,event.clientX-rect.left,event.clientY-rect.top);
  };
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>, plane: Plane) => {
    if (event.key === "ArrowUp" || event.key === "ArrowRight") { event.preventDefault(); runtime.current?.step(plane,1); }
    if (event.key === "ArrowDown" || event.key === "ArrowLeft") { event.preventDefault(); runtime.current?.step(plane,-1); }
  };

  return <section className="ora-mpr" aria-label="Экспериментальная мультипланарная реконструкция">
    <div className="ora-mpr-status" role="status">{status} <button type="button" disabled={!ready} onClick={() => runtime.current?.reset()}>Центрировать</button></div>
    {error && <div role="alert" className="cs-error">Ошибка MPR: {error}. Вернитесь в 2D-просмотр, если ошибка сохраняется.</div>}
    <div className="ora-mpr-grid">
      {PLANE_NAMES.map((plane) => {
        const ref = plane === "axial" ? axial : plane === "coronal" ? coronal : sagittal;
        const position = crosshairs[plane];
        const info = readouts[plane];
        return <div className={`ora-mpr-plane ora-mpr-${plane}`} key={plane}>
          <div className="ora-mpr-surface" tabIndex={ready ? 0 : -1}
            aria-label={`${captions[plane]} плоскость: колесо мыши — листать срезы, клик — выбрать точку`}
            onWheel={event => onWheel(event, plane)} onClick={event => onClick(event, plane)}
            onKeyDown={event => onKeyDown(event,plane)}>
            <div className="ora-mpr-canvas" ref={ref}/>
            <span className="ora-mpr-plane-label">{plane.toUpperCase()} · {captions[plane]}</span>
            {ready && position && <div className="ora-mpr-crosshair" aria-hidden="true" style={{left:position.x,top:position.y}}/>}
          </div>
          <div className="ora-mpr-controls">
            <button type="button" aria-label={`Предыдущий срез: ${captions[plane]}`} disabled={!ready || info.index === 0} onClick={() => runtime.current?.step(plane,-1)}>−</button>
            <label htmlFor={`ora-mpr-slider-${plane}`}>Срез {info.index + 1} / {info.total}</label>
            <input type="range" id={`ora-mpr-slider-${plane}`} min="0" max={Math.max(0,info.total-1)}
              value={info.index} disabled={!ready || info.total < 2}
              onChange={event => runtime.current?.step(plane,Number(event.target.value)-info.index)}/>
            <button type="button" aria-label={`Следующий срез: ${captions[plane]}`} disabled={!ready || info.index >= info.total-1} onClick={() => runtime.current?.step(plane,1)}>+</button>
          </div>
        </div>;
      })}
    </div>
    <p className="ora-mpr-warning">Исследовательский MPR. Все три перекрестия соответствуют одной точке в пространстве пациента; клиническая точность, измерения и геометрия требуют отдельной валидации. Изображения остаются в браузере.</p>
  </section>;
}
