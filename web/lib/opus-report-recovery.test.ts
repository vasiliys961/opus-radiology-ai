import test from 'node:test';
import assert from 'node:assert/strict';
import {createOpusReportRecovery,opusReportFailure} from './opus-report-recovery.ts';
test('recovery expires after ten minutes, is bounded and never retains oversized responses',()=>{
 let time=0;const cache=createOpusReportRecovery(()=>time);
 cache.put('a',{});cache.put('b',{});cache.put('c',{});
 assert.equal(cache.get('a'),undefined);assert.ok(cache.get('b'));
 time=600000;assert.equal(cache.get('b'),undefined);
 cache.put('oversized',{result:{finalReport:'x'.repeat(61000)} as never});assert.equal(cache.get('oversized'),undefined);
});
test('provider failures and incomplete/invalid reports have safe distinct messages without raw payloads',()=>{
 assert.equal(opusReportFailure(Error('AI provider returned HTTP 503')).code,'opus_provider_error');
 assert.equal(opusReportFailure(Error('Model response incomplete or refused')).code,'opus_incomplete');
 assert.equal(opusReportFailure(Error('Opus did not produce complete standard radiologist sections')).code,'opus_invalid_report');
 assert.equal(opusReportFailure(new DOMException('private','TimeoutError')).code,'opus_timeout');
 assert.ok(!JSON.stringify(opusReportFailure(Error('private patient text'))).includes('private'));
});
