"use client";

import { useEffect, useRef, useState } from "react";
import type { Types } from "@cornerstonejs/core";

/**
 * Experimental patient-space MPR. The caller MUST enforce the geometry and
 * memory preflight before mounting. This component intentionally never uploads
 * images or makes an inference/diagnostic claim.
 */
export default function CornerstoneMPR({ files }: { files: File[] }) {
  const axial = useRef<HTMLDivElement>(null);
  const coronal = useRef<HTMLDivElement>(null);
  const sagittal = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState("Подготовка MPR…");
  const [error, setError] = useState("");

  useEffect(() => {
    if (!files.length || !axial.current || !coronal.current || !sagittal.current) return;
    let cancelled = false;
    let dispose: (() => void) | null = null;
    let observer: ResizeObserver | null = null;
    const id = crypto.randomUUID();
    const volumeId = `ora-mpr-${id}`;

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
        // The browser's local file IDs have no remotely prefetched metadata.
        // Loading each image populates imagePlaneModule metadata before volume
        // construction. This path intentionally has a strict upstream RAM gate.
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
        const ids = ["axial", "coronal", "sagittal"].map(plane => `ora-mpr-${plane}-${id}`);
        engine.setViewports([
          { viewportId: ids[0], type: core.Enums.ViewportType.ORTHOGRAPHIC, element: axial.current!, defaultOptions: { orientation: core.Enums.OrientationAxis.AXIAL } },
          { viewportId: ids[1], type: core.Enums.ViewportType.ORTHOGRAPHIC, element: coronal.current!, defaultOptions: { orientation: core.Enums.OrientationAxis.CORONAL } },
          { viewportId: ids[2], type: core.Enums.ViewportType.ORTHOGRAPHIC, element: sagittal.current!, defaultOptions: { orientation: core.Enums.OrientationAxis.SAGITTAL } },
        ]);
        await core.setVolumesForViewports(engine, [{ volumeId }], ids);
        if (cancelled) return;
        for (const viewportId of ids) {
          const view = engine.getViewport(viewportId) as Types.IVolumeViewport;
          view.resetCamera();
          view.render();
        }
        observer = new ResizeObserver(() => {
          if (cancelled || !engine) return;
          try { engine.resize(true, false); } catch { /* resized after teardown */ }
        });
        for (const el of [axial.current, coronal.current, sagittal.current]) if (el) observer.observe(el);
        setStatus("Три ортогональные плоскости · экспериментальный MPR");
      } finally {
        if (cancelled) release();
      }
    })().catch((cause: unknown) => {
      if (!cancelled) {
        setError(cause instanceof Error ? cause.message : "Не удалось построить объём.");
        setStatus("MPR не построен. Обычный просмотр DICOM доступен.");
      }
      dispose?.();
    });
    return () => { cancelled = true; dispose?.(); };
  }, [files]);

  return <section className="ora-mpr" aria-label="Экспериментальная мультипланарная реконструкция">
    <div className="ora-mpr-status" role="status">{status}</div>
    {error && <div role="alert" className="cs-error">Ошибка MPR: {error}. Вернитесь в 2D-просмотр.</div>}
    <div className="ora-mpr-grid">
      <div className="ora-mpr-plane"><span>AXIAL · АКСИАЛЬНАЯ</span><div ref={axial}/></div>
      <div className="ora-mpr-plane"><span>CORONAL · КОРОНАЛЬНАЯ</span><div ref={coronal}/></div>
      <div className="ora-mpr-plane"><span>SAGITTAL · САГИТТАЛЬНАЯ</span><div ref={sagittal}/></div>
    </div>
    <p className="ora-mpr-warning">Исследовательский MPR · без измерений, диагностики и клинической валидации. Некорректные DICOM-метаданные могут вызвать отказ реконструкции.</p>
  </section>;
}
