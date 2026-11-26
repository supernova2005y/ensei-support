// 楽天トラベルの検索結果を読み、宿を4グレードに振り分ける（API は呼ばない純粋な関数だけを置く）。
// scripts/rakuten-vacant.mjs の report() までの処理を、画面に出せる形のデータを返すように移したもの。
// API の呼び出しは src/lib/rakuten.ts。
//
// 表示の方針（research/05_rakuten_vacant_live_b.md）:
//   - グレードは、宿泊日に実際に払う料金で分ける（「奮発」「ちょっとリッチ」はお金の使い方の言葉なので）。
//     境目は料金の切れ目（対数をとった料金を、グループ内のばらつきが最小になるよう4つに分ける）で決める
//   - 値段は宿泊日の本当の料金（予約ページと一致する額）だけを出し、「普段の何倍」は出さない
//     各グレードに最低でも全体の15%は入るようにする（切れ目だけだと「最安」が数件しかない、といった偏りが出るため。
//     公演日の結果では、10%だと偏りが残り、20%だと「最安」の幅が3.6倍に広がった）
//   - 「奮発」は素敵なホテルに泊まりたい人が選ぶ。ただし楽天の評価は「値段のわりにどうか」も入るので、高級ホテルほど
//     低めに出る（例：汐留の高級ホテルが ★3.5台）。評価の高さでは絞らず、明らかに評判が悪い宿（★3.0未満・評価10件以上）だけ外す
//   - 「ちょっとリッチ」の値段で評価がとても高い宿（★4.7以上・評価30件以上）は、「奮発」の下に「評価が高いのに手頃」として添える
//   - 民泊・アパート型の施設は除く（部屋まるごとの料金で比べにくく、評価もないことが多いため）
//   - 施設検索API で会場の周りの楽天掲載施設をすべて取り、空室のない施設の数を距離ごとに出す
//   - 全部の宿を取ってからグレードを決めるので、グレードを選び直しても API を呼ぶ回数は変わらない（表示だけ絞る）

import type { EventConfig, LatLng, Station } from './events.ts';

export const GRADES = ['最安', 'リーズナブル', 'ちょっとリッチ', '奮発'] as const;
export type Grade = (typeof GRADES)[number];

export const DISTANCE_BANDS = [1, 2, 3]; // 空室のない施設を数える距離の区切り（km）
export const POOR_REVIEW = 3.0; // 「奮発」から外す評価（これ未満）
export const POOR_REVIEW_MIN_COUNT = 10; // 評価が少ないうちは当てにならないので、この件数以上のときだけ外す
export const HIDDEN_GEM_REVIEW = 4.7; // 「評価が高いのに手頃」とする評価の下限
export const HIDDEN_GEM_MIN_COUNT = 30;
export const WALKABLE_KM = 1.5; // これ以内なら「会場まで徒歩圏」と出す

// 楽天 API のレスポンス（必要な項目だけ。中身は信用せず、読むときに型を確かめる）
export interface RakutenBody {
  hotels?: unknown[];
  pagingInfo?: { pageCount?: number; recordCount?: number; page?: number };
}

// 検索結果の生データ一式（scripts/rakuten-vacant.mjs が out/ に保存する形と同じ）
export interface RawSearch {
  venue: RakutenBody; // 空室検索：会場の周り
  all?: RakutenBody | null; // 施設検索：会場の周りの楽天掲載施設すべて（空室のない施設を数えるため）
  stations: Record<string, RakutenBody>; // 空室検索：駅の周り（駅名ごと）
}

export interface Plan {
  roomName: string | undefined;
  planName: string | undefined;
  withBreakfast: boolean;
  total: number;
}

export interface Hotel extends Partial<LatLng> {
  no?: number;
  name?: string;
  station?: string;
  reviewAverage?: number;
  reviewCount?: number;
  url?: string;
  minTotal?: number;
  plans: Plan[];
}

