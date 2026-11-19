// NAVITIME ルート検索(トータルナビ) API（RapidAPI 経由）を単体で叩いて、返ってくる項目を確認するスクリプト。
// 外部ライブラリは使わない（Node.js 20.12 以上）。
//
// 使い方:
//   1. .env に RAPIDAPI_KEY を書く（.env.example を参照）
//   2. 公演の設定ファイルの駅それぞれから会場までの経路を取る（宿の結果の「駅から会場まで◯分」を置き換えるため）:
//        node scripts/navitime-route.mjs --event events/live-b.json
//      1駅だけ試すなら --only 豊洲
//   3. 出発地（設定ファイルの origin。例: 名古屋駅）から会場までの経路を取る:
//        node scripts/navitime-route.mjs --event events/live-b.json --origin
//   4. 帰り：会場から新幹線に乗る駅（設定ファイルの homeward.boarding）までの経路を、終演の目安の時刻で取る:
//        node scripts/navitime-route.mjs --event events/live-b.json --homeward --update
//      （--update を付けると boarding の minutes を書き換える。最終便の判定 scripts/last-train.mjs で使う）
//   保存済みのJSONを読み直すだけなら: --from out/navitime-xxxx.json
//   駅→会場の結果で、設定ファイルの stations の minutes・line を書き換えるなら: --update（--from と一緒にも使える）
//
// 注意（research/06_reference_articles.md）:
//   - RapidAPI の無料プラン（Basic）は月500回まで。駅の数だけ呼ぶので、むやみに繰り返さない
//   - RapidAPI 版は電車の時刻が実際の時刻表ではなく平均の所要時間になり、バスは使えない見込み。
//     「駅から会場まで約◯分」の目安には使えるが、終演後の最終便の判断には使えない

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { setTimeout as sleep } from 'node:timers/promises';

const HOST = 'navitime-route-totalnavi.p.rapidapi.com';
const ENDPOINT = `https://${HOST}/route_transit`;

const { values: args } = parseArgs({
  options: {
    event: { type: 'string', default: 'events/live-b.json' },
    only: { type: 'string' },
    origin: { type: 'boolean', default: false },
    homeward: { type: 'boolean', default: false },
    time: { type: 'string' }, // 出発時刻（HH:MM）。省略時は駅→会場は開場の1時間前、出発地→会場は朝9時
    from: { type: 'string' },
    update: { type: 'boolean', default: false },
  },
});

// 運賃の種類。レスポンスには名前が入っていなかったので、2026-10-19の結果（名古屋→有明、豊洲→有明）の金額から推定した
const FARE_UNITS = {
  unit_0: '乗車券（きっぷ）',
  unit_48: 'IC',
  unit_1: '特急券（自由席）',
  unit_2: '特急券（指定席）',
  unit_3: '特急券（グリーン）',
};

const event = JSON.parse(readFileSync(args.event, 'utf8'));
const venue = event.venue;

function loadKey() {
  try {
    process.loadEnvFile('.env');
  } catch {
    // .env がなければ環境変数だけを見る
  }
  const key = process.env.RAPIDAPI_KEY;
  if (!key) {
    console.error('.env に RAPIDAPI_KEY がありません（.env.example を参照）');
    process.exit(1);
  }
  return key;
}

// 出発時刻を決める。開場時刻（venue.open、HH:MM）があれば、その1時間前に駅を出る想定にする
function startTime() {
  if (args.time) return `${event.checkin}T${args.time}:00`;
  if (args.origin) return `${event.checkin}T09:00:00`;
  if (args.homeward) return `${event.checkin}T${venue.endEstimate ?? '21:00'}:00`;
  const open = venue.open ?? '16:00';
  const [h, m] = open.split(':').map(Number);
  return `${event.checkin}T${String(h - 1).padStart(2, '0')}:${String(m).padStart(2, '0')}:00`;
}

