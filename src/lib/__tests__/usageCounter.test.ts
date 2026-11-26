import assert from 'node:assert/strict';
import test from 'node:test';
import { counterFromEnv, createMemoryCounter, createUpstashCounter, monthOf, monthlyKey } from '../usageCounter.ts';

// 2026-12-31 23:30（日本時間）。UTC ではまだ 12/31 14:30
const LAST_NIGHT_JST = Date.UTC(2026, 11, 31, 14, 30, 0);

test('月は日本時間で決める。日本時間の1月1日0時に、数えるキーが変わる', () => {
  assert.equal(monthOf(LAST_NIGHT_JST), '2026-12');
  assert.equal(monthOf(LAST_NIGHT_JST + 30 * 60_000), '2027-01');
  assert.equal(monthlyKey('navitime', LAST_NIGHT_JST), 'count:navitime:2026-12');
});

test('メモリの数え方：名前ごと・月ごとに数え、月が変わると0から', async () => {
  let now = LAST_NIGHT_JST;
  const c = createMemoryCounter(() => now);
  await c.add('navitime', 2);
  await c.add('navitime', 1);
  await c.add('places', 5);
  assert.equal(await c.used('navitime'), 3);
  assert.equal(await c.used('places'), 5);
  now += 3600_000;
  assert.equal(await c.used('navitime'), 0);
});

// 偽の Upstash：送られた命令を記録し、メモリで答える
function fakeUpstash(opts: { status?: number; error?: string } = {}) {
  const calls: { url: string; auth: string | null; body: unknown }[] = [];
  const store = new Map<string, number>();
  const run = (cmd: (string | number)[]) => {
    const [op, key, arg] = cmd;
    if (op === 'GET') return { result: store.has(String(key)) ? String(store.get(String(key))) : null };
    if (op === 'INCRBY') {
      const v = (store.get(String(key)) ?? 0) + Number(arg);
      store.set(String(key), v);
      return { result: v };
    }
    if (op === 'EXPIRE') return { result: 1 };
    if (op === 'SET') {
      store.set(String(key), Number(arg));
      return { result: 'OK' };
    }
    return { error: 'unknown' };
  };
  const fetchImpl = (async (url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body));
    calls.push({ url, auth: new Headers(init.headers).get('authorization'), body });
    if (opts.status) return new Response(JSON.stringify({ error: 'x' }), { status: opts.status });
    if (opts.error) return new Response(JSON.stringify({ error: opts.error }), { status: 200 });
    const out = url.endsWith('/pipeline') ? (body as (string | number)[][]).map(run) : run(body);
    return new Response(JSON.stringify(out), { status: 200 });
  }) as typeof fetch;
  return { calls, fetchImpl };
}

test('Upstash：トークンを付けて送り、足すときは増やす＋期限を1回の通信で送る', async () => {
  const fake = fakeUpstash();
  const c = createUpstashCounter({ url: 'https://example.upstash.io/', token: 't', fetchImpl: fake.fetchImpl, clock: () => LAST_NIGHT_JST });
  assert.equal(await c.used('navitime'), 0);
  await c.add('navitime', 2);
  await c.add('navitime', 1);
  assert.equal(await c.used('navitime'), 3);

  assert.equal(fake.calls.length, 4);
  assert.ok(fake.calls.every((x) => x.auth === 'Bearer t'));
  assert.equal(fake.calls[0].url, 'https://example.upstash.io');
  assert.equal(fake.calls[1].url, 'https://example.upstash.io/pipeline');
  assert.deepEqual(fake.calls[1].body, [
    ['INCRBY', 'count:navitime:2026-12', 2],
    ['EXPIRE', 'count:navitime:2026-12', 40 * 24 * 3600],
  ]);
});

test('Upstash がエラーを返したら、数えられないので例外にする（呼び出し側で止める）', async () => {
  for (const opts of [{ status: 401 }, { error: 'WRONGPASS' }]) {
    const fake = fakeUpstash(opts);
    const c = createUpstashCounter({ url: 'https://example.upstash.io', token: 't', fetchImpl: fake.fetchImpl });
    await assert.rejects(c.used('navitime'), /Upstash/);
    await assert.rejects(c.add('navitime', 1), /Upstash/);
  }
});

test('環境変数：URL と Token がそろっているときだけ Upstash を使う。なければ null', () => {
  assert.equal(counterFromEnv({}), null);
  assert.equal(counterFromEnv({ UPSTASH_REDIS_REST_URL: 'https://example.upstash.io' }), null);
  assert.ok(counterFromEnv({ UPSTASH_REDIS_REST_URL: 'https://example.upstash.io', UPSTASH_REDIS_REST_TOKEN: 't' }));
});

test('最後に見た値（latest）：月ごとに覚え、なければ null。Upstash には期限つきで SET する', async () => {
  const mem = createMemoryCounter(() => LAST_NIGHT_JST);
  assert.equal(await mem.latest('x'), null);
  await mem.setLatest('x', 120);
  assert.equal(await mem.latest('x'), 120);

  const fake = fakeUpstash();
  const c = createUpstashCounter({ url: 'https://example.upstash.io', token: 't', fetchImpl: fake.fetchImpl, clock: () => LAST_NIGHT_JST });
  assert.equal(await c.latest('x'), null);
  await c.setLatest('x', 120);
  assert.equal(await c.latest('x'), 120);
  assert.deepEqual(fake.calls[1].body, ['SET', 'latest:x:2026-12', 120, 'EX', 40 * 24 * 3600]);
});
