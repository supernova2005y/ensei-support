// しおりの地図に引く「日ごとの順番の線」を作る（API は呼ばない・ファイルも読まない純粋な関数）。
// 地図の部品（src/app/_components/ShioriMap.tsx）から使う。地図サービスを替えても、この関数はそのまま使える。
//
// 線のつなぎ方:
//   - その日の朝に宿にいるとき（前泊の公演日・後泊の翌日）は、宿から始める
//   - 寄り道は、しおりの並び（schedule の結果）の順
//   - 公演日は会場で終わる。その夜に泊まるとき（前泊の前日・後泊の公演日）は、最後に宿へ
//   - どこで新幹線に乗り降りするかは決まっていないので、駅は線に入れない（ピンだけ）
// 宿の位置がわからないときは、宿を飛ばしてつなぐ。点が2つ未満の日は線を引かない。

import type { DayPlan, Pattern } from './itinerary.ts';

export interface RoutePoint {
  kind: 'spot' | 'venue' | 'stay';
  name: string;
  lat: number;
  lng: number;
  order?: number; // 寄り道の番号（その日の中で1から）
}

export interface DayRoute {
  label: string;
  points: RoutePoint[];
}

export interface RouteInput {
  pattern: Pattern;
  days: DayPlan[];
  venue: { name: string; lat: number; lng: number };
  stay?: { name: string; lat?: number; lng?: number } | null;
}

const hasPos = (p: { lat?: number; lng?: number }): p is { lat: number; lng: number } =>
  Number.isFinite(p.lat) && Number.isFinite(p.lng);

export function dayRoutes(input: RouteInput): DayRoute[] {
  const { pattern, days, venue } = input;
  const stay = input.stay && hasPos(input.stay) ? { kind: 'stay' as const, name: input.stay.name, lat: input.stay.lat, lng: input.stay.lng } : null;

  return days.map((day) => {
    const isLive = day.label === '公演日';
    const startAtStay = (pattern === 'before' && isLive) || (pattern === 'after' && day.label === '翌日');
    const endAtStay = (pattern === 'before' && day.label === '前日') || (pattern === 'after' && isLive);

    const points: RoutePoint[] = [];
    if (startAtStay && stay) points.push(stay);
    day.items.forEach((s, i) => {
      if (hasPos(s)) points.push({ kind: 'spot', name: s.title, lat: s.lat, lng: s.lng, order: i + 1 });
    });
    if (isLive) points.push({ kind: 'venue', name: venue.name, lat: venue.lat, lng: venue.lng });
    if (endAtStay && stay) points.push(stay);
    return { label: day.label, points };
  });
}

// 区間ごとの「Google マップで経路を開く」リンク。
// Google マップの URL（Maps URLs）を作るだけで、API もキーも使わない。経路の中身は Google マップ側で見る。
// 行き先・出発地は座標で渡す（名前で渡すと、別の同名の場所に飛ぶことがあるため）。移動手段は電車（transit）を初期値にする。
export interface Leg {
  from: RoutePoint;
  to: RoutePoint;
  url: string;
}

export function mapsDirUrl(from: { lat: number; lng: number }, to: { lat: number; lng: number }, mode: 'transit' | 'walking' = 'transit'): string {
  const q = new URLSearchParams({
    api: '1',
    origin: `${from.lat},${from.lng}`,
    destination: `${to.lat},${to.lng}`,
    travelmode: mode,
  });
  return `https://www.google.com/maps/dir/?${q.toString()}`;
}

// その日の点を、となり同士でつないだ区間の一覧
export function legs(route: DayRoute): Leg[] {
  const out: Leg[] = [];
  for (let i = 1; i < route.points.length; i++) {
    const from = route.points[i - 1];
    const to = route.points[i];
    out.push({ from, to, url: mapsDirUrl(from, to) });
  }
  return out;
}
