// node --test で動かす（npm test）。楽天APIは呼ばず、手作りのテスト用データ（__fixtures__）で読み取りとグレード分けを確かめる。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildStays, gradeOf, isPrivateRental, naturalBreaks, parseHotels, type RawSearch } from '../stays.ts';
import { judgeLastTrains, type LastTrainTable } from '../lastTrain.ts';
import type { EventConfig } from '../events.ts';

const fixture = JSON.parse(
  readFileSync(new URL('../__fixtures__/rakuten-test-fixture.json', import.meta.url), 'utf8'),
) as { event: Pick<EventConfig, 'venue' | 'stations'>; raw: RawSearch };

const sizes = (prices: number[], breaks: number[]) => {
  const counts = new Map<string, number>();
  for (const p of prices) counts.set(gradeOf(p, breaks), (counts.get(gradeOf(p, breaks)) ?? 0) + 1);
  return counts;
};

test('naturalBreaks: はっきり分かれた料金は、その切れ目で4つに分ける', () => {
  const prices = [6000, 6200, 6500, 10000, 10500, 11000, 18000, 19000, 20000, 40000, 45000, 50000];
  assert.deepEqual(naturalBreaks(prices), [10000, 18000, 40000]);
});

test('naturalBreaks: 件数が4件以下なら、2件目以降の料金がそのまま境目になる', () => {
  assert.deepEqual(naturalBreaks([9000, 5000, 7000]), [7000, 9000]);
});

test('naturalBreaks: 1件だけ極端に安くても、各グレードに全体の15%以上が入る', () => {
  // 3,000円が1件だけ離れている。切れ目だけで分けると「最安」が1件になるが、20件の15%＝3件以上にする
  const prices = [3000, ...Array.from({ length: 19 }, (_, i) => 10000 + i * 1500)];
  const breaks = naturalBreaks(prices);
  const counts = sizes(prices, breaks);
  const minSize = Math.floor(prices.length * 0.15);
  for (const grade of ['最安', 'リーズナブル', 'ちょっとリッチ', '奮発']) {
    assert.ok((counts.get(grade) ?? 0) >= minSize, `${grade} が ${counts.get(grade)} 件しかない`);
  }
});

test('isPrivateRental: 民泊・アパート型を名前で見分ける', () => {
  for (const name of ['テストハウス／民泊', '＾テスト', 'テストアパートメント', 'Test Apartment', 'テストハイツ']) {
    assert.equal(isPrivateRental({ name }), true, name);
  }
  for (const name of ['テストホテル', 'テスト旅館', undefined]) {
    assert.equal(isPrivateRental({ name }), false, String(name));
  }
});

test('parseHotels: formatVersion 2 と 1 の両方を読み、いちばん安いプランを取る', () => {
  const v2 = parseHotels(fixture.raw.venue);
  assert.equal(v2[0].name, 'テスト最安ホテルA');
  assert.equal(v2[0].minTotal, 6000);
  assert.equal(v2[0].plans.length, 2);
  assert.equal(v2.find((h) => h.no === 10)?.minTotal, undefined);
  const v1 = parseHotels(fixture.raw.stations['テスト']);
  assert.equal(v1[0].name, 'テストリーズナブルD');
  assert.equal(v1[0].minTotal, 11000);
});

test('buildStays: 民泊を除き、4グレードに分け、奮発のルールを当てる', () => {
  const r = buildStays(fixture.raw, fixture.event, { checkin: '2026-12-13', checkout: '2026-12-14', adults: 2 });
  assert.equal(r.rentalExcluded, 1);
  assert.equal(r.vacantCount, 9);
  assert.equal(r.pricedCount, 8);
  assert.equal(r.nights, 1);
  assert.deepEqual(r.breaks, [10000, 18000, 40000]);

  const names = (grade: string) => r.grades.find((g) => g.grade === grade)!.hotels.map((h) => h.name);
  assert.deepEqual(names('最安'), ['テスト最安ホテルA', 'テスト最安ホテルB']);
  assert.deepEqual(names('リーズナブル'), ['テストリーズナブルC', 'テストリーズナブルD']);
  assert.deepEqual(names('ちょっとリッチ'), ['テストちょっとリッチE', 'テストちょっとリッチF']);
  // ★3.0未満でも評価が10件未満なら残し、10件以上なら外す
  assert.deepEqual(names('奮発'), ['テスト奮発H']);
  assert.deepEqual(r.grades.find((g) => g.grade === '奮発')!.removedPoor, ['テスト奮発G']);
  // 評価が高いのに手頃：ちょっとリッチで★4.7以上・評価30件以上だけ
  assert.deepEqual(
    r.hiddenGems.map((h) => h.name),
    ['テストちょっとリッチE'],
  );

  // 2名なら1人あたりも出す
  const a = r.grades[0].hotels[0];
  assert.equal(a.total, 6000);
  assert.equal(a.perPerson, 3000);
  // 行き方の表示
  assert.match(a.access, /^会場まで徒歩圏（0\.4km）$/);
  const d = r.grades[1].hotels.find((h) => h.name === 'テストリーズナブルD')!;
  // 会場の周りと駅の周りの両方に出た施設は1件にまとめ、会場から遠ければ駅からの行き方を出す
  assert.equal(r.grades[1].hotels.filter((h) => h.name === 'テストリーズナブルD').length, 1);
  assert.match(d.access, /^テスト駅 \d+m → テスト線で会場まで約12分（徒歩込み）$/);
  assert.match(r.grades[1].hotels[0].access, /^会場から1\.7km/);
});

test('buildStays: 会場の周りで空室がない施設を距離ごとに数える', () => {
  const r = buildStays(fixture.raw, fixture.event, { checkin: '2026-12-13', checkout: '2026-12-14', adults: 1 });
  assert.deepEqual(r.soldOut?.bands, [
    { km: 1, listed: 6, full: 1 },
    { km: 2, listed: 8, full: 1 },
    { km: 3, listed: 11, full: 2 },
  ]);
  assert.deepEqual(r.soldOut?.nearFullNames, ['テスト満室ホテルX']);
  assert.equal(r.grades[0].hotels[0].perPerson, undefined);
});

test('judgeLastTrains: 終演の許容時刻を出し、臨時・未確認の便を区別する', () => {
  const table = JSON.parse(readFileSync(new URL('../../../data/last-trains.json', import.meta.url), 'utf8')) as LastTrainTable;
  const event = JSON.parse(readFileSync(new URL('../../../events/live-b.json', import.meta.url), 'utf8')) as EventConfig;
  const j = judgeLastTrains(event, table, '19:30')!;
  assert.equal(j.verdict, 'dayTrip');
  // 品川22:10 − 駅の中10分 − 会場→品川30分 − 退場20分 = 21:10
  assert.equal(j.best?.train, 'ひかり669号');
  assert.equal(j.best?.station, '品川');
  assert.equal(j.best?.latestEnd, '21:10');
  const extra = j.results.find((x) => x.train === 'のぞみ549号')!;
  assert.equal(extra.regular, false);
  assert.equal(extra.verified, false);
  assert.equal(j.hasUnverified, true);

  // 21:20終演なら定期の便には間に合わない（のぞみ549号の品川22:07発も21:07まで）
  assert.equal(judgeLastTrains(event, table, '21:20')!.verdict, 'none');
});
