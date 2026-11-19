// GET /api/stays?event=live-b&adults=1
// 楽天トラベルで会場と駅の周りの空室を探し、4グレードに振り分けた結果を返す。
// キーは環境変数からサーバーの中だけで使い、ブラウザには返さない。
// 楽天の規約（取得したデータを多くの人が共有する形で保存しない）に合わせて、結果はキャッシュせず毎回その場で取る。

import { NextResponse, type NextRequest } from 'next/server';
import { loadEvent } from '@/lib/events.ts';
import { RakutenApiError, RakutenConfigError, searchStays } from '@/lib/rakuten.ts';

export const dynamic = 'force-dynamic';
export const maxDuration = 60; // 楽天APIを1秒おきに10回前後呼ぶので、既定の時間では足りないことがある

const MAX_ADULTS = 4;

function errorJson(status: number, error: string, hint?: string) {
  return NextResponse.json({ error, hint }, { status, headers: { 'Cache-Control': 'no-store' } });
}

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const eventId = params.get('event') ?? '';
  const adults = Number(params.get('adults') ?? '1');

  const event = loadEvent(eventId);
  if (!event) return errorJson(404, `公演「${eventId}」が見つかりません。`);
  if (!Number.isInteger(adults) || adults < 1 || adults > MAX_ADULTS) {
    return errorJson(400, `人数は1〜${MAX_ADULTS}名で指定してください。`);
  }

  try {
    const result = await searchStays(event, { adults });
    return NextResponse.json(result, { headers: { 'Cache-Control': 'no-store' } });
  } catch (e) {
    if (e instanceof RakutenConfigError) return errorJson(500, e.message);
    if (e instanceof RakutenApiError) return errorJson(502, e.message, e.hint);
    console.error(e);
    return errorJson(500, '空室を探している途中でエラーが起きました。少し待ってから、もう一度探してください。');
  }
}
