import type {FullVolumeOpusResult} from './full-volume-opus-synthesis.ts';
/** Process-local, bounded checkpoint. No source pixels, disk persistence or automatic retries. */
export function createOpusReportRecovery(now=Date.now){
 const entries=new Map<string,{expires:number;visual?:FullVolumeOpusResult['visualReview'];result?:FullVolumeOpusResult}>();
 const clean=()=>{for(const [k,v] of entries)if(v.expires<=now())entries.delete(k);};
 return {
  get(key:string){clean();return entries.get(key);},
  put(key:string,value:{visual?:FullVolumeOpusResult['visualReview'];result?:FullVolumeOpusResult}){
   clean();if(JSON.stringify(value).length>60000)return;
   entries.delete(key);while(entries.size>=2)entries.delete(entries.keys().next().value!);
   entries.set(key,{...value,expires:now()+10*60_000});
  },
 };
}
export function opusReportFailure(error:unknown){
 const message=error instanceof Error?error.message:'';
 if(error instanceof Error&&['TimeoutError','AbortError'].includes(error.name))return {code:'opus_timeout',message:'Opus не успел завершить ответ. Полученные наблюдения сохранены.'};
 if(/HTTP [0-9]{3}/.test(message))return {code:'opus_provider_error',message:'Провайдер Opus вернул ошибку '+message.match(/HTTP [0-9]{3}/)![0]+'.'};
 if(/incomplete or refused/.test(message))return {code:'opus_incomplete',message:'Opus вернул незавершённый ответ или отказ. Итоговое заключение не получено.'};
 if(/complete volume input|Visual slice outside|Invalid targeted|Wrong visual/.test(message))return {code:'opus_input_invalid',message:'Не удалось подтвердить состав данных для заключения.'};
 if(/sections|required report fields|JSON|Unexpected|Expected one completion|token receipt/.test(message)||error instanceof SyntaxError)return {code:'opus_invalid_report',message:'Ответ Opus не прошёл проверку полноты и формата заключения.'};
 return {code:'opus_execution_failed',message:'Не удалось получить заключение Opus. Возможен сбой подключения к провайдеру.'};
}
