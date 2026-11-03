/** One-based physician input; returns original zero-based indices, never renumbers source slices. */
export function parseStudySliceSelection(text:string,total:number):number[]{
 if(!Number.isSafeInteger(total)||total<1||total>2000||text.length>10000)throw Error('Недопустимый размер серии.');
 const selected=new Set<number>();
 for(const part of text.trim().split(/[,;\s]+/)){
  const match=/^(\d+)(?:[-–](\d+))?$/.exec(part);
  if(!match)throw Error('Укажите номера или диапазоны: например 5, 12, 20–35.');
  const first=Number(match[1]),last=Number(match[2]??match[1]);
  if(first<1||last<first||last>total)throw Error('Номера должны быть от 1 до '+total+', начало диапазона — не больше конца.');
  for(let n=first;n<=last;n++)selected.add(n-1);
 }
 return [...selected].sort((a,b)=>a-b);
}
