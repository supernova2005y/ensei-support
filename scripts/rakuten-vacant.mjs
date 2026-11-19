// 楽天トラベル 空室検索API を単体で叩いて、返ってくる項目を確認するスクリプト。
// サーバーの構成を決める前の「単体で叩く → 返ってくる項目を確認」段階用。外部ライブラリは使わない（Node.js 20.12 以上）。
//
// 使い方:
//   1. .env.example を .env にコピーして、楽天ウェブサービスで取ったIDを書く
//   2. node scripts/rakuten-vacant.mjs --event events/live-b.json
//      （日付・半径・人数は引数で上書きできる。例: --checkin 2026-12-14 --checkout 2026-12-15）
//   選んだグレードだけを見るなら: --grade 奮発（最安 / リーズナブル / ちょっとリッチ / 奮発）
//   保存済みのJSONを読み直すだけなら: node scripts/rakuten-vacant.mjs --event events/live-b.json --from out/rakuten-xxxx.json
//
// 探す場所:
//   - 会場の周り（半径 --radius km）
//   - 公演の設定ファイルの stations に書いた「会場へ行きやすい駅」の周り（半径 --station-radius km）
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
//   - 全部の宿を取ってからグレードを決めるので、--grade で絞っても API を呼ぶ回数は変わらない（表示だけ絞る）
//
// API仕様のメモは research/02_apis.md の 2-1 を参照。

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { setTimeout as sleep } from 'node:timers/promises';

const API_BASE = 'https://openapi.rakuten.co.jp/engine/api/Travel';
const VACANT_ENDPOINT = `${API_BASE}/VacantHotelSearch/20170426`;
const SIMPLE_ENDPOINT = `${API_BASE}/SimpleHotelSearch/20170426`;

const GRADES = ['最安', 'リーズナブル', 'ちょっとリッチ', '奮発'];
const DISTANCE_BANDS = [1, 2, 3]; // 空室のない施設を数える距離の区切り（km）
const POOR_REVIEW = 3.0; // 「奮発」から外す評価（これ未満）
const POOR_REVIEW_MIN_COUNT = 10; // 評価が少ないうちは当てにならないので、この件数以上のときだけ外す
const HIDDEN_GEM_REVIEW = 4.7; // 「評価が高いのに手頃」とする評価の下限
const HIDDEN_GEM_MIN_COUNT = 30;

const { values: args } = parseArgs({
  options: {
    event: { type: 'string', default: 'events/live-b.json' },
    radius: { type: 'string', default: '3.0' }, // 会場の周りを探す半径 km（0.1〜3.0）
    'station-radius': { type: 'string', default: '0.6' }, // 駅の周りを探す半径 km（徒歩10分弱）
    checkin: { type: 'string' },
    checkout: { type: 'string' },
    adults: { type: 'string', default: '1' },
    hits: { type: 'string', default: '30' }, // 1ページの件数（最大30）
    pages: { type: 'string', default: '3' },
    grade: { type: 'string' },
    from: { type: 'string' },
  },
});

if (args.grade && !GRADES.includes(args.grade)) {
  console.error(`--grade は ${GRADES.join(' / ')} のどれかを指定してください`);
  process.exit(1);
}

const event = JSON.parse(readFileSync(args.event, 'utf8'));
const checkin = args.checkin ?? event.checkin;
const checkout = args.checkout ?? event.checkout;
const venue = event.venue;
const stations = event.stations ?? [];

function loadEnv() {
  try {
    process.loadEnvFile('.env');
  } catch {
    // .env がなければ環境変数だけを見る
  }
  const env = {
    applicationId: process.env.RAKUTEN_APPLICATION_ID,
    accessKey: process.env.RAKUTEN_ACCESS_KEY,
    affiliateId: process.env.RAKUTEN_AFFILIATE_ID,
    referer: process.env.RAKUTEN_REFERER,
  };
  const missing = ['applicationId', 'accessKey', 'referer'].filter((k) => !env[k]);
  if (missing.length) {
    console.error(`.env に未設定の項目があります: ${missing.join(', ')}（.env.example を参照）`);
    process.exit(1);
  }
  return env;
}

function nightsBetween(from, to) {
  return Math.round((Date.parse(to) - Date.parse(from)) / 86400000);
}

