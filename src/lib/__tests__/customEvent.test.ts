import assert from 'node:assert/strict';
import test from 'node:test';
import { buildCustomEvent, checkDate, checkStart, listVenueOptions } from '../customEvent.ts';
import { loadEvent } from '../events.ts';

const NOW = Date.UTC(2026, 11, 5, 3, 0, 0); // 2026-12-05 12:00 日本時間

test('会場の候補は events/ の会場から、同じ会場は1つにまとめて出す', () => {
  const options = listVenueOptions();
  assert.ok(options.length >= 1);
  assert.equal(new Set(options.map((o) => o.name)).size, options.length);
});

test('日付：形・過去・1年より先を断る', () => {
  assert.equal(checkDate('2026-12-05', NOW), null);
  assert.equal(checkDate('2027-12-05', NOW), null);
  assert.match(checkDate('2026-12-04', NOW)!, /過ぎた日付/);
  assert.match(checkDate('2027-12-06', NOW)!, /1年より先/);
  assert.match(checkDate('2027-02-30', NOW)!, /日付を選んで/);
  assert.match(checkDate('', NOW)!, /日付を選んで/);
});

test('開演時刻：9:00〜21:00 の HH:MM だけ通す', () => {
  assert.equal(checkStart('18:00'), null);
  assert.match(checkStart('8:00')!, /開演時刻を選んで/);
  assert.match(checkStart('22:00')!, /9:00〜21:00/);
});

test('元の公演の会場・駅・帰りの乗車駅はそのままに、日付と時刻だけを差し替える', () => {
  const base = loadEvent('live-b')!; // 開場16:00・開演17:00・終演目安19:30
  const e = buildCustomEvent(base, { date: '2027-03-06', start: '18:30' });
  assert.equal(e.checkin, '2027-03-06');
  assert.equal(e.checkout, '2027-03-07');
  assert.equal(e.date, '2027-03-06');
  assert.equal(e.venue.open, '17:30');
  assert.equal(e.venue.start, '18:30');
  assert.equal(e.venue.endEstimate, '21:00');
  assert.equal(e.venue.name, base.venue.name);
  assert.deepEqual(e.homeward, base.homeward);
  assert.deepEqual(e.stations, base.stations);
  assert.equal(e.tourName, undefined);
});

test('月末をまたぐ日付でも、チェックアウトは翌日になる', () => {
  const e = buildCustomEvent(loadEvent('live-b')!, { date: '2027-02-28', start: '18:00' });
  assert.equal(e.checkout, '2027-03-01');
});
