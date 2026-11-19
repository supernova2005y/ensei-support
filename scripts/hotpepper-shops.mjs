// ホットペッパーグルメ グルメサーチAPI を単体で叩いて、会場や行きやすい駅の周りのお店を確認するスクリプト。
// 外部ライブラリは使わない（Node.js 20.12 以上）。API仕様のメモは research/02_apis.md の 2-10 を参照。
//
// 使い方:
//   1. リクルートWEBサービスに登録して届いたAPIキーを .env の HOTPEPPER_API_KEY に書く
//   2. 会場の周り（1km）と行きやすい駅の周り（500m）のお店を出す:
//        node scripts/hotpepper-shops.mjs --event events/live-b.json
//      ジャンルで絞る（名前はジャンルのマスタAPIで番号に直す）: --genre カフェ・スイーツ
//      キーワードで絞る（おみやげのパン屋など）: --keyword パン
//      場所を絞る: --where venue（会場だけ）/ --where 豊洲（その駅だけ）
//      ジャンルの一覧を見る: --list-genres
//      チェーン店かどうかの判定を省く（API の呼び出しを減らす）: --no-chain
//      ここだけのお店（チェーンでない店）だけを出す: --only-unique
//   保存済みのJSONを読み直すだけなら: --from out/hotpepper-xxxx.json
//
// 注意:
//   - エラーでも HTTP 200 が返るので、本文の results.error を見て判定する
//   - 使うときは「ホットペッパーグルメ Webサービス」のクレジット表示が必要（画面に出すときも忘れない）
//   - 営業時間（open）と定休日（close）は自由な文章で返るので、公演の曜日と合うかは目で確かめる。
//     定休日に公演の曜日が書かれていそうなお店には印を付ける（あくまで目安）
//   - チェーン店か、そこにしかないお店かを分ける。ホットペッパーにはチェーンかどうかの項目がないので、
//     店名からブランド名を取り出し（「◯◯店」や施設名を除く）、店名サーチAPIで全国の店舗数を数える。
//     10店以上＝チェーン、2〜9店＝数店舗、1店＝ここだけ（★で目立たせる）。ブランド名の取り出しは目安なので表示して確かめる

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { setTimeout as sleep } from 'node:timers/promises';

const API_BASE = 'https://webservice.recruit.co.jp/hotpepper';
const GOURMET_ENDPOINT = `${API_BASE}/gourmet/v1/`;
const GENRE_ENDPOINT = `${API_BASE}/genre/v1/`;
const SHOP_ENDPOINT = `${API_BASE}/shop/v1/`; // 店名サーチAPI（全国の店舗数を数えるのに使う）
const CHAIN_MIN = 10; // 全国でこの数以上あればチェーン
// これだけではブランド名として広すぎる言葉（「CAFE ◯◯」の「CAFE」で数えると全国の喫茶店が引っかかる）
const GENERIC_WORDS = /^(cafe|café|カフェ|the|bar|バー|coffee|珈琲|喫茶|食堂|ダイニング|restaurant|レストラン)$/i;

// 検索範囲のコード（APIの仕様: 1=300m, 2=500m, 3=1km, 4=2km, 5=3km）
const RANGE = { 300: '1', 500: '2', 1000: '3', 2000: '4', 3000: '5' };
const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土'];

const { values: args } = parseArgs({
  options: {
    event: { type: 'string', default: 'events/live-b.json' },
    where: { type: 'string', default: 'all' },
    genre: { type: 'string' },
    keyword: { type: 'string' },
    'venue-range': { type: 'string', default: '1000' }, // m
    'station-range': { type: 'string', default: '500' }, // m
    count: { type: 'string', default: '30' }, // 1か所あたりの件数（最大100）
    'list-genres': { type: 'boolean', default: false },
    'no-chain': { type: 'boolean', default: false },
    'only-unique': { type: 'boolean', default: false },
    from: { type: 'string' },
  },
});

const event = JSON.parse(readFileSync(args.event, 'utf8'));
const venue = event.venue;