// center: 検索の中心 {lat, lng}、extra: API ごとの追加の条件（空室検索なら日付・人数など）
async function fetchPage(env, endpoint, center, radius, extra, page) {
  const params = new URLSearchParams({
    applicationId: env.applicationId,
    accessKey: env.accessKey,
    format: 'json',
    formatVersion: '2',
    datumType: '1', // 世界測地系・度単位（指定しないと日本測地系・秒単位になる）
    latitude: String(center.lat),
    longitude: String(center.lng),
    searchRadius: String(radius),
    hits: args.hits,
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
  });
  const body = await res.json().catch(() => ({}));
  if (res.status === 404) return { hotels: [], pagingInfo: { pageCount: 0 }, notFound: true };
  if (!res.ok) {
    console.error(`HTTP ${res.status}:`, JSON.stringify(body));
    if (res.status === 403) console.error('→ Referer が楽天に登録したサイトURLと一致しているか確認してください');
    if (res.status === 429) console.error('→ 短時間に呼びすぎです。少し待ってから再実行してください');
    if (res.status === 503) {
      console.error('→ 楽天側の認証で失敗しています。アプリ登録直後なら数分〜数十分おいて再実行してください');
      // 何を送ったかを確認できるように、キーを伏せて表示する
      const shown = new URLSearchParams(params);
      shown.set('applicationId', `${env.applicationId.slice(0, 4)}…`);
      shown.set('accessKey', `${env.accessKey.slice(0, 5)}…`);
      console.error(`送ったURL: ${endpoint}?${shown}`);
      console.error(`Referer: ${env.referer} / Origin: ${new URL(env.referer).origin}`);
    }
    process.exit(1);
  }
  return body;
}

// 指定ページ数まで取り、1つのレスポンスにまとめる
async function fetchAll(env, endpoint, center, radius, extra) {
  const pageBodies = [];
  for (let page = 1; page <= Number(args.pages); page++) {
    await sleep(1000); // 短時間に続けて呼ぶと 429 になるので間をあける
    const body = await fetchPage(env, endpoint, center, radius, extra, page);
    pageBodies.push(body);
    if (body.notFound || page >= (body.pagingInfo?.pageCount ?? 1)) break;
  }
  const last = pageBodies[0].pagingInfo?.pageCount ?? 1;
  if (last > Number(args.pages)) console.log(`  ※ ${last}ページ中${args.pages}ページだけ取得（--pages で増やせる）`);
  return { pagingInfo: pageBodies[0].pagingInfo, hotels: pageBodies.flatMap((b) => b.hotels ?? []) };
}

// formatVersion=2: hotels は「施設ごとの配列」。先頭が hotelBasicInfo、続く要素が roomInfo（部屋・プランごと）。
// formatVersion=1（hotels: [{hotel: [...]}]）でも読めるようにしておく。施設検索API の結果も同じ形で読める
function parseHotels(body) {
  return (body.hotels ?? []).map((entry) => {
    const parts = Array.isArray(entry) ? entry : entry.hotel ?? [];
    const basic = parts.find((p) => p.hotelBasicInfo)?.hotelBasicInfo ?? {};
    const plans = parts
      .filter((p) => p.roomInfo)
      .map((p) => {
        const room = p.roomInfo.find((r) => r.roomBasicInfo)?.roomBasicInfo ?? {};
        const charge = p.roomInfo.find((r) => r.dailyCharge)?.dailyCharge ?? {};
        return {
          roomName: room.roomName,
          planName: room.planName,
          withBreakfast: room.withBreakfastFlag === 1,
          total: charge.total,
        };
      })
      .filter((plan) => typeof plan.total === 'number');
    return {
      no: basic.hotelNo,
      name: basic.hotelName,
      station: basic.nearestStation,
      lat: basic.latitude,
      lng: basic.longitude,
      reviewAverage: basic.reviewAverage,
      reviewCount: basic.reviewCount,
      url: basic.hotelInformationUrl,
      minTotal: plans.length ? Math.min(...plans.map((plan) => plan.total)) : undefined,
      plans,
    };
  });
}

// 民泊・アパート型の施設か（施設名で判定。楽天の施設名には「／民泊」や「＾」が付いていることが多い）
function isPrivateRental(h) {
  const name = (h.name ?? '').normalize('NFKC');
  return /民泊|\^|アパート|apart|ハイツ/i.test(name);
}

