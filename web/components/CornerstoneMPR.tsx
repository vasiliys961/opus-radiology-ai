"use client";

import { useEffect, useRef, useState, type KeyboardEvent, type MouseEvent, type WheelEvent, type PointerEvent } from "react";
import type { Types } from "@cornerstonejs/core";
import { alignCameraWithPoint, crosshairAfterScroll, insideImageExtent, safeSliceIndex, type Vec3 } from "../lib/mpr-navigation";
import type { MprQuality } from "../lib/mpr-quality";
import { orbitCamera } from "../lib/mpr-orbit";
import { applyVolumeDisplay, buildVolumeTransfer, getVolumeSampling, getVolumeScalarRange, type VolumeDisplayActor, type VolumePalette, type VolumeRenderMode, type VolumeRenderQuality } from "../lib/volume-rendering";
import { createAsyncViewportToggle } from "../lib/async-viewport";
import SegmentationControls, { type MaskDisplay } from "./SegmentationControls";
import { assertMaskMatchesSource, renderMaskPlane, sourceGeometry, type LabelMask, type Point3 } from "../lib/segmentation-mask";
import { prepareAnalysisPackage, type AnalysisPackage } from "../lib/analysis-package";
import { prepareAnalysisStream, type AnalysisStream } from "../lib/analysis-stream";
import type { DicomSeries } from "../lib/dicom-series";

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
  setInterpolation: (mode: "linear" | "nearest") => void;
  set3DActive: (enabled: boolean, target: HTMLDivElement) => Promise<boolean>;
  orbit3D: (horizontal: number, vertical: number) => void;
  update3D: (mode: VolumeRenderMode, threshold: number, opacity: number, palette: VolumePalette, quality: VolumeRenderQuality, interpolation: "linear" | "nearest") => void;
  zoom3D: (factor: number) => void;
  reset3D: () => void;
  importMask: (mask: LabelMask, display: MaskDisplay) => void;
  setMaskDisplay: (display: MaskDisplay) => void;
  clearMask: () => void;
  focusPoint: (point: Point3) => void;
  prepareStream: (signal: AbortSignal) => Promise<AnalysisStream>;
  preparePackage: (signal: AbortSignal) => Promise<AnalysisPackage>;
};

const emptyReadouts = (): Readouts => ({ axial:{index:0,total:1}, coronal:{index:0,total:1}, sagittal:{index:0,total:1} });
const emptyCrosshairs = (): Crosshairs => ({ axial:null, coronal:null, sagittal:null });
const captions: Record<Plane,string> = { axial:"АКСИАЛЬНАЯ", coronal:"КОРОНАЛЬНАЯ", sagittal:"САГИТТАЛЬНАЯ" };

/**
 * Research-only interactive MPR with a single patient-space crosshair point.
 * All input stays in the browser and is gated by checkMprEligibility upstream.
 * This is NOT a calibrated diagnostic viewer or a measurement instrument.
 */