function loadKey() {
  try {
    process.loadEnvFile('.env');
  } catch {
    // .env がなければ環境変数だけを見る
  }
  const key = process.env.HOTPEPPER_API_KEY;
  if (!key) {
    console.error('.env に HOTPEPPER_API_KEY がありません（.env.example を参照）');
    process.exit(1);
  }
  return key;
}

async function callApi(endpoint, params) {
  const res = await fetch(`${endpoint}?${new URLSearchParams({ ...params, format: 'json' })}`);
  const body = await res.json().catch(() => ({}));
  const error = body.results?.error;
  if (!res.ok || error) {
    console.error(`HTTP ${res.status}:`, JSON.stringify(error ?? body));
    if (JSON.stringify(error ?? '').includes('キー')) console.error('→ HOTPEPPER_API_KEY を確認してください');
    process.exit(1);
  }
  return body.results;
}

async function genreCode(key, name) {
  if (/^G\d{3}$/.test(name)) return name;
  const results = await callApi(GENRE_ENDPOINT, { key });
  const found = results.genre.find((g) => g.name === name || g.name.includes(name));
  if (!found) {
    console.error(`ジャンル「${name}」が見つかりません。--list-genres で一覧を見られます`);
    process.exit(1);
  }
  return found.code;
}

function distanceM(a, b) {
  const toRad = (d) => (d * Math.PI) / 180;
  const h =
    Math.sin(toRad(b.lat - a.lat) / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(toRad(b.lng - a.lng) / 2) ** 2;
  return Math.round(6371000 * 2 * Math.asin(Math.sqrt(h)));
}

// 日付（YYYY-MM-DD）の曜日。実行する環境のタイムゾーンに左右されないよう UTC で計算する
const weekdayOf = (date) => WEEKDAYS[new Date(`${date}T00:00:00Z`).getUTCDay()];

// 定休日の文章に公演の曜日が入っていそうか。「祝日」の「日」を日曜と取り違えないよう、前後を区切り文字に限る
function maybeClosedOn(close, date) {
  if (!close) return false;
  const w = weekdayOf(date);
  return new RegExp(`${w}曜|(^|[、・,，/\\s])${w}([、・,，/\\s]|$)`).test(close);
}

// 店名からブランド名を取り出す。宣伝文句（「…貸切可！」）、読みがなの重複、「◯◯店」より後ろ、施設名を除く
function brandOf(name) {
  let n = (name ?? '').normalize('NFKC').replace(/^.*[!！]\s*/, '').trim();
  const tokens = n.split(/\s+/);
  const shopIdx = tokens.findIndex((t, i) => i > 0 && /店$/.test(t));
  let brand;
  if (shopIdx > 0) brand = tokens.slice(0, shopIdx).join(' ');
  else if (tokens.length > 1) brand = tokens[0];
  else brand = n.replace(/\S*店$/, '') || n;
  // 「CAFE Ariake Miraie」のように最初の語が一般的な言葉なら、2語目まで含める
  if (GENERIC_WORDS.test(brand) && tokens.length > 1) brand = tokens.slice(0, 2).join(' ');
  return brand.trim();
}

function chainLabel(count) {
  if (count == null) return '';
  if (count >= CHAIN_MIN) return `［チェーン 全国${count}店］`;
  if (count >= 2) return `［数店舗 全国${count}店］`;
  return '［★ここだけ］';
}

function report(raw) {
  const date = event.checkin;
  const w = weekdayOf(date);
  const cond = [raw.genreName && `ジャンル: ${raw.genreName}`, raw.keyword && `キーワード: ${raw.keyword}`].filter(Boolean);
  console.log(`\n${event.name}：${date}（${w}）のお店${cond.length ? `（${cond.join('・')}）` : ''}`);
  for (const place of raw.places) {
    const shops = place.results.shop ?? [];
    const total = Number(place.results.results_available ?? shops.length);
    console.log(`\n■ ${place.name}の周り ${place.rangeM}m：${total}件${total > shops.length ? `（うち${shops.length}件を表示）` : ''}`);
    const sorted = shops
      .map((s) => ({ ...s, dist: distanceM(place, { lat: Number(s.lat), lng: Number(s.lng) }) }))
      .sort((a, b) => a.dist - b.dist);
    const counts = raw.brandCounts ?? {};
    const shown = args['only-unique']
      ? sorted.filter((s) => (counts[brandOf(s.name)] ?? Infinity) < 2)
      : sorted;
    const unique = sorted.filter((s) => counts[brandOf(s.name)] === 1);
    if (raw.brandCounts) console.log(`  （★ここだけのお店 ${unique.length}件）`);
    for (const s of shown) {
      const flag = maybeClosedOn(s.close, date) ? `  ⚠定休日に「${w}」？` : '';
      const brand = brandOf(s.name);
      const chain = raw.brandCounts ? `${chainLabel(counts[brand])}${brand !== s.name.normalize('NFKC') ? `（ブランド名: ${brand}）` : ''}` : '';
      console.log(`  ${s.dist}m  ${s.name}［${s.genre?.name ?? '-'}］ 予算 ${s.budget?.average || s.budget?.name || '-'}${flag}`);
      if (chain) console.log(`      ${chain}`);
      console.log(`      営業: ${s.open || '-'} ／ 定休日: ${s.close || '-'}`);
      console.log(`      ${s.urls?.pc ?? ''}`);
    }
  }
  console.log('\nPowered by ホットペッパーグルメ Webサービス（http://webservice.recruit.co.jp/）');
  console.log('※ 営業時間・定休日は自由な文章なので、公演の日に開いているかはお店のページで確かめる');
}

if (args.from) {
  report(JSON.parse(readFileSync(args.from, 'utf8')));
} else {
  const key = loadKey();
  if (args['list-genres']) {
    const results = await callApi(GENRE_ENDPOINT, { key });
    for (const g of results.genre) console.log(`${g.code}  ${g.name}`);
    process.exit(0);
  }

  const places = [];
  if (args.where === 'all' || args.where === 'venue') places.push({ ...venue, rangeM: Number(args['venue-range']) });
  for (const st of event.stations ?? []) {
    if (args.where === 'all' || args.where === st.name) places.push({ ...st, name: `${st.name}駅`, rangeM: Number(args['station-range']) });
  }
  if (!places.length) {
    console.error(`--where ${args.where} に当たる場所がありません（venue か、設定ファイルの駅の名前）`);
    process.exit(1);
  }

  const raw = { keyword: args.keyword, genreName: args.genre, places: [] };
  const extra = {};
  if (args.genre) extra.genre = await genreCode(key, args.genre);
  if (args.keyword) extra.keyword = args.keyword;
  for (const [i, place] of places.entries()) {
    if (i > 0) await sleep(500);
    const range = RANGE[place.rangeM];
    if (!range) {
      console.error(`範囲は ${Object.keys(RANGE).join(' / ')} m のどれかにしてください`);
      process.exit(1);
    }
    console.log(`${place.name}の周りを検索中…`);
    const results = await callApi(GOURMET_ENDPOINT, {
      key,
      lat: String(place.lat),
      lng: String(place.lng),
      range,
      count: args.count,
      ...extra,
    });
    raw.places.push({ name: place.name, lat: place.lat, lng: place.lng, rangeM: place.rangeM, results });
  }
  let calls = places.length + (args.genre ? 1 : 0);
  if (!args['no-chain']) {
    // ブランドごとに全国の店舗数を数える（同じブランドは1回だけ）
    const brands = [...new Set(raw.places.flatMap((p) => (p.results.shop ?? []).map((s) => brandOf(s.name))))];
    console.log(`チェーン店かどうかを調べています（${brands.length}ブランド）…`);
    raw.brandCounts = {};
    for (const brand of brands) {
      await sleep(300);
      const results = await callApi(SHOP_ENDPOINT, { key, keyword: brand, count: '1' });
      raw.brandCounts[brand] = Number(results.results_available ?? 0);
    }
    calls += brands.length;
  }
  // 返ってきたJSONを保存しておき、どんな項目があるかを後から見られるようにする（out/ はgitに載せない）
  mkdirSync('out', { recursive: true });
  const file = `out/hotpepper-${Date.now()}.json`;
  writeFileSync(file, JSON.stringify(raw, null, 2));
  console.log(`生のレスポンスを保存しました: ${file}（呼び出し ${calls}回）`);
  report(raw);
}
