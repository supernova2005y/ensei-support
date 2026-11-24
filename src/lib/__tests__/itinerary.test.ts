// node --test で動かす（npm test）。API は呼ばず、架空の候補（テスト用）で割り振りと総額を確かめる。
// 日付は使わない（割り振りは時刻と駅だけで決まる）。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { capFor, cost, kindRank, orderSpots, schedule, toHours, type Price, type Spot } from '../itinerary.ts';

const price = (yen: number, min = yen, max = yen): Price => ({ yen, min, max, estimated: false });

const spot = (id: string, genres: string[], hub: string, yen = 1000): Spot => ({
  id,
  title: `テスト候補${id}`,
  genres,
  hub,
  price: price(yen, yen / 2, yen * 2),
  hours: '10:00〜18:00',
  needs_check: false,
});

const art = (id: string, hub = 'tokyo') => spot(id, ['アート'], hub);
const market = (id: string, hub = 'ariake') => spot(id, ['マーケット'], hub);
const shop = (id: string, hub = 'tokyo') => spot(id, ['パン屋', '洋菓子'], hub);

const ids = (items: Spot[]) => items.map((s) => s.id);

test('capFor: 空き時間の長さで1日に入る数が決まる（試作の値と同じ）', () => {
  assert.equal(capFor(toHours('16:00') - toHours('06:30')), 4); // 9.5時間
  assert.equal(capFor(toHours('16:00') - toHours('10:40')), 3); // 5.3時間
  assert.equal(capFor(toHours('16:00') - toHours('11:30')), 3); // 4.5時間
  assert.equal(capFor(toHours('16:00') - toHours('12:30')), 2); // 3.5時間
  assert.equal(capFor(toHours('16:00') - toHours('14:00')), 2); // 2時間
});

test('orderSpots: 美術館・アート → マーケット → 買い物の順に並べる（同じ種類の中は元の順）', () => {
  const input = [shop('p1'), market('m1'), art('a1'), shop('p2'), art('a2')];
  assert.deepEqual(ids(orderSpots(input)), ['a1', 'a2', 'm1', 'p1', 'p2']);
  assert.equal(kindRank(art('x')), 0);
  assert.equal(kindRank(market('x')), 1);
  assert.equal(kindRank(shop('x')), 2);
});

test('日帰り：全部を公演日に入れ、3か所を超えたら警告する', () => {
  const picks = [art('a1', 'tokyo'), art('a2', 'far'), market('m1', 'ariake'), shop('p1', 'tokyo')];
  const s = schedule({ pattern: 'day', picks, arrival: '10:40', doors: '16:00' });
  assert.equal(s.days.length, 1);
  assert.equal(s.days[0].label, '公演日');
  assert.equal(s.days[0].items.length, 4);
  assert.equal(s.warnings.length, 1);
  assert.match(s.warnings[0], /公演日に4か所/);
});

test('後泊：公演日は cap まで、あふれた分と買い物は翌日に回す', () => {
  // 10:40着 → cap 3。東京駅の美術館2・ありあけのマーケット1・東京駅の買い物1・清澄白河のアート1
  const picks = [art('a1', 'tokyo'), art('a2', 'tokyo'), market('m1', 'ariake'), shop('p1', 'tokyo'), art('far1', 'far')];
  const s = schedule({ pattern: 'after', picks, arrival: '10:40', doors: '16:00' });
  const [today, next] = s.days;
  assert.equal(today.label, '公演日');
  assert.deepEqual(ids(today.items), ['a1', 'a2', 'm1']);
  assert.equal(next.label, '翌日');
  // 翌日は、清澄白河の候補 → あふれた分（なし）→ 買い物
  assert.deepEqual(ids(next.items), ['far1', 'p1']);
});

test('前泊：前日に東京駅と清澄白河の候補を cap まで、残りは公演日へ', () => {
  const picks = [art('a1', 'tokyo'), art('a2', 'far'), shop('p1', 'tokyo'), market('m1', 'ariake')];
  const s = schedule({ pattern: 'before', picks, arrival: '10:40', doors: '16:00' });
  const [eveDay, showDay] = s.days;
  assert.equal(eveDay.label, '前日');
  assert.deepEqual(ids(eveDay.items), ['a1', 'a2', 'p1']); // cap 3
  assert.deepEqual(ids(showDay.items), ['m1']); // 有明の候補は公演日へ
});

test('cost：項目ごとの幅を足して、総額と幅を出す（宿は渡されたときだけ入る）', () => {
  const picks = [art('a1'), shop('p1')]; // 立ち寄り：1000円（幅 500〜2000）× 2
  const c = cost({
    picks,
    transportGo: price(10000),
    transportBack: price(9000),
    stay: undefined,
    foodPerDay: { yen: 3000, min: 2000, max: 4000, estimated: false },
    days: 2,
    ticketYen: 5000,
    goodsYen: 1000,
  });
  const byLabel = Object.fromEntries(c.parts.map((p) => [p.label, p.yen]));
  assert.equal(byLabel['交通（往復）'], 19000);
  assert.equal(byLabel['宿'], 0);
  assert.equal(byLabel['食事（2日分）'], 6000);
  assert.equal(byLabel['立ち寄り'], 2000);
  assert.equal(c.total, 19000 + 0 + 6000 + 2000 + 1000 + 5000);
  assert.equal(c.lo, 19000 + 4000 + 1000 + 1000 + 5000); // 食事の下限4000・立ち寄りの下限1000
  assert.equal(c.hi, 19000 + 8000 + 4000 + 1000 + 5000); // 立ち寄りの上限4000・グッズ1000
});
