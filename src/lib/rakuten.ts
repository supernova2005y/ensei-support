// 楽天トラベル 空室検索API・施設検索API を呼ぶ（サーバー側でだけ使う。キーをブラウザに渡さない）。
// scripts/rakuten-vacant.mjs の API 呼び出し部分を移したもの。結果の読み取りとグレード分けは src/lib/stays.ts。
//
// 探す場所:
//   - 会場の周り（半径 VENUE_RADIUS_KM）
//   - 公演の設定ファイルの stations に書いた「会場へ行きやすい駅」の周り（半径 STATION_RADIUS_KM）
//
// 楽天の規約で、取得したデータを多くの人が共有する形で保存することはできないので、結果は保存もキャッシュもしない
// （1回の画面表示のためにその場で取り、返したら捨てる）。
//
// API仕様のメモは research/02_apis.md の 2-1 を参照。

import { setTimeout as sleep } from 'node:timers/promises';
import type { EventConfig, LatLng } from './events.ts';
import { buildStays, type RakutenBody, type RawSearch, type StaysResult } from './stays.ts';

const API_BASE = 'https://openapi.rakuten.co.jp/engine/api/Travel';
const VACANT_ENDPOINT = `${API_BASE}/VacantHotelSearch/20170426`;
const SIMPLE_ENDPOINT = `${API_BASE}/SimpleHotelSearch/20170426`;

export const VENUE_RADIUS_KM = 3.0; // 会場の周りを探す半径 km（0.1〜3.0）
export const STATION_RADIUS_KM = 0.6; // 駅の周りを探す半径 km（徒歩10分弱）
const HITS = 30; // 1ページの件数（最大30）
const MAX_PAGES = 3;
const CALL_INTERVAL_MS = 1000; // 短時間に続けて呼ぶと 429 になるので間をあける
// Vercel の関数は maxDuration（60秒）で打ち切られるので、それより前に探すのをやめて、取れた分だけで返す
const TIME_BUDGET_MS = 45_000;

export interface RakutenEnv {
  applicationId: string;
  accessKey: string;
  affiliateId?: string;
  referer: string;
}

export class RakutenConfigError extends Error {}

export class RakutenApiError extends Error {
  status: number;
  hint?: string;
  constructor(status: number, message: string, hint?: string) {
    super(message);
    this.status = status;
    this.hint = hint;
  }
}

// 環境変数からキーを読む。アフィリエイトIDは任意（付けると予約リンクがアフィリエイトつきになる）
export function readRakutenEnv(env: Record<string, string | undefined> = process.env): RakutenEnv {
  const values = {
    RAKUTEN_APPLICATION_ID: env.RAKUTEN_APPLICATION_ID?.trim(),
    RAKUTEN_ACCESS_KEY: env.RAKUTEN_ACCESS_KEY?.trim(),
    RAKUTEN_REFERER: env.RAKUTEN_REFERER?.trim(),
  };
  const missing = Object.entries(values)
    .filter(([, v]) => !v)
    .map(([k]) => k);
  if (missing.length) {
    throw new RakutenConfigError(
      `楽天APIのキーが設定されていません（${missing.join('、')}）。Vercel の Environment Variables に設定してから、もう一度デプロイしてください。`,
    );
  }
  try {
    new URL(values.RAKUTEN_REFERER!);
  } catch {
    throw new RakutenConfigError('RAKUTEN_REFERER は https://github.com/ のような URL の形で設定してください。');
  }
  return {
    applicationId: values.RAKUTEN_APPLICATION_ID!,
    accessKey: values.RAKUTEN_ACCESS_KEY!,
    affiliateId: env.RAKUTEN_AFFILIATE_ID?.trim() || undefined,
    referer: values.RAKUTEN_REFERER!,
  };
}

interface SearchContext {
  env: RakutenEnv;
  deadline: number;
  notes: string[];
  timedOut: boolean;
}

