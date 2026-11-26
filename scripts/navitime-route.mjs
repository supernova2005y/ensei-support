// NAVITIME ルート検索(トータルナビ) API（RapidAPI 経由）を単体で叩いて、返ってくる中身を画面で確かめるスクリプト。
// 外部ライブラリは使わない（Node.js 22.18 以上。src/lib/navitime.ts を読み込む）。
//
// 規約（利用規約（RapidAPI）第5条5。docs/API規約メモ.md）：受け取ったデータ（経路・時刻・運賃・緯度経度など）は、
// キャッシュなどに保存してはいけない。なので、このスクリプトは結果を画面に出すだけで、ファイルには書かない。
// 公演の設定ファイル（events/*.json）の所要時間は、人が乗換検索で確かめた値を入れる。
//
// 使い方（.env に RAPIDAPI_KEY を書いてから）:
//   帰り：会場から出発地（origin。例: 名古屋駅）まで、終演の目安＋退場の時間の時刻で1回だけ取る（いちばんよく使う）:
//     node scripts/navitime-route.mjs --event events/live-b.json --to-home
//   公演の設定ファイルの駅それぞれから会場まで（駅の数だけ呼ぶ。1駅だけなら --only 豊洲）:
//     node scripts/navitime-route.mjs --event events/live-b.json --stations
//   出発時刻を変えるなら --time 21:00（HH:MM）
//   呼ぶたびに、RapidAPI の今月の残り回数（返事のヘッダー）を表示する
//
// 注意：
//   - RapidAPI の無料プラン（Basic）は月500回まで。アプリ（/api/route）も同じ枠を使うので、むやみに繰り返さない
//   - RapidAPI 版の時刻は時刻表ではなく、乗り換えの待ちを平均で見込んだもの。所要時間の目安と運賃には使えるが、
//     発車時刻は使わない（2026-11 に、品川発ののぞみの時刻が実際のダイヤと合わないことを確かめた）

import { readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { setTimeout as sleep } from 'node:timers/promises';
import { departureTime, fetchTransit, homewardRoutes, NavitimeError } from '../src/lib/navitime.ts';

const { values: args } = parseArgs({
  options: {
    event: { type: 'string', default: 'events/live-b.json' },
    'to-home': { type: 'boolean', default: false },
    stations: { type: 'boolean', default: false },
    only: { type: 'string' },
    time: { type: 'string' },
  },
});

const event = JSON.parse(readFileSync(args.event, 'utf8'));
const venue = event.venue;
const day = event.date ?? event.checkin;

function loadKey() {
  try {
    process.loadEnvFile('.env');
  } catch {
    // .env がなければ環境変数だけを見る
  }
  return process.env.RAPIDAPI_KEY;
}

// 運賃の種類（レスポンスに名前が入っていないので、金額から推定した）
const FARE_UNITS = {
  unit_0: '乗車券（きっぷ）',
  unit_48: 'IC',
  unit_1: '特急券（自由席）',
  unit_2: '特急券（指定席）',
  unit_3: '特急券（グリーン）',
};
function fareLabel(fare) {
  if (!fare) return '運賃不明';
  return Object.entries(fare)
    .filter(([k]) => FARE_UNITS[k])
    .map(([k, v]) => `${FARE_UNITS[k]} ${Number(v).toLocaleString()}円`)
    .join(' / ');
}

const clock = (t) => (t ? t.slice(11, 16) : '?');

// 区間ごとの発着時刻（時刻は平均の待ち時間による見込み）
function printSections(body) {
  for (const [i, item] of (body.items ?? []).entries()) {
    const m = item.summary?.move ?? {};
    console.log(`\n  候補${i + 1}: ${clock(m.from_time)}→${clock(m.to_time)}（${m.time}分・乗換${m.transit_count ?? '?'}回）  ${fareLabel(m.fare)}`);
    let from = '';
    for (const s of item.sections ?? []) {
      if (s.type === 'point') {
        from = s.name === 'start' ? venue.name : (s.name ?? from);
        continue;
      }
      const name = s.move === 'walk' ? '徒歩' : (s.line_name ?? s.transport?.name ?? s.move);
      console.log(`    ${clock(s.from_time)} ${from || '?'} → ${clock(s.to_time)}  ${name}（${s.time ?? '?'}分）`);
    }
  }
}

async function call(key, from, to, startTime) {
  try {
    const { body, remaining } = await fetchTransit(key, from, to, startTime);
    console.log(`  RapidAPI の残り: ${remaining ?? '不明'}回`);
    return body;
  } catch (e) {
    if (!(e instanceof NavitimeError)) throw e;
    console.error(e.message);
    if (e.status === 401 || e.status === 403) {
      console.error('→ .env の RAPIDAPI_KEY が、NAVITIME Route(totalnavi) を Subscribe した App のキーかを確かめる（Endpoints の Code Snippets の x-rapidapi-key）');
    }
    return null;
  }
}

const key = loadKey();
if (!key) {
  console.error('.env に RAPIDAPI_KEY がありません（.env.example を参照）');
  process.exitCode = 1;
} else if (args['to-home']) {
  if (!event.origin) {
    console.error('設定ファイルに origin（出発地）がありません');
    process.exitCode = 1;
  } else {
    const startTime = args.time
      ? `${day}T${args.time}:00`
      : departureTime(day, venue.endEstimate ?? '21:00', event.homeward?.exitMinutes ?? 20);
    console.log(`${venue.name} → ${event.origin.name} を検索中…（出発 ${startTime}）`);
    const body = await call(key, venue, event.origin, startTime);
    if (body) {
      printSections(body);
      console.log('\n乗車駅までのまとめ:');
      for (const r of homewardRoutes(body, 3)) {
        console.log(`  ${r.boarding}まで 約${r.minutes}分（${r.lines.join('→') || '徒歩'}）→ ${r.train}  自由席 ${r.fare.nonReserved?.toLocaleString() ?? '?'}円・指定席 ${r.fare.reserved?.toLocaleString() ?? '?'}円`);
      }
      console.log('\n※ 時刻は時刻表ではなく平均の待ち時間による見込み。結果は保存しない（NAVITIME の規約）');
    } else {
      process.exitCode = 1;
    }
  }
} else if (args.stations) {
  const open = venue.open ?? '16:00';
  const [h, m] = open.split(':').map(Number);
  const startTime = args.time ? `${day}T${args.time}:00` : `${day}T${String(h - 1).padStart(2, '0')}:${String(m).padStart(2, '0')}:00`;
  const targets = (event.stations ?? []).filter((s) => !args.only || s.name === args.only);
  for (const [i, st] of targets.entries()) {
    if (i > 0) await sleep(1500); // 毎分50回の上限に当たらないよう間をあける
    console.log(`\n■ ${st.name} → ${venue.name}（出発 ${startTime}）`);
    const body = await call(key, st, venue, startTime);
    if (!body) {
      process.exitCode = 1;
      break;
    }
    for (const item of body.items ?? []) {
      const mv = item.summary?.move ?? {};
      const lines = (item.sections ?? []).filter((s) => s.type === 'move' && s.move !== 'walk').map((s) => s.line_name ?? s.move);
      console.log(`  ${mv.time}分  ${lines.join(' → ') || '徒歩のみ'}  ${fareLabel(mv.fare)}`);
    }
  }
  console.log('\n※ 結果は保存しない（NAVITIME の規約）。events/ の所要時間は、乗換検索で確かめた値を入れる');
} else {
  console.error('--to-home か --stations を付けてください（使い方はファイルの先頭）');
  process.exitCode = 1;
}