function distanceKm(a, b) {
  if (!a.lat || !a.lng || !b.lat || !b.lng) return undefined;
  const toRad = (d) => (d * Math.PI) / 180;
  const h =
    Math.sin(toRad(b.lat - a.lat) / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(toRad(b.lng - a.lng) / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(h));
}

// 料金の切れ目で4つに分ける。値段は倍々で開くので対数をとり、グループ内のばらつき（二乗誤差）の合計が
// 最小になる区切りを動的計画法で探す（1次元の最適な k-means。件数は多くても数百なので十分速い）。
// 返り値は各グループの最初の料金（2〜4番目のグループの下限）
function naturalBreaks(prices, k = GRADES.length) {
  const x = [...prices].sort((a, b) => a - b).map(Math.log);
  const n = x.length;
  if (n <= k) return [...prices].sort((a, b) => a - b).slice(1);
  const minSize = Math.max(1, Math.floor(n * 0.15)); // 各グループの最低件数（全体の15%）
  const s1 = [0];
  const s2 = [0];
  for (const v of x) {
    s1.push(s1.at(-1) + v);
    s2.push(s2.at(-1) + v * v);
  }
  const sse = (i, j) => {
    // x[i..j-1] のばらつき
    const m = j - i;
    const sum = s1[j] - s1[i];
    return s2[j] - s2[i] - (sum * sum) / m;
  };
  // cost[g][j]: 先頭 j 件を g グループに分けたときの最小コスト、cut[g][j]: そのときの最後のグループの始まり
  const cost = Array.from({ length: k + 1 }, () => new Array(n + 1).fill(Infinity));
  const cut = Array.from({ length: k + 1 }, () => new Array(n + 1).fill(0));
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
  const starts = [];
  for (let g = k, j = n; g > 1; g--) {
    j = cut[g][j];
    starts.unshift(j);
  }
  return starts.map((i) => Math.round(Math.exp(x[i])));
}

function gradeOf(price, breaks) {
  const i = breaks.findIndex((b) => price < b);
  return GRADES[i === -1 ? GRADES.length - 1 : i];
}

// 会場の周りと駅の周りの結果をまとめ、施設ごとに「どう会場へ行くか」を付ける
function combine(venueHotels, stationResults) {
  const byNo = new Map();
  for (const h of venueHotels) {
    byNo.set(h.no, { ...h, venueKm: distanceKm(venue, h) });
  }
  for (const { station, hotels } of stationResults) {
    for (const h of hotels) {
      const entry = byNo.get(h.no) ?? { ...h, venueKm: distanceKm(venue, h) };
      const km = distanceKm(station, h);
      // 同じ施設が複数の駅の周りに出たら、会場まで一番早く着く駅を使う
      if (!entry.via || station.minutes < entry.via.minutes) entry.via = { ...station, km };
      byNo.set(h.no, entry);
    }
  }
  return [...byNo.values()];
}

function accessLabel(h) {
  const walk = h.venueKm !== undefined && h.venueKm <= 1.5 ? `会場まで徒歩圏（${h.venueKm.toFixed(1)}km）` : undefined;
  const train = h.via
    ? `${h.via.name}駅 ${Math.round((h.via.km ?? 0) * 1000)}m → ${h.via.line}で会場まで約${h.via.minutes}分（徒歩込み）`
    : undefined;
  if (walk) return walk;
  if (train) return train;
  return h.venueKm !== undefined ? `会場から${h.venueKm.toFixed(1)}km（最寄り: ${h.station ?? '不明'}）` : `最寄り: ${h.station ?? '不明'}`;
}

function report(raw) {
  const venueHotels = parseHotels(raw.venue);
  const stationResults = stations.map((st) => ({ station: st, hotels: parseHotels(raw.stations?.[st.name] ?? {}) }));
  const allHotels = raw.all ? parseHotels(raw.all) : undefined;
  const combined = combine(venueHotels, stationResults);
  const hotels = combined.filter((h) => !isPrivateRental(h));
  const priced = hotels.filter((h) => h.minTotal !== undefined).sort((a, b) => a.minTotal - b.minTotal);
  const nights = nightsBetween(checkin, checkout);

  console.log(`\n${event.name}：${checkin}〜${checkout} 大人${args.adults}名`);
  console.log(
    `探した場所: ${venue.name}の半径${args.radius}km` +
      (stations.length ? `、駅の半径${args['station-radius']}km（${stations.map((s) => s.name).join('・')}）` : ''),
  );
  console.log(`空室のある施設: ${hotels.length}件（料金つき ${priced.length}件、民泊・アパート型の${combined.length - hotels.length}件は除外）`);

  if (allHotels) {
    const vacantNos = new Set(venueHotels.map((h) => h.no));
    const listed = allHotels.filter((h) => !isPrivateRental(h));
    const parts = DISTANCE_BANDS.map((km) => {
      const inBand = listed.filter((h) => (distanceKm(venue, h) ?? Infinity) <= km);
      const full = inBand.filter((h) => !vacantNos.has(h.no));
      return `${km}km以内 ${inBand.length}件中${full.length}件`;
    });
    console.log(`会場の周りで楽天に空室がない施設: ${parts.join(' / ')}`);
    const nearFull = listed.filter((h) => (distanceKm(venue, h) ?? Infinity) <= 1 && !vacantNos.has(h.no));
    if (nearFull.length) console.log(`  1km以内で空室なし: ${nearFull.map((h) => h.name).join('、')}`);
  }

  const breaks = naturalBreaks(priced.map((h) => h.minTotal));
  console.log(
    `グレードの境目（宿泊日の料金の切れ目）: ${GRADES.map((g, i) => (i === 0 ? g : `${breaks[i - 1]?.toLocaleString()}円〜 ${g}`)).join(' / ')}\n`,
  );

  const adults = Number(args.adults);
  const priceLabel = (total) =>
    adults > 1 ? `${total.toLocaleString()}円（1人あたり${Math.round(total / adults).toLocaleString()}円）` : `${total.toLocaleString()}円`;

  const printHotel = (h) => {
    const review = h.reviewAverage ? `★${h.reviewAverage}(${h.reviewCount})` : '★なし（評価がまだない）';
    console.log(`  ${priceLabel(h.minTotal)}  ${review}  ${h.name}  … ${accessLabel(h)}`);
  };

  for (const grade of GRADES) {
    if (args.grade && grade !== args.grade) continue;
    let group = priced.filter((h) => gradeOf(h.minTotal, breaks) === grade);
    let note = '';
    if (grade === '奮発') {
      const poor = (h) => (h.reviewAverage ?? 5) < POOR_REVIEW && (h.reviewCount ?? 0) >= POOR_REVIEW_MIN_COUNT;
      const removed = group.filter(poor);
      if (removed.length) note = `、★${POOR_REVIEW}未満の${removed.map((h) => h.name).join('、')}は外した`;
      group = group.filter((h) => !poor(h));
    }
    if (!group.length) continue;
    const totals = group.map((h) => h.minTotal);
    console.log(
      `■ ${grade}（${Math.min(...totals).toLocaleString()}〜${Math.max(...totals).toLocaleString()}円、${group.length}件${note}）`,
    );
    for (const h of group) printHotel(h);
    if (grade === '奮発') {
      const gems = priced.filter(
        (h) =>
          gradeOf(h.minTotal, breaks) === 'ちょっとリッチ' &&
          (h.reviewAverage ?? 0) >= HIDDEN_GEM_REVIEW &&
          (h.reviewCount ?? 0) >= HIDDEN_GEM_MIN_COUNT,
      );
      if (gems.length) {
        console.log(`  ─ 評価が高いのに手頃（ちょっとリッチの値段で★${HIDDEN_GEM_REVIEW}以上）`);
        for (const h of gems) printHotel(h);
      }
    }
  }
  if (nights !== 1) console.log(`\n※ 料金は${nights}泊分の合計`);
  if (stations.length && event.stationsNote) console.log(`\n※ 駅から会場までの時間: ${event.stationsNote}`);
  // 表示したグレードの中で一番安い施設のリンクを例として出す（--grade で絞ったときに、ほかのグレードの施設を出さないため）
  const shown = priced.filter((h) => !args.grade || gradeOf(h.minTotal, breaks) === args.grade);
  if (shown[0]) console.log(`\n例: ${shown[0].name}の予約リンク → ${shown[0].url}`);
}

if (args.from) {
  report(JSON.parse(readFileSync(args.from, 'utf8')));
} else {
  const env = loadEnv();
  const vacantExtra = { checkinDate: checkin, checkoutDate: checkout, adultNum: args.adults, sort: '+roomCharge' };
  const raw = { checkin, checkout, venue: null, all: null, stations: {} };
  console.log(`${venue.name}の周りを検索中…`);
  raw.venue = await fetchAll(env, VACANT_ENDPOINT, venue, args.radius, vacantExtra);
  raw.all = await fetchAll(env, SIMPLE_ENDPOINT, venue, args.radius, {});
  for (const st of stations) {
    console.log(`${st.name}駅の周りを検索中…`);
    raw.stations[st.name] = await fetchAll(env, VACANT_ENDPOINT, st, args['station-radius'], vacantExtra);
  }
  // 返ってきたJSONをまとめて保存しておき、--from で読み直したり、どんな項目があるかを後から見たりできるようにする
  mkdirSync('out', { recursive: true });
  const file = `out/rakuten-${checkin}-${Date.now()}.json`;
  writeFileSync(file, JSON.stringify(raw, null, 2));
  console.log(`生のレスポンスを保存しました: ${file}`);
  report(raw);
}
