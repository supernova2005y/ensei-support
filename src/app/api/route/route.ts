// GET /api/route?event=live-b&date=2026-12-13&end=19:30
// 日帰りの帰り：会場から出発地（名古屋）までの経路を NAVITIME で取り、乗車駅までの行き方と運賃を返す。
// 押したときだけ呼ぶ。結果は保存しない（NAVITIME の規約。docs/API規約メモ.md）。キーはサーバーの中だけで使う。
// 回数は Upstash で数え、上限（src/lib/navitimeQuota.ts）を超えそうなら NAVITIME を呼ばずに断る。

import { NextResponse, type NextRequest } from 'next/server';
import { isValidEventId, loadEvent } from '@/lib/events.ts';
import { departureTime, fetchTransit, homewardRoutes, NavitimeError } from '@/lib/navitime.ts';
import { rememberRemaining, takeNavitimeQuota } from '@/lib/navitimeQuota.ts';
import { counterFromEnv } from '@/lib/usageCounter.ts';

export const dynamic = 'force-dynamic';
export const maxDuration = 20;

const NO_STORE = { 'Cache-Control': 'no-store' };

function clientIp(request: NextRequest): string {
  return request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || request.headers.get('x-real-ip') || 'local';
}

function errorJson(status: number, error: string, hint?: string) {
  return NextResponse.json({ error, hint }, { status, headers: NO_STORE });
}

function validDate(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y, m, d] = s.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toISOString().slice(0, 10) === s;
}

export async function GET(request: NextRequest) {
  const q = request.nextUrl.searchParams;
  const eventId = q.get('event') ?? '';
  const date = q.get('date') ?? '';
  const end = q.get('end') ?? '';
  if (!isValidEventId(eventId)) return errorJson(400, '公演の指定が正しくありません。');
  if (!validDate(date)) return errorJson(400, '日付の指定が正しくありません。');
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(end)) return errorJson(400, '終演の時刻の指定が正しくありません。');

  const event = loadEvent(eventId);
  if (!event?.origin || !event.homeward) return errorJson(404, 'この公演では、帰りの経路を調べられません。');

  const key = process.env.RAPIDAPI_KEY;
  if (!key) return errorJson(500, '経路検索のキーが設定されていません。', 'RAPIDAPI_KEY を .env（手元）か Vercel の環境変数に入れてください');
  const counter = counterFromEnv();
  if (!counter) {
    // 回数を数えられないと、無料枠を使い切るおそれがあるので呼ばない
    return errorJson(503, '経路検索は、いまは使えません。', 'UPSTASH_REDIS_REST_URL と UPSTASH_REDIS_REST_TOKEN を設定してください');
  }

  try {
    const decision = await takeNavitimeQuota(counter, clientIp(request));
    if (!decision.ok) return errorJson(429, decision.message);

    const startTime = departureTime(date, end, event.homeward.exitMinutes ?? 20);
    const { body, remaining } = await fetchTransit(key, event.venue, event.origin, startTime);
    await rememberRemaining(counter, remaining);
    return NextResponse.json(
      { routes: homewardRoutes(body, 3), to: event.homeward.to, startTime, credit: 'ルート検索：NAVITIME' },
      { headers: NO_STORE },
    );
  } catch (e) {
    if (e instanceof NavitimeError) return errorJson(502, `${e.message}少し待ってから、もう一度試してください。`);
    console.error(e);
    return errorJson(500, '経路を調べている途中でエラーが起きました。少し待ってから、もう一度試してください。');
  }
}
