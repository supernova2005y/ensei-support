// node --test で動かす（npm test）。本物の楽天APIは呼ばず、fetch を差し替えて「何を送るか」と「エラーの扱い」を確かめる。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  RakutenApiError,
  RakutenConfigError,
  missingRakutenKeys,
  rakutenSetupHint,
  readRakutenEnv,
  searchStays,
} from '../rakuten.ts';
import type { EventConfig } from '../events.ts';

const fixture = JSON.parse(
  readFileSync(new URL('../__fixtures__/rakuten-test-fixture.json', import.meta.url), 'utf8'),
);
const event: EventConfig = { name: 'テスト公演', checkin: '2026-12-13', checkout: '2026-12-14', ...fixture.event };
const env = { applicationId: 'test-app', accessKey: 'pk_test', affiliateId: 'test-aff', referer: 'https://github.com/' };

test('readRakutenEnv: 足りない項目を日本語で知らせる（アフィリエイトIDは任意）', () => {
  assert.throws(() => readRakutenEnv({}), (e: Error) => e instanceof RakutenConfigError && /RAKUTEN_ACCESS_KEY/.test(e.message));
  const ok = readRakutenEnv({ RAKUTEN_APPLICATION_ID: 'a', RAKUTEN_ACCESS_KEY: 'b', RAKUTEN_REFERER: 'https://github.com/' });
  assert.equal(ok.affiliateId, undefined);
});

test('missingRakutenKeys: 足りないキーの名前だけを返す（空白だけの値も足りない扱い）', () => {
  assert.deepEqual(missingRakutenKeys({}), ['RAKUTEN_APPLICATION_ID', 'RAKUTEN_ACCESS_KEY', 'RAKUTEN_REFERER']);
  assert.deepEqual(missingRakutenKeys({ RAKUTEN_APPLICATION_ID: 'a', RAKUTEN_ACCESS_KEY: ' ', RAKUTEN_REFERER: 'https://github.com/' }), [
    'RAKUTEN_ACCESS_KEY',
  ]);
});

test('rakutenSetupHint: 手元なら .env、Vercel なら Environment Variables を案内する', () => {
  assert.match(rakutenSetupHint({}), /\.env.*npm run dev/);
  assert.match(rakutenSetupHint({ VERCEL: '1' }), /Vercel の Environment Variables/);
  // 手元で動かしたときのエラー文も .env を案内する
  assert.throws(() => readRakutenEnv({}), /\.env/);
});

test('searchStays: キーをクエリと Bearer の両方に付け、Referer と Origin を送り、1秒おきに呼ぶ', async (t) => {
  const calls: { url: URL; headers: Record<string, string>; at: number }[] = [];
  t.mock.method(globalThis, 'fetch', async (input: string, init: RequestInit) => {
    const url = new URL(input);
    calls.push({ url, headers: init.headers as Record<string, string>, at: Date.now() });
    const body = url.pathname.includes('SimpleHotelSearch')
      ? fixture.raw.all
      : url.searchParams.get('searchRadius') === '0.6'
        ? fixture.raw.stations['テスト']
        : fixture.raw.venue;
    return new Response(JSON.stringify(body), { status: 200 });
  });
  const r = await searchStays(event, { adults: 1, env });
  assert.equal(calls.length, 3); // 会場の空室・会場の施設一覧・駅の空室（各1ページ）
  for (const c of calls) {
    assert.equal(c.url.searchParams.get('accessKey'), 'pk_test');
    assert.equal(c.url.searchParams.get('applicationId'), 'test-app');
    assert.equal(c.url.searchParams.get('affiliateId'), 'test-aff');
    assert.equal(c.url.searchParams.get('formatVersion'), '2');
    assert.equal(c.url.searchParams.get('datumType'), '1');
    assert.equal(c.headers.Authorization, 'Bearer pk_test');
    assert.equal(c.headers.Referer, 'https://github.com/');
    assert.equal(c.headers.Origin, 'https://github.com');
  }
  assert.equal(calls[0].url.searchParams.get('checkinDate'), '2026-12-13');
  assert.equal(calls[0].url.searchParams.get('sort'), '+roomCharge');
  assert.ok(calls[1].at - calls[0].at >= 990, '1秒以上あけて呼ぶ');
  assert.equal(r.grades[0].hotels[0].name, 'テスト最安ホテルA');
});

test('searchStays: 403 は Referer を確かめるよう案内する', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => new Response('{"error":"forbidden"}', { status: 403 }));
  await assert.rejects(
    searchStays(event, { adults: 1, env }),
    (e: Error) => e instanceof RakutenApiError && e.status === 403 && /RAKUTEN_REFERER/.test(e.hint ?? ''),
  );
});