export default function CornerstoneMPR({ files, sourceSeries, quality, show3D, onShow3DChange }: { files: File[]; sourceSeries: DicomSeries; quality: MprQuality; show3D: boolean; onShow3DChange: (enabled: boolean) => void }) {
  const axial = useRef<HTMLDivElement>(null);
  const coronal = useRef<HTMLDivElement>(null);
  const sagittal = useRef<HTMLDivElement>(null);
  const volume3d = useRef<HTMLDivElement>(null);
  const maskCanvases = useRef<Record<Plane, HTMLCanvasElement | null>>({axial:null,coronal:null,sagittal:null});
  const drag3d = useRef<{ x: number; y: number } | null>(null);
  const runtime = useRef<Runtime | null>(null);
  const [status, setStatus] = useState("Подготовка MPR…");
  const [error, setError] = useState("");
  const [ready, setReady] = useState(false);
  const [readouts, setReadouts] = useState<Readouts>(emptyReadouts);
  const [crosshairs, setCrosshairs] = useState<Crosshairs>(emptyCrosshairs);
  const [interpolation, setInterpolation] = useState<"linear" | "nearest">("linear");
  const [threeDReady, setThreeDReady] = useState(false);
  const [threeDBusy, setThreeDBusy] = useState(false);
  const [threeDError, setThreeDError] = useState("");
  const [renderMode, setRenderMode] = useState<VolumeRenderMode>("composite");
  const [threshold, setThreshold] = useState(28);
  const [opacity, setOpacity] = useState(48);
  const [palette, setPalette] = useState<VolumePalette>("neutral");
  const [renderQuality, setRenderQuality] = useState<VolumeRenderQuality>("balanced");
  const [volumeInterpolation, setVolumeInterpolation] = useState<"linear" | "nearest">("linear");
  const [expanded3D, setExpanded3D] = useState(false);
  const [volumeStats, setVolumeStats] = useState<{ dimensions: number[]; decodedMiB: number } | null>(null);
  const [intensityRange, setIntensityRange] = useState<[number, number] | null>(null);
  const featuredPlane = quality.nativePlane ?? "axial";

  useEffect(() => {
    const elements = { axial:axial.current, coronal:coronal.current, sagittal:sagittal.current };
    if (!files.length || PLANE_NAMES.some(p => !elements[p])) return;
    let cancelled = false;
    let dispose: (() => void) | null = null;
    let observer: ResizeObserver | null = null;
    let ownedRuntime: Runtime | null = null;
    let maskState: {mask:LabelMask;display:MaskDisplay} | null = null;
    let maskFrame: number | null = null;
    const clearMaskCanvases = () => {
      for (const p of PLANE_NAMES) {
        const canvas = maskCanvases.current[p];
        canvas?.getContext("2d")?.clearRect(0,0,canvas.width,canvas.height);
      }
    };
    clearMaskCanvases();
    const id = crypto.randomUUID();
    const volumeId = `ora-mpr-${id}`;
    runtime.current = null;
    setReady(false);
    setThreeDReady(false);
    setThreeDBusy(false);
    setThreeDError("");
    setCrosshairs(emptyCrosshairs());
    setReadouts(emptyReadouts());
    setInterpolation("linear");
    setVolumeStats(null);
    setIntensityRange(null);
    drag3d.current = null;
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
      const viewport3dId = `ora-3d-viewport-${id}`;
      let viewport3d: Types.IVolumeViewport | null = null;
      let target3d: HTMLDivElement | null = null;
      let requestedTarget3d: HTMLDivElement | null = null;
      let toggle3d: ReturnType<typeof createAsyncViewportToggle> | null = null;
      let volumeAllocated = false;
      const release = () => {
        if (maskFrame !== null) cancelAnimationFrame(maskFrame);
        maskFrame = null;
        maskState = null;
        // Late cleanup of an old series must not erase a newer overlay.
        if (runtime.current === ownedRuntime || !runtime.current) clearMaskCanvases();
        observer?.disconnect();
        observer = null;
        if (runtime.current === ownedRuntime) runtime.current = null;
        toggle3d?.dispose();
        viewport3d = null;
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
        let decodedBytes = 0;
        for (let i = 0; i < imageIds.length; i++) {
          if (cancelled) return;
          if (i % 5 === 0) setStatus(`Загрузка кадров для MPR: ${i + 1} / ${imageIds.length}`);
          const image = await core.imageLoader.loadAndCacheImage(imageIds[i]);
          // Composite VoxelManager.sizeInBytes is NaN in Cornerstone 4.18.3:
          // bytePerVoxel reads BYTES_PER_ELEMENT from a numeric voxel value.
          // DICOM loader image.sizeInBytes is the decoded pixel buffer length.
          decodedBytes += Number.isFinite(image.sizeInBytes) && image.sizeInBytes > 0 ? image.sizeInBytes : NaN;
        }
        if (cancelled) return;
        setStatus("Проверка геометрии и сборка объёма…");
        const volume = await core.volumeLoader.createAndCacheVolumeFromImages(volumeId, imageIds);
        volumeAllocated = true;
        if (cancelled) return;
        if (!volume || volume.dimensions?.[2] !== imageIds.length) {
          throw new Error("Полученный объём не соответствует количеству кадров серии.");
        }
        setVolumeStats({ dimensions: [...volume.dimensions], decodedMiB: decodedBytes / 1048576 });
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

        const getMaskSource = () => sourceGeometry(volume.dimensions, p=>core.utilities.transformIndexToWorld(volume.imageData,p));
        const drawMask = () => {
          maskFrame = null;
          if (cancelled) return;
          if (!maskState?.display.visible) { clearMaskCanvases(); return; }
          const {mask,display} = maskState;
          try {
            for (const p of PLANE_NAMES) {
              const canvas = maskCanvases.current[p];
              const rect = elements[p]!.getBoundingClientRect();
              const ctx = canvas?.getContext("2d");
              if (!canvas || !ctx || !rect.width || !rect.height) continue;
              // Bound display work on M1. The stored mask remains full resolution.
              const scale = Math.min(1,384/Math.max(rect.width,rect.height));
              const w = Math.max(1,Math.round(rect.width*scale)), h=Math.max(1,Math.round(rect.height*scale));
              const px=rect.width/w, py=rect.height/h;
              const origin = views[p].canvasToWorld([px/2,py/2]) as Point3;
              const wx = views[p].canvasToWorld([px*1.5,py/2]);
              const wy = views[p].canvasToWorld([px/2,py*1.5]);
              const rgba = renderMaskPlane(mask,origin,wx.map((v,i)=>v-origin[i]) as Point3,wy.map((v,i)=>v-origin[i]) as Point3,w,h,display.opacity,display.label);
              canvas.width=w;canvas.height=h;
              const image=ctx.createImageData(w,h);image.data.set(rgba);ctx.putImageData(image,0,0);
            }
          } catch(cause) {
            clearMaskCanvases();
            setError(`Наложение маски остановлено: ${cause instanceof Error ? cause.message : String(cause)}`);
          }
        };
        const scheduleMask = () => {
          if (cancelled || maskFrame !== null) return;
          maskFrame = requestAnimationFrame(drawMask);
        };

        const synchronize = (next: Vec3) => {
          if (cancelled) return;
          if (!next.every(Number.isFinite)) return;
          point = next;
          const nextReadouts = emptyReadouts();
          const nextCrosshairs = emptyCrosshairs();
          for (const p of PLANE_NAMES) {
            const v = views[p];
            const camera = v.getCamera();
            if (!camera.focalPoint || !camera.position || !camera.viewPlaneNormal) {
              throw new Error("Отсутствуют параметры пространственной камеры MPR.");
            }
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
          scheduleMask();
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
            const beforeFocal = v.getCamera().focalPoint;
            if (!beforeFocal) throw new Error("Неизвестно начальное положение MPR-камеры.");
            const before = [...beforeFocal] as Vec3;
            core.utilities.scroll(v as Parameters<typeof core.utilities.scroll>[0], {delta:next - current, volumeId});
            const afterCamera = v.getCamera();
            if (!afterCamera.focalPoint || !afterCamera.viewPlaneNormal) {
              throw new Error("Неизвестно положение MPR-камеры после прокрутки.");
            }
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
        const setRenderingInterpolation = (mode: "linear" | "nearest") => {
          const interpolationType = mode === "nearest" ? core.Enums.InterpolationType.NEAREST : core.Enums.InterpolationType.LINEAR;
          for (const p of PLANE_NAMES) {
            views[p].setProperties({ interpolationType }, volumeId);
            views[p].render();
          }
        };
        const disable3D = () => {
          if (target3d) observer?.unobserve(target3d);
          target3d = null;
          if (engine?.getViewport(viewport3dId)) {
            try { engine.disableElement(viewport3dId); } catch { /* not mounted */ }
          }
          viewport3d = null;
        };
        toggle3d = createAsyncViewportToggle(async isCurrent => {
          if (cancelled || !engine || !requestedTarget3d || !isCurrent()) return;
          if (viewport3d) return;
          const target = requestedTarget3d;
          target3d = target;
          // Same source volume and same rendering engine: avoid decoding a second
          // copy of the study on an 8 GiB Mac. This is volume rendering, NOT an
          // anatomical segmentation or a clinically validated surface model.
          engine.enableElement({
            viewportId: viewport3dId,
            type: core.Enums.ViewportType.VOLUME_3D,
            element: target,
            defaultOptions: { background: [0.01, 0.04, 0.06] },
          });
          await core.setVolumesForViewports(engine, [{ volumeId }], [viewport3dId]);
          if (cancelled || !engine || !isCurrent()) return;
          const vp = engine.getViewport(viewport3dId) as Types.IVolumeViewport;
          viewport3d = vp;
          vp.resetCamera();
          observer?.observe(target);
          engine.resize(false, false);
          update3D("composite", 28, 48, "neutral", "balanced", "linear");
        }, disable3D);
        const set3DActive = (enabled: boolean, target: HTMLDivElement) => {
          if (cancelled || !toggle3d) return Promise.resolve(false);
          if (enabled) requestedTarget3d = target;
          return toggle3d.setActive(enabled);
        };
        // All display mappings act only on the VTK actor. Source DICOM pixels
        // and the three MPR viewports are never modified.
        let scalarRange: [number, number] | null = null;
        const update3D = (mode: VolumeRenderMode, thresholdPercent: number, opacityPercent: number,
          displayPalette: VolumePalette, displayQuality: VolumeRenderQuality, displayInterpolation: "linear" | "nearest") => {
          if (!viewport3d) return;
          // ImageVolume.imageData is not a vtkImageData scalar buffer in
          // Cornerstone3D 4.x. Volumes access intensities via VoxelManager.
          // getRange() avoids expanding/reallocating the entire 3D voxel array.
          const range = scalarRange ??= getVolumeScalarRange(volume);
          setIntensityRange(previous => previous ?? range);
          const mapping = buildVolumeTransfer(range, mode === "mip" ? 0 : thresholdPercent, mode === "mip" ? 100 : opacityPercent, displayPalette);
          const actor = viewport3d.getDefaultActor()?.actor as unknown as VolumeDisplayActor;
          applyVolumeDisplay(actor, mapping, {
            ...getVolumeSampling(volume.spacing, volume.dimensions, displayQuality),
            blendMode: mode === "mip" ? core.Enums.BlendModes.MAXIMUM_INTENSITY_BLEND : core.Enums.BlendModes.COMPOSITE,
            interpolationType: displayInterpolation === "nearest" ? core.Enums.InterpolationType.NEAREST : core.Enums.InterpolationType.LINEAR,
          });
          viewport3d.render();
        };
        const zoom3D = (factor: number) => {
          if (!viewport3d || !Number.isFinite(factor) || factor <= 0) return;
          const current = viewport3d.getZoom();
          viewport3d.setZoom(Math.max(0.25, Math.min(8, current * factor)));
          viewport3d.render();
        };
        const reset3D = () => {
          if (!viewport3d) return;
          viewport3d.resetCamera();
          viewport3d.render();
        };
        const orbit3D = (horizontal: number, vertical: number) => {
          if (!viewport3d || !Number.isFinite(horizontal) || !Number.isFinite(vertical)) return;
          const camera = viewport3d.getCamera();
          if (!camera.position || !camera.focalPoint || !camera.viewUp) return;
          const pose = orbitCamera({
            position: [...camera.position] as Vec3,
            focalPoint: [...camera.focalPoint] as Vec3,
            viewUp: [...camera.viewUp] as Vec3,
          }, horizontal, vertical);
          viewport3d.setCamera(pose);
          viewport3d.render();
        };
        ownedRuntime = {
          step, pick, set3DActive, orbit3D, update3D, zoom3D, reset3D,
          preparePackage: signal => {
            const manager=volume.voxelManager;
            if (cancelled || !manager || manager.numberOfComponents !== 1) throw new Error("Нужен активный скалярный объём.");
            return prepareAnalysisPackage(sourceSeries,getMaskSource(),i=>{
              if (cancelled) throw new DOMException("Серия закрыта.","AbortError");
              const value=manager.getAtIndex(i);
              if (typeof value!=="number") throw new Error("Объём содержит многокомпонентные пиксели.");
              return value;
            },signal);
          },
          prepareStream: signal => {
            if (sourceSeries.modality!=="CT") throw new Error("R231 поддерживает только КТ грудной клетки в HU.");
            const manager=volume.voxelManager;
            if (cancelled || !manager || manager.numberOfComponents !== 1) throw new Error("Нужен активный скалярный объём.");
            return prepareAnalysisStream(sourceSeries,getMaskSource(),i=>{
              if (cancelled) throw new DOMException("Серия закрыта.","AbortError");
              const value=manager.getAtIndex(i);
              if (typeof value!=="number") throw new Error("Объём содержит многокомпонентные пиксели.");
              return value;
            },signal);
          },
          importMask: (mask, display) => {
            if (cancelled) throw new Error("Выбранная серия уже закрыта.");
            assertMaskMatchesSource(mask,getMaskSource());
            maskState={mask,display};scheduleMask();
          },
          setMaskDisplay: display => {if(maskState&&!cancelled){maskState.display=display;scheduleMask();}},
          clearMask: () => {maskState=null;scheduleMask();},
          focusPoint: world => {
            if(cancelled || world.length!==3 || !world.every(Number.isFinite))throw new Error("Точка Evidence недоступна.");
            const index=core.utilities.transformWorldToIndex(volume.imageData,world);
            if(!insideImageExtent(index,volume.dimensions))throw new Error("Точка Evidence за пределами выбранной серии.");
            synchronize([...world] as Vec3);
          },
          setInterpolation: setRenderingInterpolation,
          reset: () => {
            for (const p of PLANE_NAMES) views[p].resetCamera();
            const resetFocal = views.axial.getCamera().focalPoint;
            if (resetFocal) synchronize([...resetFocal] as Vec3);
          },
        };
        runtime.current = ownedRuntime;
        setRenderingInterpolation("linear");
        synchronize(point);
        observer = new ResizeObserver(() => {
          if (cancelled || !engine) return;
          try {
            // Preserve orbit and zoom when the 3D panel changes size.
            engine.resize(false,false);
            synchronize(point);
            viewport3d?.render();
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
    return () => { cancelled = true; if (runtime.current === ownedRuntime) runtime.current = null; dispose?.(); };
  }, [files,sourceSeries]);

  // The 3D panel is opt-in; do not create its GPU actor while hidden. When
  // leaving 3D, disable that viewport but preserve the three MPR viewports.
  useEffect(() => {
    if (!ready || !volume3d.current || !runtime.current) return;
    let active = true;
    const currentRuntime = runtime.current;
    if (show3D) {
      setThreeDBusy(true);
      setThreeDError("");
      const target = volume3d.current;
      // Wait for the visible panel to receive dimensions in the new layout.
      const frame = requestAnimationFrame(() => {
        currentRuntime.set3DActive(true, target).then(enabled => {
          if (active) setThreeDReady(enabled);
        }).catch((cause: unknown) => {
          if (active) setThreeDError(cause instanceof Error ? cause.message : String(cause));
        }).finally(() => { if (active) setThreeDBusy(false); });
      });
      return () => { active = false; cancelAnimationFrame(frame); currentRuntime.set3DActive(false, target).catch(() => {}); setThreeDReady(false); };
    }
    currentRuntime.set3DActive(false, volume3d.current).catch(() => {});
    setThreeDReady(false);
  }, [ready, show3D]);

  // Changing rendering presets must not recreate or re-decode the shared volume.
  useEffect(() => {
    if (!show3D || !threeDReady) return;
    try { runtime.current?.update3D(renderMode, threshold, opacity, palette, renderQuality, volumeInterpolation); setThreeDError(""); }
    catch (cause: unknown) { setThreeDError(cause instanceof Error ? cause.message : String(cause)); }
  }, [show3D, threeDReady, renderMode, threshold, opacity, palette, renderQuality, volumeInterpolation]);

  useEffect(() => {
    if (!show3D) { setExpanded3D(false); drag3d.current = null; }
  }, [show3D]);

  useEffect(() => {
    if (!expanded3D) return;
    const onEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") setExpanded3D(false);
    };
    window.addEventListener("keydown", onEscape);
    return () => window.removeEventListener("keydown", onEscape);
  }, [expanded3D]);

  useEffect(() => {
    const target = volume3d.current;
    if (!show3D || !threeDReady || !target) return;
    const wheel = (event: globalThis.WheelEvent) => {
      if (event.ctrlKey || event.metaKey || !event.deltaY) return;
      event.preventDefault();
      runtime.current?.zoom3D(event.deltaY < 0 ? 1.08 : 1 / 1.08);
    };
    target.addEventListener("wheel", wheel, { passive: false });
    return () => target.removeEventListener("wheel", wheel);
  }, [show3D, threeDReady]);

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
    <div className="ora-mpr-quality">
      <div className="ora-mpr-quality-top">
        <strong>Геометрия исходной серии</strong>
        {quality.pixelSpacingMm && quality.sliceSpacingMm !== null ?
          <span>{quality.pixelSpacingMm.map(v=>v.toFixed(2)).join(" × ")} × {quality.sliceSpacingMm.toFixed(2)} мм</span> :
          <span>Шаги неизвестны</span>}
      </div>
      <p className={quality.interpolationRisk === "high" ? "ora-mpr-quality-warn" : ""}>{quality.message}</p>
      <div className="ora-mpr-volume-stats">
        <span>Исходные срезы: <b>{files.length}</b></span>
        {volumeStats && <><span>Сетка: <b>{volumeStats.dimensions.join(" × ")}</b></span>
          <span>Декодированные пиксели: <b>{Number.isFinite(volumeStats.decodedMiB) ? volumeStats.decodedMiB.toFixed(1) + " МиБ" : "неизвестно"}</b></span></>}
      </div>
      <small>Это размер пиксельных данных, а не общее потребление RAM/GPU. Файлы, текстуры и буферы рендеринга требуют дополнительной памяти.</small>
      <div className="ora-mpr-interpolation" role="group" aria-label="Интерполяция MPR">
        <span>Интерполяция:</span>
        <button type="button" disabled={!ready} aria-pressed={interpolation === "linear"} className={interpolation === "linear" ? "active" : ""}
          onClick={() => { try { runtime.current?.setInterpolation("linear"); setInterpolation("linear"); } catch (e) {setError(e instanceof Error ? e.message : String(e));} }}>Плавная</button>
        <button type="button" disabled={!ready} aria-pressed={interpolation === "nearest"} className={interpolation === "nearest" ? "active" : ""}
          onClick={() => { try { runtime.current?.setInterpolation("nearest"); setInterpolation("nearest"); } catch (e) {setError(e instanceof Error ? e.message : String(e));} }}>Без сглаживания</button>
      </div>
      <small>{interpolation === "linear" ? "Линейная интерполяция сглаживает границы между вокселями." : "Ближайший сосед показывает ступенчатость дискретных данных, но не добавляет деталей."}</small>
    </div>
    <SegmentationControls ready={ready}
      onPrepare={signal=>{
        if (!runtime.current) throw new Error("Объём ещё не готов.");
        return runtime.current.preparePackage(signal);
      }}
      onPrepareStream={signal=>{
        if (!runtime.current) throw new Error("Объём ещё не готов.");
        return runtime.current.prepareStream(signal);
      }}
      onImport={(mask,display)=>{
        if (!runtime.current) throw new Error("Сначала дождитесь загрузки MPR.");
        runtime.current.importMask(mask,display);
      }}
      onDisplay={display=>runtime.current?.setMaskDisplay(display)}
      onClear={()=>runtime.current?.clearMask()}
      onNavigatePoint={point=>{
        if(!runtime.current)throw new Error("Выбранная серия уже закрыта.");
        runtime.current.focusPoint(point);
      }}/>
    <div className="ora-mpr-3d-toolbar">
      <button type="button" className={show3D ? "active" : ""} disabled={!ready} aria-pressed={show3D}
        onClick={() => onShow3DChange(!show3D)}>{show3D ? "Скрыть 3D" : "Показать 3D"}</button>
      <span>3D: объёмный рендеринг или MIP — без сегментации. Исходные данные не меняются.</span>
    </div>
    {show3D && quality.interpolationRisk === "high" && <p className="ora-mpr-3d-warning" role="note">
      Внимание: шаг между срезами {quality.sliceSpacingMm?.toFixed(2)} мм. Объём анизотропный: 3D-проекция условная, мелкие структуры и границы могут искажаться.
    </p>}
      <div className={`ora-mpr-3d-panel ${show3D ? "visible" : ""} ${expanded3D ? "expanded" : ""}`} aria-hidden={!show3D}>
        <div className="ora-mpr-3d-title"><strong>3D · {renderMode === "composite" ? "Объём" : "MIP"}</strong><span>{threeDBusy ? "Загрузка 3D…" : threeDReady ? "Мышь — поворот · колесо — масштаб" : "Экспериментально"}</span>
          <button type="button" disabled={!threeDReady} aria-pressed={expanded3D} onClick={() => setExpanded3D(!expanded3D)}>{expanded3D ? "Свернуть · Esc" : "Развернуть 3D"}</button>
        </div>
        <div className="ora-mpr-render-controls">
          <div className="ora-mpr-render-modes" role="group" aria-label="Способ отображения 3D">
            <button type="button" className={renderMode === "composite" ? "active" : ""} aria-pressed={renderMode === "composite"} disabled={!threeDReady} onClick={() => setRenderMode("composite")}>Объём · прозрачность</button>
            <button type="button" className={renderMode === "mip" ? "active" : ""} aria-pressed={renderMode === "mip"} disabled={!threeDReady} onClick={() => setRenderMode("mip")}>MIP · максимум</button>
          </div>
          <label>Порог интенсивности <b>{threshold}%</b>
            <input type="range" min="0" max="85" step="1" value={threshold} disabled={!threeDReady || renderMode === "mip"} onChange={event => setThreshold(Number(event.target.value))}/>
          </label>
          <label>Непрозрачность <b>{opacity}%</b>
            <input type="range" min="5" max="100" step="1" value={opacity} disabled={!threeDReady || renderMode === "mip"} onChange={event => setOpacity(Number(event.target.value))}/>
          </label>
          <label>Цветовая шкала
            <select value={palette} disabled={!threeDReady} onChange={event => setPalette(event.target.value as VolumePalette)}>
              <option value="neutral">Нейтральная · серый</option><option value="cool">Холодная · голубой</option>
            </select>
          </label>
          <label>Качество рендеринга
            <select value={renderQuality} disabled={!threeDReady} onChange={event => setRenderQuality(event.target.value as VolumeRenderQuality)}>
              <option value="economy">Экономное</option><option value="balanced">Сбалансированное</option><option value="fine">Детальное · выше нагрузка</option>
            </select>
          </label>
          <label>Интерполяция 3D
            <select value={volumeInterpolation} disabled={!threeDReady} onChange={event => setVolumeInterpolation(event.target.value as "linear" | "nearest")}>
              <option value="linear">Линейная · плавная</option><option value="nearest">Ближайший сосед · без сглаживания</option>
            </select>
          </label>
          {intensityRange && <p>Диапазон сигнала: {intensityRange[0].toFixed(1)} … {intensityRange[1].toFixed(1)}. Порог задан относительно этого диапазона; значения МРТ не обозначают плотность ткани.</p>}
          <p>Качество меняет шаг расчёта лучей, интерполяция — отображение границ вокселей. Эти настройки не восстанавливают отсутствующие срезы.</p>
          <p>{renderMode === "mip" ? "MIP показывает максимальные интенсивности вдоль луча; настройки прозрачности не применяются." : "Интерактивная прозрачность и цветовая шкала. Параметры только отображения, не сегментация тканей."}</p>
        </div>
        <div ref={volume3d} className="ora-mpr-3d-canvas" onPointerDown={(event: PointerEvent<HTMLDivElement>) => {
          if (!threeDReady || event.button !== 0) return;
          event.preventDefault();
          drag3d.current = {x:event.clientX,y:event.clientY};
          event.currentTarget.setPointerCapture(event.pointerId);
        }} onPointerMove={(event: PointerEvent<HTMLDivElement>) => {
          if (!drag3d.current || !threeDReady) return;
          runtime.current?.orbit3D((event.clientX-drag3d.current.x)*0.4, (event.clientY-drag3d.current.y)*0.4);
          drag3d.current = {x:event.clientX,y:event.clientY};
        }} onPointerUp={(event: PointerEvent<HTMLDivElement>) => {
          drag3d.current = null;
          if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
        }} onPointerCancel={() => {drag3d.current=null;}} onLostPointerCapture={() => {drag3d.current=null;}}/>
        {threeDError && <div className="cs-error" role="alert">3D недоступно: {threeDError}. MPR продолжает работать.</div>}
        <div className="ora-mpr-3d-actions">
          <button type="button" disabled={!threeDReady} onClick={() => runtime.current?.orbit3D(-15,0)}>↶ Повернуть</button>
          <button type="button" disabled={!threeDReady} onClick={() => runtime.current?.orbit3D(15,0)}>Повернуть ↷</button>
          <button type="button" disabled={!threeDReady} onClick={() => runtime.current?.orbit3D(0,15)}>Наклонить ↓</button>
          <button type="button" disabled={!threeDReady} onClick={() => runtime.current?.zoom3D(1.2)}>Увеличить +</button>
          <button type="button" disabled={!threeDReady} onClick={() => runtime.current?.zoom3D(1 / 1.2)}>Уменьшить −</button>
          <button type="button" disabled={!threeDReady} onClick={() => runtime.current?.reset3D()}>Сбросить вид</button>
        </div>
      </div>
    <div className="ora-mpr-grid">
      {PLANE_NAMES.map((plane) => {
        const ref = plane === "axial" ? axial : plane === "coronal" ? coronal : sagittal;
        const position = crosshairs[plane];
        const info = readouts[plane];
        return <div className={`ora-mpr-plane ora-mpr-${plane} ${featuredPlane === plane ? "ora-mpr-featured" : ""}`} key={plane}>
          <div className="ora-mpr-surface" tabIndex={ready ? 0 : -1}
            aria-label={`${captions[plane]} плоскость: колесо мыши — листать срезы, клик — выбрать точку`}
            onWheel={event => onWheel(event, plane)} onClick={event => onClick(event, plane)}
            onKeyDown={event => onKeyDown(event,plane)}>
            <div className="ora-mpr-canvas" ref={ref}/>
            <canvas className="ora-mpr-mask-overlay" aria-hidden="true" ref={canvas=>{maskCanvases.current[plane]=canvas;}}/>
            <span className="ora-mpr-plane-label">{plane.toUpperCase()} · {captions[plane]}</span>
            {ready && position && <div className="ora-mpr-crosshair" aria-hidden="true" style={{left:position.x,top:position.y}}/>}
          </div>
          {featuredPlane === plane && <div className="ora-mpr-native-label">{quality.nativePlane ? "Плоскость исходной серии · приоритетный просмотр" : "Ориентация исходной серии неизвестна / косая"}</div>}
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
