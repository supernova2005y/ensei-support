import assert from 'node:assert/strict';
import test from 'node:test';
import { APP_MONTHLY, PER_IP_DAILY, STOP_BELOW, rememberRemaining, takeNavitimeQuota } from '../navitimeQuota.ts';
import { createMemoryCounter } from '../usageCounter.ts';

// 2026-12-05（土）12:00 日本時間。時計は差し替えて進める
const NOON_JST = Date.UTC(2026, 11, 5, 3, 0, 0);

test('同じ人は1日 PER_IP_DAILY 回まで。日本時間の0時に数え直す。ほかの人は使える', async () => {
  let now = NOON_JST;
  const c = createMemoryCounter(() => now);
  for (let i = 0; i < PER_IP_DAILY; i++) assert.ok((await takeNavitimeQuota(c, '1.2.3.4', now)).ok);
  const ng = await takeNavitimeQuota(c, '1.2.3.4', now);
  assert.ok(!ng.ok && ng.reason === 'perIp');
  assert.ok((await takeNavitimeQuota(c, '5.6.7.8', now)).ok);
  now += 12 * 3600_000; // 翌日の0時
  assert.ok((await takeNavitimeQuota(c, '1.2.3.4', now)).ok);
});

test('アプリ全体で月 APP_MONTHLY 回を超えたら止める', async () => {
  const c = createMemoryCounter(() => NOON_JST);
  await c.add('navitime', APP_MONTHLY - 1);
  assert.ok((await takeNavitimeQuota(c, 'a', NOON_JST)).ok);
  const ng = await takeNavitimeQuota(c, 'b', NOON_JST);
  assert.ok(!ng.ok && ng.reason === 'appMonthly');
});

test('RapidAPI の残りが STOP_BELOW を切ったら、アプリの回数に関係なく止める。残りがわからない（null）ときは覚えない', async () => {
  const c = createMemoryCounter(() => NOON_JST);
  await rememberRemaining(c, null);
  assert.ok((await takeNavitimeQuota(c, 'a', NOON_JST)).ok);
  await rememberRemaining(c, STOP_BELOW);
  assert.ok((await takeNavitimeQuota(c, 'b', NOON_JST)).ok);
  await rememberRemaining(c, STOP_BELOW - 1);
  const ng = await takeNavitimeQuota(c, 'c', NOON_JST);
  assert.ok(!ng.ok && ng.reason === 'planRemaining');
});

test('断ったときは数えない（断られた分で上限が減らない）', async () => {
  const c = createMemoryCounter(() => NOON_JST);
  await c.add('navitime', APP_MONTHLY);
  await takeNavitimeQuota(c, 'a', NOON_JST);
  assert.equal(await c.used('navitime'), APP_MONTHLY);
});
