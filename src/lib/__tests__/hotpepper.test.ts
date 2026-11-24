// node --test で動かす（npm test）。ホットペッパーは呼ばない（偽の fetch と、架空のお店の JSON で確かめる）。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fetchShops, HotPepperError, parseShops } from '../hotpepper.ts';

const body = {
  results: {
    api_version: '1.00',
    results_available: 3,
    shop: [
      {
        id: 'J000000001',
        name: 'テスト食堂A',
        genre: { name: '居酒屋' },
        address: 'テスト県テスト市1-1',
        lat: '35.6600',
        lng: '139.7700',
        budget: { average: '2001～3000円' },
        open: '月～金 11:00～23:00',
        close: '火',
        access: 'テスト駅から徒歩3分',
        urls: { pc: 'https://example.com/a' },
      },
      { id: 'J000000002', name: '', lat: '35.66', lng: '139.77' }, // 名前がない → 捨てる
      { id: 'J000000003', name: 'テストカフェB', lat: 'abc', lng: '139.77' }, // 座標が変 → 捨てる
    ],
  },
};

test('parseShops: 形の合う店だけを、画面で使う形にそろえる', () => {
  const shops = parseShops(body);
  assert.equal(shops.length, 1);
  assert.deepEqual(shops[0], {
    id: 'J000000001',
    name: 'テスト食堂A',
    genre: '居酒屋',
    address: 'テスト県テスト市1-1',
    lat: 35.66,
    lng: 139.77,
    budget: '2001～3000円',
    open: '月～金 11:00～23:00',
    close: '火',
    access: 'テスト駅から徒歩3分',
    url: 'https://example.com/a',
  });
});

test('parseShops: 本文が変な形のときは、空の一覧を返す', () => {
  assert.deepEqual(parseShops(null), []);
  assert.deepEqual(parseShops({ results: {} }), []);
});

test('fetchShops: 検索範囲は 500m の番号（2）で、キーと座標を付けて呼ぶ', async () => {
  let calledUrl = '';
  const fakeFetch = (async (url: string) => {
    calledUrl = url;
    return new Response(JSON.stringify(body), { status: 200 });
  }) as typeof fetch;
  const shops = await fetchShops('TEST-KEY', { lat: 35.66, lng: 139.77 }, { rangeM: 500, fetchImpl: fakeFetch });
  assert.equal(shops.length, 1);
  const u = new URL(calledUrl);
  assert.equal(u.searchParams.get('key'), 'TEST-KEY');
  assert.equal(u.searchParams.get('range'), '2');
  assert.equal(u.searchParams.get('format'), 'json');
  assert.equal(u.searchParams.get('lat'), '35.66');
});

test('fetchShops: キーが認められないとき（code 2000）は、直し方の案内つきで止まる', async () => {
  const fakeFetch = (async () =>
    new Response(JSON.stringify({ results: { error: [{ message: 'key is invalid', code: 2000 }] } }), {
      status: 200,
    })) as typeof fetch;
  await assert.rejects(
    fetchShops('BAD', { lat: 35.66, lng: 139.77 }, { fetchImpl: fakeFetch }),
    (e: unknown) => e instanceof HotPepperError && /キー/.test(e.message) && /HOTPEPPER_API_KEY/.test(e.hint ?? ''),
  );
});