export interface CombinedHotel extends Hotel {
  venueKm?: number;
  via?: Station & { km?: number };
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
const str = (v: unknown) => (typeof v === 'string' ? v : undefined);

// formatVersion=2: hotels は「施設ごとの配列」。先頭が hotelBasicInfo、続く要素が roomInfo（部屋・プランごと）。
// formatVersion=1（hotels: [{hotel: [...]}]）でも読めるようにしておく。施設検索API の結果も同じ形で読める
export function parseHotels(body: RakutenBody | null | undefined): Hotel[] {
  return (body?.hotels ?? []).map((entry) => {
    const parts: unknown[] = Array.isArray(entry) ? entry : isObj(entry) && Array.isArray(entry.hotel) ? entry.hotel : [];
    const objs = parts.filter(isObj);
    const basicRaw = objs.find((p) => isObj(p.hotelBasicInfo))?.hotelBasicInfo;
    const basic: Obj = isObj(basicRaw) ? basicRaw : {};
    const plans = objs
      .filter((p) => Array.isArray(p.roomInfo))
      .map((p) => {
        const info = (p.roomInfo as unknown[]).filter(isObj);
        const roomRaw = info.find((r) => isObj(r.roomBasicInfo))?.roomBasicInfo;
        const chargeRaw = info.find((r) => isObj(r.dailyCharge))?.dailyCharge;
        const room: Obj = isObj(roomRaw) ? roomRaw : {};
        const charge: Obj = isObj(chargeRaw) ? chargeRaw : {};
        return {
          roomName: str(room.roomName),
          planName: str(room.planName),
          withBreakfast: room.withBreakfastFlag === 1,
          total: num(charge.total),
        };
      })
      .filter((plan): plan is Plan => typeof plan.total === 'number');
    return {
      no: num(basic.hotelNo),
      name: str(basic.hotelName),
      station: str(basic.nearestStation),
      lat: num(basic.latitude),
      lng: num(basic.longitude),
      reviewAverage: num(basic.reviewAverage),
      reviewCount: num(basic.reviewCount),
      url: str(basic.hotelInformationUrl),
      minTotal: plans.length ? Math.min(...plans.map((plan) => plan.total)) : undefined,
      plans,
    };
  });
}

// 民泊・アパート型の施設か（施設名で判定。楽天の施設名には「／民泊」や「＾」が付いていることが多い）
export function isPrivateRental(h: { name?: string }): boolean {
  const name = (h.name ?? '').normalize('NFKC');
  return /民泊|\^|アパート|apart|ハイツ/i.test(name);
}

// ホステル（相部屋が中心で、ホテルと同じ比べ方ができないため、この画面では外す）
export function isHostel(h: { name?: string }): boolean {
  const name = (h.name ?? '').normalize('NFKC');
  return /ホステル|hostel/i.test(name);
}

// ゲストハウス（この画面では、ホステルと同じく相部屋が中心の宿として、除くかどうかを画面で選ぶ）
export function isGuestHouse(h: { name?: string }): boolean {
  const name = (h.name ?? '').normalize('NFKC');
  return /ゲストハウス|guest ?house/i.test(name);
}

// 画面で選ぶ「除く」の組み合わせ（true＝除く）。民泊・アパート型は、いつも除く
export interface LodgingExclude {
  hostels: boolean;
  guestHouses: boolean;
}
export const DEFAULT_EXCLUDE: LodgingExclude = { hostels: true, guestHouses: true };

export function isExcludedStay(h: { name?: string }, ex: LodgingExclude = DEFAULT_EXCLUDE): boolean {
  return isPrivateRental(h) || (ex.hostels && isHostel(h)) || (ex.guestHouses && isGuestHouse(h));
}

// 泊まる日の前日（前泊の宿を探すときに使う。YYYY-MM-DD）
export function previousDay(ymd: string): string {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

export function distanceKm(a: Partial<LatLng>, b: Partial<LatLng>): number | undefined {
  if (!a.lat || !a.lng || !b.lat || !b.lng) return undefined;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const h =
    Math.sin(toRad(b.lat - a.lat) / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(toRad(b.lng - a.lng) / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(h));
}

// 料金の切れ目で4つに分ける。値段は倍々で開くので対数をとり、グループ内のばらつき（二乗誤差）の合計が
// 最小になる区切りを動的計画法で探す（1次元の最適な k-means。件数は多くても数百なので十分速い）。
// 返り値は各グループの最初の料金（2〜4番目のグループの下限）
export function naturalBreaks(prices: number[], k: number = GRADES.length): number[] {
  const x = [...prices].sort((a, b) => a - b).map(Math.log);
  const n = x.length;
  if (n <= k) return [...prices].sort((a, b) => a - b).slice(1);
  const minSize = Math.max(1, Math.floor(n * 0.15)); // 各グループの最低件数（全体の15%）
  const s1 = [0];
  const s2 = [0];
  for (const v of x) {
    s1.push(s1[s1.length - 1] + v);
    s2.push(s2[s2.length - 1] + v * v);
  }
  const sse = (i: number, j: number) => {
    // x[i..j-1] のばらつき
    const m = j - i;
    const sum = s1[j] - s1[i];
    return s2[j] - s2[i] - (sum * sum) / m;
  };
  // cost[g][j]: 先頭 j 件を g グループに分けたときの最小コスト、cut[g][j]: そのときの最後のグループの始まり
  const cost = Array.from({ length: k + 1 }, () => new Array<number>(n + 1).fill(Infinity));
  const cut = Array.from({ length: k + 1 }, () => new Array<number>(n + 1).fill(0));
  cost[0][0] = 0;
  for (let g = 1; g <= k; g++) {
    for (let j = g; j <= n; j++) {
      for (let i = (g - 1) * minSize; i <= j - minSize; i++) {
        const c = cost[g - 1][i] + sse(i, j);
        if (c < cost[g][j]) {
          cost[g][j] = c;
          cut[g][j] = i;
        }
      }
    }
  }
  const starts: number[] = [];
  for (let g = k, j = n; g > 1; g--) {
    j = cut[g][j];
    starts.unshift(j);
  }
  return starts.map((i) => Math.round(Math.exp(x[i])));
}

export function gradeOf(price: number, breaks: number[]): Grade {
  const i = breaks.findIndex((b) => price < b);
  return GRADES[i === -1 ? GRADES.length - 1 : i];
}

// 会場の周りと駅の周りの結果をまとめ、施設ごとに「どう会場へ行くか」を付ける
export function combine(
  venue: LatLng,
  venueHotels: Hotel[],
  stationResults: { station: Station; hotels: Hotel[] }[],
): CombinedHotel[] {
  const byNo = new Map<number | undefined, CombinedHotel>();
  for (const h of venueHotels) {
    byNo.set(h.no, { ...h, venueKm: distanceKm(venue, h) });
  }
  for (const { station, hotels } of stationResults) {
    for (const h of hotels) {
      const entry: CombinedHotel = byNo.get(h.no) ?? { ...h, venueKm: distanceKm(venue, h) };
      const km = distanceKm(station, h);
      // 同じ施設が複数の駅の周りに出たら、会場まで一番早く着く駅を使う
      if (!entry.via || station.minutes < entry.via.minutes) entry.via = { ...station, km };
      byNo.set(h.no, entry);
    }
  }
  return [...byNo.values()];
}

export function accessLabel(h: CombinedHotel): string {
  const walk =
    h.venueKm !== undefined && h.venueKm <= WALKABLE_KM ? `会場まで徒歩圏（${h.venueKm.toFixed(1)}km）` : undefined;
  const train = h.via
    ? `${h.via.name}駅 ${Math.round((h.via.km ?? 0) * 1000)}m → ${h.via.line}で会場まで約${h.via.minutes}分（徒歩込み）`
    : undefined;
  if (walk) return walk;
  if (train) return train;
  return h.venueKm !== undefined
    ? `会場から${h.venueKm.toFixed(1)}km（最寄り: ${h.station ?? '不明'}）`
    : `最寄り: ${h.station ?? '不明'}`;
}

function nightsBetween(from: string, to: string): number {
  return Math.round((Date.parse(to) - Date.parse(from)) / 86400000);
}

// ---- 画面に渡す形 ----

export interface StayItem {
  no?: number;
  name: string;
  total: number; // 宿泊日の料金（泊数分・人数分の合計。予約ページと一致する額）
  perPerson?: number; // 2名以上のときの1人あたり
  reviewAverage?: number;
  reviewCount?: number;
  access: string;
  url?: string; // 予約リンク（アフィリエイトIDを付けて呼べばアフィリエイトつきの URL が返る）
  station?: string; // 最寄駅の名前（楽天の値。保存しない）
  lat?: number; // 位置（地図に出すだけ。サーバーに保存しない）
  lng?: number;
}

export interface GradeGroup {
  grade: Grade;
  min?: number;
  max?: number;
  hotels: StayItem[];
  removedPoor: string[]; // 「奮発」から外した、評判が明らかに悪い宿の名前
}

export interface SoldOutSummary {
  bands: { km: number; listed: number; full: number }[];
  nearFullNames: string[]; // 1km以内で空室なし
}

export interface StaysResult {
  checkin: string;
  checkout: string;
  nights: number;
  adults: number;
  vacantCount: number; // 空室のある施設（民泊・アパート型を除く）
  pricedCount: number; // そのうち料金つき
  rentalExcluded: number; // 除外した民泊・アパート型
  soldOut: SoldOutSummary | null;
  breaks: number[]; // 2〜4番目のグレードの下限（円）
  grades: GradeGroup[];
  hiddenGems: StayItem[]; // 評価が高いのに手頃（ちょっとリッチの値段で★4.7以上・評価30件以上）
}

// 検索結果の生データから、画面に出す一式を作る（scripts/rakuten-vacant.mjs の report() に相当）
export function buildStays(
  raw: RawSearch,
  event: Pick<EventConfig, 'venue' | 'stations'>,
  opts: { checkin: string; checkout: string; adults: number; exclude?: LodgingExclude },
): StaysResult {
  const venue = event.venue;
  const stations = event.stations ?? [];
  const venueHotels = parseHotels(raw.venue);
  const stationResults = stations.map((st) => ({ station: st, hotels: parseHotels(raw.stations?.[st.name]) }));
  const allHotels = raw.all ? parseHotels(raw.all) : undefined;
  const combined = combine(venue, venueHotels, stationResults);
  const ex = opts.exclude ?? DEFAULT_EXCLUDE;
  const hotels = combined.filter((h) => !isExcludedStay(h, ex));
  const priced = hotels
    .filter((h): h is CombinedHotel & { minTotal: number } => h.minTotal !== undefined)
    .sort((a, b) => a.minTotal - b.minTotal);

  let soldOut: SoldOutSummary | null = null;
  if (allHotels) {
    const vacantNos = new Set(venueHotels.map((h) => h.no));
    const listed = allHotels.filter((h) => !isExcludedStay(h, ex));
    soldOut = {
      bands: DISTANCE_BANDS.map((km) => {
        const inBand = listed.filter((h) => (distanceKm(venue, h) ?? Infinity) <= km);
        const full = inBand.filter((h) => !vacantNos.has(h.no));
        return { km, listed: inBand.length, full: full.length };
      }),
      nearFullNames: listed
        .filter((h) => (distanceKm(venue, h) ?? Infinity) <= 1 && !vacantNos.has(h.no))
        .map((h) => h.name ?? '（名前なし）'),
    };
  }

  const breaks = naturalBreaks(priced.map((h) => h.minTotal));
  const adults = opts.adults;
  const toItem = (h: CombinedHotel & { minTotal: number }): StayItem => ({
    no: h.no,
    name: h.name ?? '（名前なし）',
    total: h.minTotal,
    perPerson: adults > 1 ? Math.round(h.minTotal / adults) : undefined,
    reviewAverage: h.reviewAverage || undefined,
    reviewCount: h.reviewAverage ? h.reviewCount : undefined,
    access: accessLabel(h),
    url: h.url,
    station: h.station,
    lat: h.lat,
    lng: h.lng,
  });

  const poor = (h: Hotel) => (h.reviewAverage ?? 5) < POOR_REVIEW && (h.reviewCount ?? 0) >= POOR_REVIEW_MIN_COUNT;
  const grades = GRADES.map((grade): GradeGroup => {
    let group = priced.filter((h) => gradeOf(h.minTotal, breaks) === grade);
    let removedPoor: string[] = [];
    if (grade === '奮発') {
      removedPoor = group.filter(poor).map((h) => h.name ?? '（名前なし）');
      group = group.filter((h) => !poor(h));
    }
    const totals = group.map((h) => h.minTotal);
    return {
      grade,
      min: totals.length ? Math.min(...totals) : undefined,
      max: totals.length ? Math.max(...totals) : undefined,
      hotels: group.map(toItem),
      removedPoor,
    };
  });

  const hiddenGems = priced
    .filter(
      (h) =>
        gradeOf(h.minTotal, breaks) === 'ちょっとリッチ' &&
        (h.reviewAverage ?? 0) >= HIDDEN_GEM_REVIEW &&
        (h.reviewCount ?? 0) >= HIDDEN_GEM_MIN_COUNT,
    )
    .map(toItem);

  return {
    checkin: opts.checkin,
    checkout: opts.checkout,
    nights: nightsBetween(opts.checkin, opts.checkout),
    adults,
    vacantCount: hotels.length,
    pricedCount: priced.length,
    rentalExcluded: combined.length - hotels.length,
    soldOut,
    breaks,
    grades,
    hiddenGems,
  };
}
