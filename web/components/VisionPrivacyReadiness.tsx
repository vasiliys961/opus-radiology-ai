"use client";
import { assessPrivacyReadiness,type PrivacyReadinessInputs } from "../lib/privacy-readiness";

export default function VisionPrivacyReadiness(props:PrivacyReadinessInputs) {
  const status=assessPrivacyReadiness(props);
  return <section aria-label="Готовность локальных копий к проверке">
    <h4>Статус подготовки · {status.frames.filter(f=>f.localReviewDone).length}/{status.frames.length} кадров проверено вручную</h4>
    <p role="status">{props.busy?"Локальная операция выполняется; дождитесь завершения.":status.localReviewDone?
      "Локальные отметки заполнены. Облачная передача всё ещё заблокирована.":"Подготовка не завершена: осмотрите каждую точную копию и поставьте обе ручные отметки."}</p>
    {status.frames.length>0&&<div className="ora-v17-table-wrap"><table className="ora-v17-table">
      <caption>Выбранные копии · локальные неподтверждённые отметки</caption>
      <thead><tr><th>Кадр</th><th>OCR · помощь, не проверка</th><th>Надписи</th><th>Узнаваемые признаки</th><th>Скрыто областей</th></tr></thead>
      <tbody>{status.frames.map(f=><tr key={f.frameId}>
        <td>Кадр {f.frameId.slice(-1)}</td><td>{f.ocrState==="not-run"?"Не запускался":f.ocrState==="stale"?"Результат относится к старой копии":
          f.ocrState==="no-text-found"?"Надписи не найдены · не подтверждает обезличивание":
          `Найдено ${f.regionCount} · ${f.textAcknowledged?"оставлены по ручной отметке":"нужно скрыть или осмотреть"}`}</td>
        <td>{f.textReviewed?"Ручная отметка поставлена":"Нужна ручная проверка"}</td>
        <td>{f.visualReviewed?"Ручная отметка поставлена":"Нужна ручная проверка"}</td><td>{f.redactionCount}</td>
      </tr>)}</tbody>
    </table></div>}
    <details><summary>Что ещё требуется для серверного разрешения Cloud</summary><ul>
      {status.serverChecks.map(check=><li key={check.id}>{check.label} · не подключено</li>)}
    </ul><p>Локальные отметки, OCR и SHA не заменяют независимую проверку и авторизованный серверный контур.</p></details>
  </section>;
}
