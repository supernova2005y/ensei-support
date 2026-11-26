// NAVITIME ルート検索（トータルナビ。RapidAPI 経由）の返事を、アプリで使う形にまとめる。API は呼ばない。
// 確認用スクリプト scripts/navitime-route.mjs から使う（結果を events/*.json に前もって保存し、画面からは API を呼ばない）。
//
// 注意：RapidAPI 版の時刻は時刻表ではなく、乗り換えの待ちを平均で見込んだもの（2026-11 に、品川発ののぞみの時刻が
// 実際のダイヤと合わないことをユーザーが確かめた）。所要時間の目安と運賃には使えるが、発車時刻は使わない。

import type { HomewardRoute } from './events.ts';

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
