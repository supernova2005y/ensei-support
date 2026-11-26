// NAVITIME（RapidAPI の Basic。月500回で止まる）を、画面から呼ぶ回数の上限（サーバー側でだけ使う）。
// 採用担当者などが見る前に使い切らないよう、次の3つで止める。数は Upstash に数える（usageCounter.ts）。
//   - アプリ全体で月 APP_MONTHLY 回まで（残りは、手元での確認と予備に取っておく）
//   - 同じ人（IP アドレスのハッシュ）は1日 PER_IP_DAILY 回まで
//   - RapidAPI が返事に付ける残り回数が STOP_BELOW を切ったら、アプリの数え方に関係なく止める
// 呼ぶ前に数える（失敗した呼び出しも1回に数える。数え漏れで上限を超えないため）。

import { createHash } from 'node:crypto';
import type { MonthlyCounter } from './usageCounter.ts';

export const APP_MONTHLY = 100;
export const PER_IP_DAILY = 3;
export const STOP_BELOW = 100;

const APP = 'navitime';
const REMAINING = 'navitime-rapidapi-remaining';

// IP アドレスはそのまま保存しない（ハッシュの頭だけ。日付と組み合わせて1日ごとに数える）
function ipName(ip: string, now: number): string {
  const day = new Date(now + 9 * 3600_000).toISOString().slice(0, 10);
  return `navitime-ip:${createHash('sha256').update(ip).digest('hex').slice(0, 16)}:${day}`;
}

export type QuotaDecision = { ok: true } | { ok: false; reason: 'perIp' | 'appMonthly' | 'planRemaining'; message: string };

export async function takeNavitimeQuota(counter: MonthlyCounter, ip: string, now: number = Date.now()): Promise<QuotaDecision> {
  const remaining = await counter.latest(REMAINING);
  if (remaining !== null && remaining < STOP_BELOW) {
    return { ok: false, reason: 'planRemaining', message: '今月の経路検索の回数が残り少ないので、止めています。来月もう一度試してください。' };
  }
  if ((await counter.used(APP)) >= APP_MONTHLY) {
    return { ok: false, reason: 'appMonthly', message: '今月の経路検索の回数の上限に達しました。来月もう一度試してください。' };
  }
  const mine = ipName(ip, now);
  if ((await counter.used(mine)) >= PER_IP_DAILY) {
    return { ok: false, reason: 'perIp', message: `経路検索は1日${PER_IP_DAILY}回までです。明日もう一度試してください。` };
  }
  await counter.add(APP, 1);
  await counter.add(mine, 1);
  return { ok: true };
}

// 返事のヘッダーの残り回数を覚えておく（次の呼び出しの前に見る）
export async function rememberRemaining(counter: MonthlyCounter, remaining: number | null): Promise<void> {
  if (remaining !== null) await counter.setLatest(REMAINING, remaining);
}