// center: 検索の中心 {lat, lng}、extra: API ごとの追加の条件（空室検索なら日付・人数など）
async function fetchPage(
  ctx: SearchContext,
  endpoint: string,
  center: LatLng,
  radius: number,
  extra: Record<string, string>,
  page: number,
): Promise<RakutenBody & { notFound?: boolean }> {
  const { env } = ctx;
  const params = new URLSearchParams({
    applicationId: env.applicationId,
    accessKey: env.accessKey,
    format: 'json',
    formatVersion: '2',
    datumType: '1', // 世界測地系・度単位（指定しないと日本測地系・秒単位になる）
    latitude: String(center.lat),
    longitude: String(center.lng),
    searchRadius: String(radius),
    hits: String(HITS),
    page: String(page),
    ...extra,
  });
  if (env.affiliateId) params.set('affiliateId', env.affiliateId);

  // 新ドメインでは「許可されたWebサイト」と一致する Referer / Origin がないと 403 になる。
  // Referer だけでは REQUEST_CONTEXT_BODY_HTTP_REFERRER_MISSING で弾かれたので Origin も付ける
  // accessKey は公式にはヘッダー（Authorization: Bearer）でもクエリでも渡せるとされているので、両方に付ける
  const res = await fetch(`${endpoint}?${params}`, {
    headers: {
      Referer: env.referer,
      Origin: new URL(env.referer).origin,
      Authorization: `Bearer ${env.accessKey}`,
    },
    cache: 'no-store', // 楽天のデータはサーバーに残さない
  });
  const body = (await res.json().catch(() => ({}))) as RakutenBody & { error?: string; error_description?: string };
  // 404 は「条件に合う施設がない」の意味なので、0件として扱う
  if (res.status === 404) return { hotels: [], pagingInfo: { pageCount: 0 }, notFound: true };
  if (!res.ok) {
    // キーは返さない。楽天のエラーの種類だけを添える
    const detail = [body.error, body.error_description].filter(Boolean).join(': ');
    const message = `楽天APIがエラーを返しました（HTTP ${res.status}${detail ? `、${detail}` : ''}）`;
    let hint: string | undefined;
    if (res.status === 403) hint = 'RAKUTEN_REFERER が楽天に登録した「許可されたWebサイト」と一致しているか確認してください。';
    if (res.status === 429) hint = '短時間に呼びすぎです。1分ほど待ってから、もう一度探してください。';
    if (res.status === 503)
      hint =
        '楽天側の認証で失敗しています。RAKUTEN_APPLICATION_ID と RAKUTEN_ACCESS_KEY を確認してください。アプリ登録直後なら数分〜数十分おいて再実行してください。';
    throw new RakutenApiError(res.status, message, hint);
  }
  return body;
}

// 指定ページ数まで取り、1つのレスポンスにまとめる
async function fetchAll(
  ctx: SearchContext,
  label: string,
  endpoint: string,
  center: LatLng,
  radius: number,
  extra: Record<string, string>,
): Promise<RakutenBody> {
  const pageBodies: (RakutenBody & { notFound?: boolean })[] = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    if (Date.now() + CALL_INTERVAL_MS > ctx.deadline) {
      ctx.timedOut = true;
      break;
    }
    await sleep(CALL_INTERVAL_MS); // 短時間に続けて呼ぶと 429 になるので間をあける
    const body = await fetchPage(ctx, endpoint, center, radius, extra, page);
    pageBodies.push(body);
    if (body.notFound || page >= (body.pagingInfo?.pageCount ?? 1)) break;
  }
  if (!pageBodies.length) return { hotels: [] };
  const last = pageBodies[0].pagingInfo?.pageCount ?? 1;
  if (last > MAX_PAGES) ctx.notes.push(`${label}は${last}ページ中${MAX_PAGES}ページだけ取得（安い順に${HITS * MAX_PAGES}件まで）`);
  return { pagingInfo: pageBodies[0].pagingInfo, hotels: pageBodies.flatMap((b) => b.hotels ?? []) };
}

export interface StaysResponse extends StaysResult {
  venueRadiusKm: number;
  stationRadiusKm: number;
  stationNames: string[];
  stationsNote?: string;
  notes: string[];
}

// 会場と駅の周りを検索して、グレード分けした結果を返す（1回で楽天APIを10回前後、1秒おきに呼ぶ）
export async function searchStays(
  event: EventConfig,
  opts: { adults: number; env?: RakutenEnv; now?: () => number },
): Promise<StaysResponse> {
  const env = opts.env ?? readRakutenEnv();
  const now = opts.now ?? Date.now;
  const ctx: SearchContext = { env, deadline: now() + TIME_BUDGET_MS, notes: [], timedOut: false };
  const { checkin, checkout, venue } = event;
  const stations = event.stations ?? [];
  const vacantExtra = {
    checkinDate: checkin,
    checkoutDate: checkout,
    adultNum: String(opts.adults),
    sort: '+roomCharge',
  };

  const raw: RawSearch = { venue: { hotels: [] }, all: null, stations: {} };
  raw.venue = await fetchAll(ctx, `${venue.name}の周りの空室`, VACANT_ENDPOINT, venue, VENUE_RADIUS_KM, vacantExtra);
  const all = await fetchAll(ctx, `${venue.name}の周りの施設一覧`, SIMPLE_ENDPOINT, venue, VENUE_RADIUS_KM, {});
  raw.all = all.pagingInfo ? all : null; // 時間切れで1ページも取れなかったら、空室なしの数は出さない
  for (const st of stations) {
    raw.stations[st.name] = await fetchAll(ctx, `${st.name}駅の周り`, VACANT_ENDPOINT, st, STATION_RADIUS_KM, vacantExtra);
  }
  if (ctx.timedOut) ctx.notes.push('時間内に探しきれなかったので、取れた分だけで出しています（遠い駅の周りが抜けている場合があります）');

  const result = buildStays(raw, event, { checkin, checkout, adults: opts.adults });
  return {
    ...result,
    venueRadiusKm: VENUE_RADIUS_KM,
    stationRadiusKm: STATION_RADIUS_KM,
    stationNames: stations.map((s) => s.name),
    stationsNote: event.stationsNote,
    notes: ctx.notes,
  };
}
