// GET /api/stays?event=live-b&adults=1（後泊）／ &stay=before で前泊（前日の夜から泊まる宿を探す）
// GET /api/stays?event=live-b&adults=1&date=2027-03-06&start=18:00 （自分の公演：会場は live-b のものを使い、日付と時刻を差し替える）
// 楽天トラベルで会場と駅の周りの空室を探し、4グレードに振り分けた結果を返す。
// キーは環境変数からサーバーの中だけで使い、ブラウザには返さない。
// 楽天の規約（取得したデータを多くの人が共有する形で保存しない）に合わせて、結果はキャッシュせず毎回その場で取る。

import { NextResponse, type NextRequest } from 'next/server';
import { buildCustomEvent, checkDate, checkStart } from '@/lib/customEvent.ts';
import { loadEvent } from '@/lib/events.ts';
import { createLimiter, limitMessage } from '@/lib/rateLimit.ts';
import { RakutenApiError, RakutenConfigError, searchStays } from '@/lib/rakuten.ts';

export const dynamic = 'force-dynamic';
export const maxDuration = 60; // 楽天APIを1秒おきに10回前後呼ぶので、既定の時間では足りないことがある

const MAX_ADULTS = 4;

// 楽天への検索の回数をこちらで絞る（src/lib/rateLimit.ts）。箱（インスタンス）ごとに1つ
const tryAcquire = createLimiter();

// Vercel では x-forwarded-for の先頭が利用者の IP アドレス。手元では取れないので 'local' にまとめる
function clientIp(request: NextRequest): string {
  return request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || request.headers.get('x-real-ip') || 'local';
}

function errorJson(status: number, error: string, hint?: string) {
  return NextResponse.json({ error, hint }, { status, headers: { 'Cache-Control': 'no-store' } });
}

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const eventId = params.get('event') ?? '';
  const adults = Number(params.get('adults') ?? '1');

  const date = params.get('date');
  const start = params.get('start');

  const base = loadEvent(eventId);
  if (!base) return errorJson(404, `公演「${eventId}」が見つかりません。`);
  if (!Number.isInteger(adults) || adults < 1 || adults > MAX_ADULTS) {
    return errorJson(400, `人数は1〜${MAX_ADULTS}名で指定してください。`);
  }
  let event = base;
  if (date || start) {
    const problem = checkDate(date ?? '') ?? checkStart(start ?? '');
    if (problem) return errorJson(400, problem);
    event = buildCustomEvent(base, { date: date!, start: start! });
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
    // 泊まり方：after（既定・公演日の夜から）／before（前泊・前日の夜から）
    const stay = params.get('stay') === 'before' ? 'before' : 'after';
    const result = await searchStays(event, { adults, stay });
    return NextResponse.json(result, { headers: { 'Cache-Control': 'no-store' } });
  } catch (e) {
    if (e instanceof RakutenConfigError) return errorJson(500, e.message);
    if (e instanceof RakutenApiError) return errorJson(502, e.message, e.hint);
    console.error(e);
    return errorJson(500, '空室を探している途中でエラーが起きました。少し待ってから、もう一度探してください。');
  } finally {
    decision.release();
  }
}
