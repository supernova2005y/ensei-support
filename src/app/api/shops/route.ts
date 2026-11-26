// GET /api/shops?event=live-b
// 寄り道の画面の「駅の周り」ごとに、ご飯・カフェのお店を、ホットペッパーで取って返す。
// キーはサーバーの中だけで使う。店名・住所は保存しない（取った都度、返すだけ）。
// 1回の呼び出しで、3つの駅ぶん（3回）ホットペッパーを呼ぶ。回数は、楽天と同じ仕組みで絞る。

import { NextResponse, type NextRequest } from 'next/server';
import { isValidEventId } from '@/lib/events.ts';
import { loadItineraryData } from '@/lib/itineraryData.ts';
import { fetchShops, HotPepperError, type HpShop } from '@/lib/hotpepper.ts';
import { createLimiter, limitMessage } from '@/lib/rateLimit.ts';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;


const tryAcquire = createLimiter();

function clientIp(request: NextRequest): string {
  return request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || request.headers.get('x-real-ip') || 'local';
}

function errorJson(status: number, error: string, hint?: string) {
  return NextResponse.json({ error, hint }, { status, headers: { 'Cache-Control': 'no-store' } });
}

// near=緯度,経度（選んだ宿の位置）。日本の範囲の数字だけ受け付ける
function parseNear(raw: string | null): { lat: number; lng: number } | null {
  if (!raw) return null;
  const [a, b, ...rest] = raw.split(',');
  if (rest.length || a === undefined || b === undefined || a.trim() === '' || b.trim() === '') return null;
  const lat = Number(a);
  const lng = Number(b);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (lat < 20 || lat > 46 || lng < 122 || lng > 154) return null;
  return { lat, lng };
}

export async function GET(request: NextRequest) {
  const eventId = request.nextUrl.searchParams.get('event') ?? '';
  const near = parseNear(request.nextUrl.searchParams.get('near'));
  if (request.nextUrl.searchParams.has('near') && !near) return errorJson(400, '宿の位置の指定が正しくありません。');
  if (!isValidEventId(eventId)) return errorJson(400, '公演の指定が正しくありません。');

  const itinerary = loadItineraryData(eventId);
  if (!itinerary) return errorJson(404, 'この公演が見つかりません。');

  const key = process.env.HOTPEPPER_API_KEY;
  if (!key) {
    return errorJson(500, 'ホットペッパーのキーが設定されていません。', 'HOTPEPPER_API_KEY を .env（手元）か Vercel の環境変数に入れてください');
  }

  const decision = tryAcquire(clientIp(request));
  if (!decision.ok) {
    return NextResponse.json(
      { error: limitMessage(decision) },
      {
        status: 429,
        headers: { 'Cache-Control': 'no-store', 'Retry-After': String(Math.ceil(decision.retryAfterMs / 1000)) },
      },
    );
  }

  try {
    const hubs: Record<string, HpShop[]> = {};
    for (const hub of itinerary.hubs) {
      const station = itinerary.stations.find((s) => s.id === hub.stationId);
      if (!station) continue;
      hubs[hub.id] = await fetchShops(key, { lat: station.lat, lng: station.lng }, { rangeM: 500, count: 20 });
    }
    // 選んだ宿の近く（宿の座標を中心に探す。駅の座標はいらない）
    if (near) hubs.stay = await fetchShops(key, near, { rangeM: 500, count: 20 });
    return NextResponse.json(
      { hubs, credit: 'Powered by ホットペッパーグルメ Webサービス', creditUrl: 'http://webservice.recruit.co.jp/' },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (e) {
    if (e instanceof HotPepperError) return errorJson(502, e.message, e.hint);
    console.error(e);
    return errorJson(500, 'お店を探している途中でエラーが起きました。少し待ってから、もう一度試してください。');
  } finally {
    decision.release();
  }
}
