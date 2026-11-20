import assert from 'node:assert/strict';
import test from 'node:test';
import { GLOBAL_DAILY, PER_IP_DAILY, PER_IP_INTERVAL_MS, createLimiter, limitMessage } from '../rateLimit.ts';

// 2026-12-05（土）12:00 日本時間。時計は差し替えて進める
const NOON_JST = Date.UTC(2026, 11, 5, 3, 0, 0);

function setup() {
  let now = NOON_JST;
  const tryAcquire = createLimiter(() => now);
  return { tryAcquire, advance: (ms: number) => (now += ms) };
}

test('同じ人は1分に1回まで。断るときは何分待てばよいかを出す', () => {
  const { tryAcquire, advance } = setup();
  const first = tryAcquire('a');
  assert.ok(first.ok);
  first.release();
  const second = tryAcquire('a');
  assert.ok(!second.ok && second.reason === 'perIp');
  assert.equal(limitMessage(second), 'いまは混み合っています。1分後にもう一度探してください。');
  advance(PER_IP_INTERVAL_MS);
  assert.ok(tryAcquire('a').ok);
});

test('ほかの人の検索が終わるまでは断り、終われば通す', () => {
  const { tryAcquire } = setup();
  const a = tryAcquire('a');
  assert.ok(a.ok);
  const b = tryAcquire('b');
  assert.ok(!b.ok && b.reason === 'busy');
  a.release();
  assert.ok(tryAcquire('b').ok);
});

test('同じ人の1日の上限を超えたら、明日を案内する。日本時間の0時に数え直す', () => {
  const { tryAcquire, advance } = setup();
  for (let i = 0; i < PER_IP_DAILY; i++) {
    const d = tryAcquire('a');
    assert.ok(d.ok);
    d.release();
    advance(PER_IP_INTERVAL_MS);
  }
  const over = tryAcquire('a');
  assert.ok(!over.ok && over.reason === 'daily');
  assert.match(limitMessage(over), /明日/);
  advance(12 * 3600_000); // 翌日の0時過ぎ（日本時間）
  assert.ok(tryAcquire('a').ok);
});

test('全体の1日の上限を超えたら、別の人でも断る', () => {
  const { tryAcquire } = setup();
  for (let i = 0; i < GLOBAL_DAILY; i++) {
    const d = tryAcquire(`ip-${i}`);
    assert.ok(d.ok);
    d.release();
  }
  const over = tryAcquire('new');
  assert.ok(!over.ok && over.reason === 'daily');
});
