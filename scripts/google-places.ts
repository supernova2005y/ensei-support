// Google Places API (New) の周辺検索を単体で叩いて、会場や行きやすい駅の周りの店・施設と、公演の日に開いているかを確認するスクリプト。
// 処理の本体は src/lib/places.ts（あとで画面の API からも同じものを使う）。Node.js 22.18 以上で、TypeScript のまま動かす。
//
// 使い方:
//   1. Google Cloud で Places API (New) を有効にし、APIキーを .env の GOOGLE_PLACES_API_KEY に書く
//   2. 呼ぶ回数だけ見る（API は呼ばない）:
//        node scripts/google-places.ts --event events/live-b.json --category パン屋 --dry-run
//   3. 実行する:
//        node scripts/google-places.ts --event events/live-b.json --category パン屋
//      場所を絞る: --where venue（会場だけ）/ --where 豊洲（その駅だけ）
//      営業時間・評価を取らずに安くする（Pro の料金）: --no-hours
//      月の上限（既定 900回。Enterprise の無料枠1,000回より少し下）: --limit 900
//   保存済みのJSONを読み直すだけなら: --from out/google-places-xxxx.json
//
// 呼んだ回数は out/google-places-usage.json に月ごと・料金の種類ごとに数える（out/ は git に載せない）。
// 上限を超えそうなら呼ぶ前に止まる。Google Cloud の予算アラートは通知だけなので、この数え方と、
// Google Cloud の「割り当て（Quotas）」で1日の上限を決めておくやり方の二重で守る（docs/google-places-setup.md）。

import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { setTimeout as sleep } from 'node:timers/promises';
import {
  CATEGORIES,
  ensureWithinLimit,
  openStatusLabel,
  openStatusOn,
  parsePlaces,
  PlacesApiError,
  PlacesLimitError,
  searchNearby,
  type PlacesSku,
  type UsageCounter,
} from '../src/lib/places.ts';

const USAGE_FILE = 'out/google-places-usage.json';

const { values: args } = parseArgs({
  options: {
    event: { type: 'string', default: 'events/live-b.json' },
    category: { type: 'string', default: 'パン屋' },
    where: { type: 'string', default: 'all' },
    'venue-radius': { type: 'string', default: '1000' }, // m
    'station-radius': { type: 'string', default: '500' }, // m
    'no-hours': { type: 'boolean', default: false },
    limit: { type: 'string', default: '900' },
    'dry-run': { type: 'boolean', default: false },
    from: { type: 'string' },
  },
});

const event = JSON.parse(readFileSync(args.event, 'utf8'));
const date: string = event.date ?? event.checkin;

// 月ごと（YYYY-MM）・料金の種類ごとに数えるファイル
const fileCounter: UsageCounter = {
  async used(sku: PlacesSku) {
    const data = existsSync(USAGE_FILE) ? JSON.parse(readFileSync(USAGE_FILE, 'utf8')) : {};
    return data[new Date().toISOString().slice(0, 7)]?.[sku] ?? 0;
  },
  async add(sku: PlacesSku, n: number) {
    const data = existsSync(USAGE_FILE) ? JSON.parse(readFileSync(USAGE_FILE, 'utf8')) : {};
    const month = new Date().toISOString().slice(0, 7);
    data[month] = { ...data[month], [sku]: (data[month]?.[sku] ?? 0) + n };
    mkdirSync('out', { recursive: true });
    writeFileSync(USAGE_FILE, `${JSON.stringify(data, null, 2)}\n`);
  },
};

interface Area {
  name: string;
  lat: number;
  lng: number;
  radiusM: number;
}

function areas(): Area[] {
  const list: Area[] = [];
  if (args.where === 'all' || args.where === 'venue') {
    list.push({ name: event.venue.name, lat: event.venue.lat, lng: event.venue.lng, radiusM: Number(args['venue-radius']) });
  }
  for (const st of event.stations ?? []) {
    if (args.where === 'all' || args.where === st.name) {
      list.push({ name: `${st.name}駅`, lat: st.lat, lng: st.lng, radiusM: Number(args['station-radius']) });
    }
  }
  return list;
}

