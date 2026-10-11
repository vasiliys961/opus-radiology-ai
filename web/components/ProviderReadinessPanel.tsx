"use client";

import { useEffect, useState } from "react";
import type { AiProvider } from "../lib/ai-gateway";
import type {
  CatalogModel, ProviderReadinessReport, RoleCheck,
} from "../lib/provider-readiness";

type Props = {
  provider: AiProvider;
  selectedVision: string;
  selectedClinical: string;
};
function outcome(label: string, role: RoleCheck) {
  if (!role.configured) return label + ": серверная модель не настроена";
  if (role.inCatalogue === null) return label + ": каталог не проверен";
  if (!role.inCatalogue) return label + ": ID не найден в текущем каталоге";
  if (!role.matchingModality) return label + ": нужная модальность не заявлена";
  return label + ": ID и заявленная модальность найдены";
}
function ModelList({title, models}: {title: string; models: readonly CatalogModel[]}) {
  if (!models.length) return null;
  return <details className="ora-provider-model-list">
    <summary>{title} ({models.length} примеров)</summary>
    <ul>{models.map(model => <li key={model.id}>
      <strong>{model.name}</strong>
      <code>{model.id}</code>
    </li>)}</ul>
  </details>;
}
/** Read-only UI: never passes the DICOM study, selected file or clinical context. */
export default function ProviderReadinessPanel({
  provider, selectedVision, selectedClinical,
}: Props) {
  const [result, setResult] = useState<ProviderReadinessReport | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    setResult(null);
    setError("");
    setBusy(false);
  }, [provider]);
  const check = async () => {
    setBusy(true);
    setError("");
    setResult(null);
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 15_000);
      let response: Response;
      try {
        response = await fetch(
          "/api/ai/provider-readiness?provider=" + encodeURIComponent(provider),
          {method: "GET", cache: "no-store", signal: controller.signal},
        );
      } finally { clearTimeout(timer); }
      if (!response.ok) throw new Error("status " + response.status);
      const body: unknown = await response.json();
      if (!body || typeof body !== "object" ||
          (body as {schema?: unknown}).schema !== "opus-provider-readiness/v1" ||
          (body as {provider?: unknown}).provider !== provider)
        throw new Error("Unexpected diagnostic report");
      setResult(body as ProviderReadinessReport);
    } catch {
      setError("Диагностика недоступна. Она работает только на localhost в npm run dev. " +
        "Проверьте интернет, серверный ключ и повторите попытку.");
    } finally { setBusy(false); }
  };
  return <section className="ora-provider-panel" aria-label="Диагностика AI-провайдера">
    <div className="ora-v17-heading">
      <strong>Проверка подключения AI-шлюза</strong>
      <span>v1.8 · без данных пациентов</span>
    </div>
    <p>Проверим локальный сервер и каталог моделей. Снимки и клинический
      контекст не передаются. Ключ не раскрывается в браузере, но отправляется
      самому провайдеру в серверном заголовке авторизации.</p>
    <button type="button" className="ora-provider-check" disabled={busy}
      onClick={() => {void check();}}>
      {busy ? "Проверяем…" : "Проверить " + (provider === "openrouter" ? "OpenRouter" : "Polza")}
    </button>
    {error && <p className="ora-provider-error" role="alert">{error}</p>}
    {result && <div className="ora-provider-results" aria-live="polite">
      <div className="ora-provider-status-row">
        <strong>Серверный ключ</strong>
        <span className={result.keyConfigured ? "ora-provider-good" : "ora-provider-warn"}>
          {result.keyConfigured ? "Настроен (значение скрыто)" : "Не найден"}
        </span>
      </div>
      <div className="ora-provider-status-row">
        <strong>Каталог моделей</strong>
        <span className={result.catalogStatus === "verified-response" ?
          "ora-provider-good" : "ora-provider-warn"}>
          {result.catalogStatus === "verified-response" ? "Получен" :
            result.catalogStatus === "not-supported" ? "Polza: не проверяется" :
            result.catalogStatus === "unavailable" ? "Недоступен" : "Проверка отключена"}
        </span>
      </div>
      <ul className="ora-provider-role-checks">
        <li>{outcome("Vision", result.vision)}
          {result.vision.modelId && <code>{result.vision.modelId}</code>}</li>
        <li>{outcome("Клиническая модель", result.clinical)}
          {result.clinical.modelId && <code>{result.clinical.modelId}</code>}</li>
      </ul>
      <p className="ora-provider-config-note">
        Выбрано в интерфейсе: Vision <code>{selectedVision}</code>,
        клинический синтез <code>{selectedClinical}</code>.
        Это предпочтения браузера, не серверная конфигурация.
      </p>
      <ModelList title="Vision: заявлена поддержка изображений" models={result.suggestions.vision}/>
      <ModelList title="Синтез: заявлена поддержка текста" models={result.suggestions.clinical}/>
      {result.notes.map((note, i) => <p key={i} className="ora-provider-note">{note}</p>)}
      <p className="ora-provider-safety">
        Реальный пациентский AI-анализ: заблокирован. Эта диагностика не разрешает
        отправку снимков и не подтверждает клиническую пригодность моделей.
      </p>
    </div>}
  </section>;
}
