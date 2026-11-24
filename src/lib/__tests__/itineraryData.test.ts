// node --test で動かす（npm test）。公演の設定（events/）から、寄り道の画面の土台ができることを確かめる。
// 試作の data/<id>.json がある公演と、ない公演の両方を見る。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadItineraryData } from '../itineraryData.ts';

test('データファイルがない公演も、駅と共通の設定から寄り道の画面の土台ができる', () => {
  const data = loadItineraryData('live-g');
  assert.ok(data, 'live-g が読めること');
  assert.ok(data.stations.length >= 1, '駅が入っていること');
  assert.equal(data.hubs.length, data.stations.length, '駅の数だけ、駅の周りができること');
  for (const hub of data.hubs) {
    assert.ok(data.stations.some((s) => s.id === hub.stationId), `${hub.id} の駅が存在すること`);
  }
  assert.equal(data.spots.length, 0, '手で入れた候補はないこと');
  assert.equal(data.patterns.length, 3);
  assert.ok(data.transport_modes.length > 0 && data.food_grades.length > 0);
});

test('データファイルがある公演は、その中身（候補など）を使う', () => {
  const data = loadItineraryData('live-b');
  assert.ok(data);
  assert.ok(data.spots.length > 0, '手で入れた候補が残っていること');
  assert.ok(data.hubs.some((h) => h.id === 'tokyo'), '古い形の駅の周りを使うこと');
});

test('存在しない公演は null', () => {
  assert.equal(loadItineraryData('no-such-event'), null);
  assert.equal(loadItineraryData('../etc'), null);
});
