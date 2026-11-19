// Google Places API (New) の周辺検索（Nearby Search）で、会場や駅の周りのお店・施設を探す（サーバー側でだけ使う）。
// 確認用スクリプト scripts/google-places.ts と、あとで作る画面の API の両方からこのファイルを使う。
//
// ホットペッパーとの使い分け（research/02_apis.md 2-11）:
//   - ご飯・カフェはホットペッパー（無料。チェーン判定もある）
//   - パン屋・洋菓子のおみやげ、雑貨、美術館などは Google
//   - 「公演の日に開いているか」「閉業していないか」の確認は Google（曜日ごとの営業時間と営業状態が機械で読める形で返る）
//
// 料金（2026年の調査時点。research/02_apis.md）:
//   取り出す項目（フィールドマスク）のうち一番高いものの料金になる。営業時間・評価を取ると Enterprise になり、
//   無料枠は月1,000回まで。営業時間がいらなければ Pro（無料枠は月5,000回）で済む。
//   予算アラートは通知だけで止めてはくれないので、呼ぶ前に回数を数えて上限を超えないようにする（UsageCounter）。
//
// 規約: 地図に出すなら Google の地図を使う（ほかの地図と混ぜない）。座標の保存は30日まで。Google のクレジットを表示する。

import type { LatLng } from './events.ts';

const NEARBY_ENDPOINT = 'https://places.googleapis.com/v1/places:searchNearby';

export type PlacesSku = 'nearby_pro' | 'nearby_enterprise';

const PRO_FIELDS = [
  'places.id',
  'places.displayName',
  'places.location',
  'places.businessStatus',
  'places.primaryType',
  'places.primaryTypeDisplayName',
  'places.googleMapsUri',
  'places.shortFormattedAddress',
];
// この項目を足すと Enterprise の料金になる
const ENTERPRISE_FIELDS = ['places.regularOpeningHours', 'places.rating', 'places.userRatingCount'];

// 日本語の分類 → Places API の種類（Table A）。種類の名前が間違っていると API が 400 を返すので、そのときはここを直す
export const CATEGORIES: Record<string, string[]> = {
  パン屋: ['bakery'],
  洋菓子: ['dessert_shop', 'confectionery'],
  カフェ: ['cafe', 'coffee_shop'],
  美術館: ['museum', 'art_gallery'],
  雑貨: ['gift_shop'],
};

export interface OpeningPoint {
  day: number; // 0=日曜
  hour: number;
  minute: number;
}

export interface Place {
  id: string;
  name: string;
  location?: LatLng;
  businessStatus?: 'OPERATIONAL' | 'CLOSED_TEMPORARILY' | 'CLOSED_PERMANENTLY' | string;
  type?: string;
  address?: string;
  mapsUrl?: string;
  rating?: number;
  ratingCount?: number;
  periods?: { open: OpeningPoint; close?: OpeningPoint }[];
  weekdayText?: string[];
}

// 呼び出し回数を数える仕組み。スクリプトはファイルに、画面の API はあとでデータベースなどに数える
export interface UsageCounter {
  used(sku: PlacesSku): Promise<number>;
  add(sku: PlacesSku, n: number): Promise<void>;
}

export class PlacesLimitError extends Error {}
export class PlacesApiError extends Error {}

// 上限を超えそうなら呼ぶ前に止める
export async function ensureWithinLimit(counter: UsageCounter, sku: PlacesSku, planned: number, monthlyLimit: number) {
  const used = await counter.used(sku);
  if (used + planned > monthlyLimit) {
    throw new PlacesLimitError(
      `今月の Google Places（${sku}）の呼び出しは ${used}回で、あと${planned}回呼ぶと上限 ${monthlyLimit}回を超えます。`,
    );
  }
}

export interface NearbyOptions {
  apiKey: string;
  center: LatLng;
  radiusM: number; // 最大50,000
  types: string[];
  withHours: boolean; // 営業時間・評価も取る（Enterprise の料金）
  maxResults?: number; // 1〜20
}

