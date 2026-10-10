import test from 'node:test';
import assert from 'node:assert/strict';
import { MAX_DICOM_FILES, validateViewerFileSelection as validate } from './viewer-limits.ts';

test('rejects empty selection', () => assert.match(validate([]) ?? '', /Не выбраны/));
test('accepts bounded local stack', () => assert.equal(validate(Array.from({ length: 42 }, () => ({ size: 524288 }))), null));
test('rejects excessive number of images', () => assert.match(validate(Array.from({ length: MAX_DICOM_FILES + 1 }, () => ({ size: 1 }))) ?? '', /много файлов/));
test('rejects oversized object before read', () => assert.match(validate([{ size: 129 * 1024 * 1024 }]) ?? '', /128 МБ/));
test('rejects total allocation beyond 1 GB', () => assert.match(validate(Array.from({ length: 9 }, () => ({ size: 120 * 1024 * 1024 }))) ?? '', /1 ГБ/));
test('rejects malformed size', () => assert.match(validate([{ size: Number.POSITIVE_INFINITY }]) ?? '', /Некорректный/));