async function fetchRoute(key, from, to) {
  const params = new URLSearchParams({
    start: `${from.lat},${from.lng}`,
    goal: `${to.lat},${to.lng}`,
    start_time: startTime(),
  });
  const res = await fetch(`${ENDPOINT}?${params}`, {
    headers: { 'x-rapidapi-key': key, 'x-rapidapi-host': HOST },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    console.error(`HTTP ${res.status}:`, JSON.stringify(body));
    if (res.status === 401 || res.status === 403) console.error('→ RAPIDAPI_KEY と、Basic プランを Subscribe 済みかを確認してください');
    if (res.status === 429) console.error('→ 呼び出しの上限（月500回／毎分50回）に達しました');
    process.exit(1);
  }
  return body;
}

// 運賃は fare に「料金の種類ごとの番号: 金額」の形で入っている（例: unit_0, unit_48）。
// 種類の名前はレスポンスの unit に入っていればそれを使い、なければ番号のまま出す
// 定期券（unit_128_train など）は遠征には関係ないので出さない。特急券があれば乗車券との合計も出す
function fareLabel(fare) {
  if (!fare) return '運賃不明';
  const parts = Object.entries(fare)
    .filter(([k]) => FARE_UNITS[k])
    .map(([k, v]) => `${FARE_UNITS[k]} ${Number(v).toLocaleString()}円`);
  const base = Number(fare.unit_0 ?? 0);
  const totals = ['unit_1', 'unit_2', 'unit_3']
    .filter((k) => fare[k] !== undefined)
    .map((k) => `${FARE_UNITS[k].replace(/特急券（|）/g, '')} ${(base + Number(fare[k])).toLocaleString()}円`);
  return parts.join(' / ') + (totals.length ? `  → 合計 ${totals.join('・')}` : '');
}

const clock = (t) => (t ? t.slice(11, 16) : '?');

function summarize(body) {
  const items = body.items ?? [];
  return items.map((item) => {
    const move = item.summary?.move ?? {};
    const rides = (item.sections ?? []).filter((s) => s.type === 'move' && s.move !== 'walk');
    const walks = (item.sections ?? []).filter((s) => s.type === 'move' && s.move === 'walk');
    return {
      minutes: move.time,
      fromTime: move.from_time,
      toTime: move.to_time,
      transfers: move.transit_count,
      fare: move.fare,
      walkMinutes: walks.reduce((sum, s) => sum + (s.time ?? 0), 0),
      lines: rides.map((s) => `${s.line_name ?? s.transport?.name ?? s.move}（${s.time ?? '?'}分）`),
      lineNames: rides.map((s) => s.line_name ?? s.transport?.name ?? s.move),
    };
  });
}

function report(raw) {
  const direction = raw.homeward ? `${venue.name}から` : `${venue.name}まで`;
  console.log(`\n${event.name}：${direction}（出発 ${raw.startTime}）`);
  for (const [name, body] of Object.entries(raw.routes)) {
    const routes = summarize(body);
    if (!routes.length) {
      console.log(`\n■ ${name}: 経路なし`);
      continue;
    }
    const best = routes.reduce((a, b) => ((b.minutes ?? Infinity) < (a.minutes ?? Infinity) ? b : a));
    console.log(`\n■ ${name}: 最短 約${best.minutes}分（徒歩${best.walkMinutes}分・乗換${best.transfers ?? '?'}回）  候補${routes.length}件`);
    for (const r of routes) {
      console.log(`  ${r.minutes}分（${clock(r.fromTime)}→${clock(r.toTime)}）  ${r.lines.join(' → ') || '徒歩のみ'}`);
      console.log(`      ${fareLabel(r.fare)}`);
    }
  }
  console.log('\n※ RapidAPI 版の時刻は時刻表ではなく平均の所要時間の見込み（research/06_reference_articles.md）');
  if (args.update && raw.homeward) updateBoarding(raw);
  else if (args.update && !raw.origin) updateEvent(raw);
}

// 会場から乗車駅までの最短経路の所要時間（徒歩込み）で、homeward.boarding を書き換える
function updateBoarding(raw) {
  for (const b of event.homeward?.boarding ?? []) {
    const routes = summarize(raw.routes[b.name] ?? {});
    if (!routes.length) continue;
    const best = routes.reduce((a, c) => ((c.minutes ?? Infinity) < (a.minutes ?? Infinity) ? c : a));
    b.minutes = best.minutes;
    b.minutesNote = `会場→駅（徒歩込み）。NAVITIME（RapidAPI、平均の所要時間）、${new Date().toISOString().slice(0, 10)}取得。経路: ${best.lineNames.join('→') || '徒歩'}`;
  }
  writeFileSync(args.event, `${JSON.stringify(event, null, 2)}\n`);
  console.log(`\n${args.event} の帰りの乗車駅までの所要時間を書き換えました`);
}

// 駅ごとの最短経路の所要時間（駅の座標から会場まで、徒歩込み）と路線で、設定ファイルを書き換える
function updateEvent(raw) {
  for (const st of event.stations ?? []) {
    const routes = summarize(raw.routes[st.name] ?? {});
    if (!routes.length) continue;
    const best = routes.reduce((a, b) => ((b.minutes ?? Infinity) < (a.minutes ?? Infinity) ? b : a));
    st.minutes = best.minutes;
    st.line = best.lineNames.join('→');
  }
  event.stationsNote =
    `駅から会場まで（徒歩込み）の所要時間。NAVITIME ルート検索（RapidAPI）の最短経路で、${new Date().toISOString().slice(0, 10)}取得。` +
    '時刻表ではなく平均の所要時間の見込み';
  writeFileSync(args.event, `${JSON.stringify(event, null, 2)}\n`);
  console.log(`\n${args.event} の駅の所要時間と路線を書き換えました`);
}

if (args.from) {
  report(JSON.parse(readFileSync(args.from, 'utf8')));
} else {
  const key = loadKey();
  const raw = { startTime: startTime(), origin: args.origin, homeward: args.homeward, routes: {} };
  let targets;
  if (args.homeward) {
    targets = (event.homeward?.boarding ?? []).filter((s) => !args.only || s.name === args.only);
  } else if (args.origin) {
    if (!event.origin) {
      console.error('設定ファイルに origin（出発地）がありません');
      process.exit(1);
    }
    targets = [event.origin];
  } else {
    targets = (event.stations ?? []).filter((s) => !args.only || s.name === args.only);
  }
  for (const [i, t] of targets.entries()) {
    if (i > 0) await sleep(1500); // 毎分50回の上限に当たらないよう間をあける
    console.log(args.homeward ? `${venue.name} → ${t.name} を検索中…` : `${t.name} → ${venue.name} を検索中…`);
    raw.routes[t.name] = args.homeward ? await fetchRoute(key, venue, t) : await fetchRoute(key, t, venue);
  }
  // 返ってきたJSONを保存しておき、どんな項目があるかを後から見られるようにする（out/ はgitに載せない）
  mkdirSync('out', { recursive: true });
  const kind = args.homeward ? 'homeward' : args.origin ? 'origin' : 'stations';
  const file = `out/navitime-${kind}-${Date.now()}.json`;
  writeFileSync(file, JSON.stringify(raw, null, 2));
  console.log(`生のレスポンスを保存しました: ${file}（呼び出し ${targets.length}回）`);
  report(raw);
}