export async function searchNearby(opts: NearbyOptions): Promise<{ sku: PlacesSku; places: Place[]; raw: unknown }> {
  const sku: PlacesSku = opts.withHours ? 'nearby_enterprise' : 'nearby_pro';
  const fields = opts.withHours ? [...PRO_FIELDS, ...ENTERPRISE_FIELDS] : PRO_FIELDS;
  const res = await fetch(NEARBY_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': opts.apiKey,
      'X-Goog-FieldMask': fields.join(','),
    },
    body: JSON.stringify({
      includedTypes: opts.types,
      maxResultCount: opts.maxResults ?? 20,
      rankPreference: 'DISTANCE',
      languageCode: 'ja',
      regionCode: 'JP',
      locationRestriction: {
        circle: { center: { latitude: opts.center.lat, longitude: opts.center.lng }, radius: opts.radiusM },
      },
    }),
  });
  const body = (await res.json().catch(() => ({}))) as { places?: unknown[]; error?: { message?: string; status?: string } };
  if (!res.ok) {
    throw new PlacesApiError(`HTTP ${res.status}: ${body.error?.status ?? ''} ${body.error?.message ?? ''}`.trim());
  }
  return { sku, places: parsePlaces(body), raw: body };
}

interface RawPlace {
  id?: string;
  displayName?: { text?: string };
  location?: { latitude?: number; longitude?: number };
  businessStatus?: string;
  primaryType?: string;
  primaryTypeDisplayName?: { text?: string };
  googleMapsUri?: string;
  shortFormattedAddress?: string;
  rating?: number;
  userRatingCount?: number;
  regularOpeningHours?: { periods?: { open: OpeningPoint; close?: OpeningPoint }[]; weekdayDescriptions?: string[] };
}

export function parsePlaces(body: { places?: unknown[] }): Place[] {
  return ((body.places ?? []) as RawPlace[]).map((p) => ({
    id: p.id ?? '',
    name: p.displayName?.text ?? '',
    location:
      p.location?.latitude != null && p.location?.longitude != null
        ? { lat: p.location.latitude, lng: p.location.longitude }
        : undefined,
    businessStatus: p.businessStatus,
    type: p.primaryTypeDisplayName?.text ?? p.primaryType,
    address: p.shortFormattedAddress,
    mapsUrl: p.googleMapsUri,
    rating: p.rating,
    ratingCount: p.userRatingCount,
    periods: p.regularOpeningHours?.periods,
    weekdayText: p.regularOpeningHours?.weekdayDescriptions,
  }));
}

export type OpenStatus =
  | { kind: 'closed_permanently' }
  | { kind: 'closed_temporarily' }
  | { kind: 'unknown' } // 営業時間を取っていない、または載っていない
  | { kind: 'always' } // 24時間営業
  | { kind: 'closed_that_day' }
  | { kind: 'open'; ranges: string[] }; // その日の営業時間（例: 10:00〜20:00）

const pad = (n: number) => String(n).padStart(2, '0');

// 日付（YYYY-MM-DD）の曜日（0=日曜）。実行する環境のタイムゾーンに左右されないよう UTC で計算する
export function weekdayOf(ymd: string): number {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

// その日（曜日）に開いているか。祝日の特別営業は regularOpeningHours に入らないので、祝日は目安になる
export function openStatusOn(place: Place, ymd: string): OpenStatus {
  if (place.businessStatus === 'CLOSED_PERMANENTLY') return { kind: 'closed_permanently' };
  if (place.businessStatus === 'CLOSED_TEMPORARILY') return { kind: 'closed_temporarily' };
  if (!place.periods) return { kind: 'unknown' };
  // 24時間営業は「日曜0:00に開いて閉まる時刻がない」1件で表される
  if (place.periods.length === 1 && !place.periods[0].close) return { kind: 'always' };
  const day = weekdayOf(ymd);
  const ranges = place.periods
    .filter((p) => p.open.day === day)
    .sort((a, b) => a.open.hour * 60 + a.open.minute - (b.open.hour * 60 + b.open.minute))
    .map((p) => {
      const close = p.close
        ? `${p.close.day !== day ? '翌' : ''}${pad(p.close.hour)}:${pad(p.close.minute)}`
        : '';
      return `${pad(p.open.hour)}:${pad(p.open.minute)}〜${close}`;
    });
  return ranges.length ? { kind: 'open', ranges } : { kind: 'closed_that_day' };
}

export function openStatusLabel(s: OpenStatus): string {
  switch (s.kind) {
    case 'closed_permanently':
      return '閉業';
    case 'closed_temporarily':
      return '一時休業中';
    case 'unknown':
      return '営業時間不明';
    case 'always':
      return '24時間営業';
    case 'closed_that_day':
      return 'この日は休み';
    case 'open':
      return s.ranges.join('、');
  }
}
