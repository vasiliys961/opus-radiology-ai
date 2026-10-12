"use client";
import type {ProviderUsageReport,UsageStep} from "../lib/provider-usage";

const labels:Record<UsageStep,string>={anatomy:"Анатомия",observations:"Наблюдения",quality:"Качество",critic:"Критик",synthesis:"Синтез"};
const tokens=(v:number|null)=>v===null?"Неизвестно":String(v);
const money=(v:number|null,currency:string)=>v===null?"Неизвестно":`${v>0&&v<0.000001?v.toExponential(3):v.toFixed(6)} ${currency}`;
export default function SyntheticUsageReport({usage}:{usage?:ProviderUsageReport}) {
  return <section aria-label="Токены и стоимость синтетического прогона">
    <h4>Токены и стоимость</h4>
    {!usage?<p>В этом отчёте нет usage. Стоимость неизвестна.</p>:<>
      <p>Стоимость по ответам провайдера: <strong>{money(usage.totals.reportedCost,usage.currency)}</strong>
        {` · цена получена для ${usage.callsWithReportedCost}/5 вызовов.`}</p>
      <p>Входящие токены: {tokens(usage.totals.promptTokens)} · исходящие: {tokens(usage.totals.completionTokens)}
        {` · всего: ${tokens(usage.totals.totalTokens)}.`}</p>
      <div className="ora-v17-table-wrap"><table className="ora-v17-table">
        <caption>Пять завершённых этапов · данные провайдера</caption>
        <thead><tr><th>Этап / модель</th><th>Вход</th><th>Выход</th><th>Кеш / рассуждения</th><th>Стоимость</th></tr></thead>
        <tbody>{usage.calls.map(c=><tr key={c.step}><td>{labels[c.step]}<br/><code>{c.requestedModel}</code></td>
          <td>{tokens(c.promptTokens)}</td><td>{tokens(c.completionTokens)}</td>
          <td>{tokens(c.cachedTokens)} / {tokens(c.reasoningTokens)}</td><td>{money(c.reportedCost,c.currency)}</td></tr>)}</tbody>
      </table></div>
    </>}
    <p>Кеш и рассуждения — детализация, они не прибавляются к общему числу токенов.
      Это учёт завершённого прогона, не лимит расходов и не итоговый счёт.
      Неудачные или отменённые обращения могут быть оплачены отдельно; сверяйте расходы в кабинете шлюза.</p>
  </section>;
}
