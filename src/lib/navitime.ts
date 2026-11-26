// NAVITIME ルート検索（トータルナビ。RapidAPI 経由）を呼び、返事をアプリで使う形にまとめる（サーバー側でだけ使う）。
// 画面の API（/api/route）と、確認用スクリプト scripts/navitime-route.mjs から使う。
//
// 規約（利用規約（RapidAPI）第5条5。docs/API規約メモ.md）：受け取ったデータ（経路・時刻・運賃・緯度経度など）は、
// キャッシュなどに保存しない。取った都度、画面に返すだけにする。「NAVITIME」の表示を出す。
// 注意：RapidAPI 版の時刻は時刻表ではなく、乗り換えの待ちを平均で見込んだもの（2026-11 に、品川発ののぞみの時刻が
// 実際のダイヤと合わないことをユーザーが確かめた）。所要時間の目安と運賃には使えるが、発車時刻は使わない。

import type { LatLng } from './events.ts';

export const NAVITIME_HOST = 'navitime-route-totalnavi.p.rapidapi.com';
const ENDPOINT = `https://${NAVITIME_HOST}/route_transit`;

// 会場から帰りの出発地（名古屋）までの経路のうち、新幹線に乗る駅までの部分と運賃。発車時刻は持たない
export interface HomewardRoute {
  boarding: string; // 新幹線に乗る駅
  minutes: number; // 会場を出てから乗車駅に着くまで（徒歩・乗り換えの待ちを含む平均）
  lines: string[]; // 乗車駅までの路線（乗る順）
  train: string; // 新幹線の種別（のぞみ・ひかり など）
  fare: { ticket: number; nonReserved?: number; reserved?: number }; // 会場の最寄り駅から（乗車券、乗車券＋特急券の自由席・指定席）
}

export class NavitimeError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

// 経路を1回取る。remaining は RapidAPI が返事のヘッダーに付ける、今月のプランの残り回数（付いていなければ null）
export async function fetchTransit(
  key: string,
  from: LatLng,
  to: LatLng,
  startTime: string, // YYYY-MM-DDTHH:MM:00（日本時間）
  fetchImpl: typeof fetch = fetch,
): Promise<{ body: RouteBody; remaining: number | null }> {
  const params = new URLSearchParams({ start: `${from.lat},${from.lng}`, goal: `${to.lat},${to.lng}`, start_time: startTime });
  const res = await fetchImpl(`${ENDPOINT}?${params}`, {
    headers: { 'x-rapidapi-key': key, 'x-rapidapi-host': NAVITIME_HOST },
    cache: 'no-store',
  });
  const raw = res.headers.get('x-ratelimit-requests-remaining');
  const remaining = raw === null || raw === '' || !Number.isFinite(Number(raw)) ? null : Number(raw);
  const body = (await res.json().catch(() => null)) as (RouteBody & { message?: string }) | null;
  if (!res.ok || !body) {
    if (res.status === 429) throw new NavitimeError('NAVITIME の呼び出しの上限に達しました。', 429);
    throw new NavitimeError(`NAVITIME がエラーを返しました（HTTP ${res.status}）。`, res.status);
  }
  return { body, remaining };
}

// 終演の目安（HH:MM）に退場の分を足した、出発の時刻（YYYY-MM-DDTHH:MM:00）。日をまたぐときは翌日にする
export function departureTime(date: string, end: string, exitMinutes: number): string {
  const [h, m] = end.split(':').map(Number);
  const total = h * 60 + m + exitMinutes;
  const [y, mo, d] = date.split('-').map(Number);
  const day = new Date(Date.UTC(y, mo - 1, d + Math.floor(total / 1440))).toISOString().slice(0, 10);
  const t = total % 1440;
  return `${day}T${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}:00`;
}

// 運賃の種類（レスポンスに名前が入っていないので、金額から推定した。scripts/navitime-route.mjs と同じ）
const FARE_TICKET = 'unit_0';
const FARE_NON_RESERVED = 'unit_1';
const FARE_RESERVED = 'unit_2';

const SHINKANSEN = /のぞみ|ひかり|こだま|みずほ|さくら|はやぶさ|かがやき|はくたか|新幹線/;

interface Section {
  type?: string;
  name?: string;
  move?: string;
  line_name?: string;
  transport?: { name?: string };
  from_time?: string;
  to_time?: string;
}
interface Item {
  summary?: { move?: { from_time?: string; fare?: Record<string, number> } };
  sections?: Section[];
}
export interface RouteBody {
  items?: Item[];
}

// 「国際展示場（りんかい線）」「恵比寿（東京都）」→ 駅の名前だけにする
export function stationName(raw: string): string {
  return raw.replace(/（[^（）]*）$/, '').trim();
}

const minutesBetween = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 60_000);

// 1つの経路から、新幹線に乗る駅・そこまでの時間と路線・運賃を取り出す。新幹線を使わない経路は null
export function homewardRoute(item: Item): HomewardRoute | null {
  const start = item.summary?.move?.from_time;
  const fare = item.summary?.move?.fare;
  if (!start || !fare || fare[FARE_TICKET] === undefined) return null;
  let lastPoint = '';
  let arrivedAt: string | undefined;
  const lines: string[] = [];
  for (const s of item.sections ?? []) {
    if (s.type === 'point') {
      lastPoint = s.name ?? lastPoint;
      continue;
    }
    const line = s.line_name ?? s.transport?.name ?? '';
    const train = line.match(SHINKANSEN)?.[0];
    if (s.move !== 'walk' && train) {
      if (!arrivedAt || !lastPoint) return null;
      return {
        boarding: stationName(lastPoint),
        minutes: minutesBetween(start, arrivedAt),
        lines,
        train,
        fare: {
          ticket: Number(fare[FARE_TICKET]),
          nonReserved: fare[FARE_NON_RESERVED] === undefined ? undefined : Number(fare[FARE_TICKET]) + Number(fare[FARE_NON_RESERVED]),
          reserved: fare[FARE_RESERVED] === undefined ? undefined : Number(fare[FARE_TICKET]) + Number(fare[FARE_RESERVED]),
        },
      };
    }
    if (s.move !== 'walk' && line) lines.push(line);
    arrivedAt = s.to_time ?? arrivedAt;
  }
  return null;
}

// 返事の候補から、乗車駅と路線が同じものをまとめて（早く着くほうを残す）、max 件まで返す。並びは返事の順（早く着く順）
export function homewardRoutes(body: RouteBody, max = 3): HomewardRoute[] {
  const seen = new Map<string, HomewardRoute>();
  for (const item of body.items ?? []) {
    const r = homewardRoute(item);
    if (!r) continue;
    const key = `${r.boarding}|${r.lines.join('→')}`;
    const prev = seen.get(key);
    if (!prev || r.minutes < prev.minutes) seen.set(key, r);
  }
  return [...seen.values()].slice(0, max);
}
