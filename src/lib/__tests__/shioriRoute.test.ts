// node --test で動かす（npm test）。架空の点（テスト用）で、しおりの地図の線のつなぎ方を確かめる。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { DayPlan, Spot } from '../itinerary.ts';
import { dayRoutes, legs } from '../shioriRoute.ts';

const spot = (id: string, lat = 35.68, lng = 139.76): Spot => ({
  id,
  title: `テスト候補${id}`,
  genres: ['アート'],
  hub: 'tokyo',
  lat,
  lng,
  price: { yen: 0, min: 0, max: 0, estimated: false },
  hours: '要確認',
  availability: '',
  note: 'テスト用',
  needs_check: true,
});

const venue = { name: 'テスト会場', lat: 35.63, lng: 139.79 };
const stay = { name: 'テスト宿', lat: 35.66, lng: 139.77 };
const kinds = (r: { points: { kind: string }[] }) => r.points.map((p) => p.kind);

test('日帰り：寄り道の順に回って、会場で終わる（宿は入らない）', () => {
  const days: DayPlan[] = [{ label: '公演日', items: [spot('a'), spot('b')] }];
  const [r] = dayRoutes({ pattern: 'day', days, venue, stay });
  assert.deepEqual(kinds(r), ['spot', 'spot', 'venue']);
  assert.deepEqual(r.points.map((p) => p.order), [1, 2, undefined]);
});

test('前泊：前日は宿で終わり、公演日は宿から始まる', () => {
  const days: DayPlan[] = [
    { label: '前日', items: [spot('a')] },
    { label: '公演日', items: [spot('b')] },
  ];
  const [d1, d2] = dayRoutes({ pattern: 'before', days, venue, stay });
  assert.deepEqual(kinds(d1), ['spot', 'stay']);
  assert.deepEqual(kinds(d2), ['stay', 'spot', 'venue']);
});

test('後泊：公演日は会場のあと宿へ、翌日は宿から始まる', () => {
  const days: DayPlan[] = [
    { label: '公演日', items: [spot('a')] },
    { label: '翌日', items: [spot('b'), spot('c')] },
  ];
  const [d1, d2] = dayRoutes({ pattern: 'after', days, venue, stay });
  assert.deepEqual(kinds(d1), ['spot', 'venue', 'stay']);
  assert.deepEqual(kinds(d2), ['stay', 'spot', 'spot']);
});

test('宿の位置がわからないときは、宿を飛ばしてつなぐ', () => {
  const days: DayPlan[] = [{ label: '公演日', items: [spot('a')] }];
  const [r] = dayRoutes({ pattern: 'after', days, venue, stay: { name: '位置なし' } });
  assert.deepEqual(kinds(r), ['spot', 'venue']);
});

test('座標が数でない寄り道は、線に入れない', () => {
  const days: DayPlan[] = [{ label: '公演日', items: [spot('a', Number.NaN, 139.7), spot('b')] }];
  const [r] = dayRoutes({ pattern: 'day', days, venue });
  assert.deepEqual(kinds(r), ['spot', 'venue']);
  assert.equal(r.points[0].name, 'テスト候補b');
});

test('legs: となり同士をつなぎ、Google マップの経路の URL を作る（座標・電車）', () => {
  const days: DayPlan[] = [{ label: '公演日', items: [spot('a', 35.1, 139.1)] }];
  const [r] = dayRoutes({ pattern: 'after', days, venue, stay });
  const ls = legs(r);
  assert.deepEqual(ls.map((l) => `${l.from.kind}>${l.to.kind}`), ['spot>venue', 'venue>stay']);
  const u = new URL(ls[0].url);
  assert.equal(u.origin + u.pathname, 'https://www.google.com/maps/dir/');
  assert.equal(u.searchParams.get('api'), '1');
  assert.equal(u.searchParams.get('origin'), '35.1,139.1');
  assert.equal(u.searchParams.get('destination'), `${venue.lat},${venue.lng}`);
  assert.equal(u.searchParams.get('travelmode'), 'transit');
});

test('legs: 点が1つ以下の日は区間なし', () => {
  assert.deepEqual(legs({ label: '翌日', points: [] }), []);
  assert.deepEqual(legs({ label: '翌日', points: [{ kind: 'venue', name: 'x', lat: 1, lng: 2 }] }), []);
});
