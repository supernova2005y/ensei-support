// node --test で動かす（npm test）。Google Places API は呼ばず、手で作った営業時間で「その日に開いているか」の判定を確かめる。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ensureWithinLimit, openStatusOn, PlacesLimitError, weekdayOf, type Place, type UsageCounter } from '../places.ts';

const base: Place = { id: 'x', name: 'テスト店', businessStatus: 'OPERATIONAL' };
// 月〜土 10:00〜19:00、日曜は休み
const weekdaysOnly = {
  ...base,
  periods: [1, 2, 3, 4, 5, 6].map((day) => ({ open: { day, hour: 10, minute: 0 }, close: { day, hour: 19, minute: 0 } })),
};

test('weekdayOf: 2026-12-13 は日曜（実行する環境のタイムゾーンに左右されない）', () => {
  assert.equal(weekdayOf('2026-12-13'), 0);
});

test('openStatusOn: 日曜休みの店は、公演日（日）が休みになる', () => {
  assert.deepEqual(openStatusOn(weekdaysOnly, '2026-12-13'), { kind: 'closed_that_day' });
  assert.deepEqual(openStatusOn(weekdaysOnly, '2026-12-14'), { kind: 'open', ranges: ['10:00〜19:00'] });
});

test('openStatusOn: 日をまたぐ営業は「翌」を付け、昼と夜の2回営業は両方出す', () => {
  const p = {
    ...base,
    periods: [
      { open: { day: 0, hour: 18, minute: 0 }, close: { day: 1, hour: 2, minute: 0 } },
      { open: { day: 0, hour: 11, minute: 30 }, close: { day: 0, hour: 14, minute: 0 } },
    ],
  };
  assert.deepEqual(openStatusOn(p, '2026-12-13'), { kind: 'open', ranges: ['11:30〜14:00', '18:00〜翌02:00'] });
});

test('openStatusOn: 24時間営業・閉業・一時休業・営業時間なし', () => {
  assert.deepEqual(openStatusOn({ ...base, periods: [{ open: { day: 0, hour: 0, minute: 0 } }] }, '2026-12-13'), { kind: 'always' });
  assert.deepEqual(openStatusOn({ ...weekdaysOnly, businessStatus: 'CLOSED_PERMANENTLY' }, '2026-12-14'), { kind: 'closed_permanently' });
  assert.deepEqual(openStatusOn({ ...weekdaysOnly, businessStatus: 'CLOSED_TEMPORARILY' }, '2026-12-14'), { kind: 'closed_temporarily' });
  assert.deepEqual(openStatusOn(base, '2026-12-13'), { kind: 'unknown' });
});

test('ensureWithinLimit: 上限を超える呼び出しは、呼ぶ前に止める', async () => {
  const counter: UsageCounter = { used: async () => 895, add: async () => {} };
  await ensureWithinLimit(counter, 'nearby_enterprise', 5, 900);
  await assert.rejects(ensureWithinLimit(counter, 'nearby_enterprise', 6, 900), PlacesLimitError);
});