function report(raw: { category: string; withHours: boolean; areas: (Area & { body: { places?: unknown[] } })[] }) {
  const week = '日月火水木金土'[new Date(`${date}T00:00:00Z`).getUTCDay()];
  console.log(`\n${event.name}：${date}（${week}）の「${raw.category}」`);
  for (const area of raw.areas) {
    const places = parsePlaces(area.body);
    console.log(`\n■ ${area.name}の周り ${area.radiusM}m：${places.length}件`);
    for (const p of places) {
      const status = raw.withHours ? openStatusLabel(openStatusOn(p, date)) : '';
      const mark = /閉業|休業|休み/.test(status) ? '⚠' : '';
      const review = p.rating ? `★${p.rating}(${p.ratingCount})` : '';
      console.log(`  ${mark}${p.name}［${p.type ?? '-'}］ ${review}  ${status ? `${week}曜: ${status}` : ''}`);
      console.log(`      ${p.address ?? ''}  ${p.mapsUrl ?? ''}`);
    }
  }
  console.log('\nGoogle マップのデータ（Places API）');
  if (raw.withHours) console.log('※ 営業時間はいつもの曜日ごとの時間。祝日や臨時の休みは入らないので、お店のページで確かめる');
}

if (args.from) {
  report(JSON.parse(readFileSync(args.from, 'utf8')));
} else {
  const types = CATEGORIES[args.category];
  if (!types) {
    console.error(`--category は ${Object.keys(CATEGORIES).join(' / ')} のどれかにしてください`);
    process.exit(1);
  }
  const withHours = !args['no-hours'];
  const sku: PlacesSku = withHours ? 'nearby_enterprise' : 'nearby_pro';
  const targets = areas();
  const limit = Number(args.limit);
  const used = await fileCounter.used(sku);
  console.log(`今月の呼び出し（${sku}）: ${used}回 ／ 上限 ${limit}回。今回 ${targets.length}回呼ぶ予定`);
  if (args['dry-run']) process.exit(0);

  try {
    await ensureWithinLimit(fileCounter, sku, targets.length, limit);
  } catch (e) {
    if (e instanceof PlacesLimitError) {
      console.error(e.message);
      process.exit(1);
    }
    throw e;
  }
  try {
    process.loadEnvFile('.env');
  } catch {
    // .env がなければ環境変数だけを見る
  }
  const apiKey = process.env.GOOGLE_PLACES_API_KEY;
  if (!apiKey) {
    console.error('.env に GOOGLE_PLACES_API_KEY がありません（.env.example を参照）');
    process.exit(1);
  }

  const raw = { category: args.category, withHours, areas: [] as (Area & { body: { places?: unknown[] } })[] };
  for (const [i, area] of targets.entries()) {
    if (i > 0) await sleep(300);
    console.log(`${area.name}の周りを検索中…`);
    try {
      const result = await searchNearby({ apiKey, center: area, radiusM: area.radiusM, types, withHours });
      raw.areas.push({ ...area, body: result.raw as { places?: unknown[] } });
    } catch (e) {
      if (e instanceof PlacesApiError) {
        console.error(e.message);
        if (/PERMISSION_DENIED|API_KEY/.test(e.message)) console.error('→ キーと、Places API (New) が有効になっているかを確認してください');
        if (/INVALID_ARGUMENT/.test(e.message)) console.error('→ src/lib/places.ts の CATEGORIES の種類の名前を確認してください');
        await fileCounter.add(sku, i + 1); // ここまでに呼んだ分を数えておく（失敗した1回も念のため数える）
        process.exit(1);
      }
      throw e;
    }
  }
  await fileCounter.add(sku, targets.length);
  mkdirSync('out', { recursive: true });
  const file = `out/google-places-${Date.now()}.json`;
  writeFileSync(file, JSON.stringify(raw, null, 2));
  console.log(`生のレスポンスを保存しました: ${file}（今月の呼び出し ${used + targets.length}回）`);
  report(raw);
}
