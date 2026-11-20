// 終演後に、帰りの最終便に間に合うかを判定するスクリプト（API は呼ばない）。
//
// 使い方:
//   node scripts/last-train.mjs --event events/live-b.json
//   終演時刻を変えて試すなら: --end 20:00
//
// 使うデータ:
//   - 最終便の表 data/last-trains.json（主な区間の最終便。人が公式の時刻表で確かめたものに verified: true を付ける）
//   - 公演の設定ファイルの venue.endEstimate（終演の目安）、homeward（帰り先・退場にかかる時間・乗車駅までの時間）
//     乗車駅までの時間は scripts/navitime-route.mjs --homeward --update で取る
//
// 判定: 終演 ＋ 退場の余裕 ＋ 会場から乗車駅まで（徒歩込み）＋ 駅の中の移動と乗り換えの余裕 ≦ 発車時刻 なら間に合う

import { readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';

const STATION_BUFFER_MINUTES = 10; // 新幹線の改札を通ってホームに上がるまでの余裕

const { values: args } = parseArgs({
  options: {
    event: { type: 'string', default: 'events/live-b.json' },
    table: { type: 'string', default: 'data/last-trains.json' },
    end: { type: 'string' },
  },
});

const event = JSON.parse(readFileSync(args.event, 'utf8'));
const table = JSON.parse(readFileSync(args.table, 'utf8'));
const homeward = event.homeward;
if (!homeward) {
  console.error('設定ファイルに homeward（帰り先・乗車駅）がありません');
  process.exit(1);
}

const toMin = (hhmm) => {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
};
const toClock = (min) => `${String(Math.floor(min / 60) % 24).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;

const end = args.end ?? event.venue.endEstimate;
const exitMinutes = homeward.exitMinutes ?? 20;
const routes = table.routes.filter((r) => r.to === homeward.to);
const day = event.date ?? event.checkin; // 臨時列車の運転日（runsOn / notRunsOn）の照合に使う

console.log(`${event.name}：終演 ${end}（${args.end ? '指定' : '目安'}）→ ${homeward.to}へ帰る`);
console.log(`前提: 退場に${exitMinutes}分、駅の中の移動に${STATION_BUFFER_MINUTES}分\n`);

const results = [];
for (const route of routes) {
  for (const rawTrain of route.trains) {
    // 走らないと確かめた日は出さない。運転を確かめた日は定期の便と同じに扱う（src/lib/lastTrain.ts と同じ）
    if (rawTrain.notRunsOn?.includes(day)) continue;
    const train = rawTrain.runsOn?.includes(day) ? { ...rawTrain, regular: true } : rawTrain;
    for (const [station, dep] of Object.entries(train.departures)) {
      if (!dep) continue;
      const boarding = homeward.boarding.find((b) => b.name === station);
      // この公演の乗車駅に入っていない駅（例：東京の公演で新大阪発の便）は、判定の対象にしない
      if (!boarding) continue;
      if (boarding.minutes == null) {
        console.log(`  （${train.name} ${station}${dep}発: 会場から${station}駅までの時間が未取得のため判定できない）`);
        continue;
      }
      // 終演がこの時刻までなら間に合う
      const latestEnd = toMin(dep) - STATION_BUFFER_MINUTES - boarding.minutes - exitMinutes;
      results.push({ train, station, dep, boarding, latestEnd, ok: toMin(end) <= latestEnd });
    }
  }
}

results.sort((a, b) => b.latestEnd - a.latestEnd);
for (const r of results) {
  const tags = [r.train.regular ? '' : '臨時・運転日要確認', r.train.verified ? '' : '時刻未確認'].filter(Boolean);
  const arrival = Object.entries(r.train.arrival).map(([st, t]) => `${st}${t}着`).join('・');
  console.log(
    `${r.ok ? '○' : '×'} ${r.train.name}  ${r.station}${r.dep}発 → ${arrival}` +
      `  … 終演が${toClock(r.latestEnd)}までなら間に合う（会場→${r.station} 約${r.boarding.minutes}分）` +
      (tags.length ? `  [${tags.join('・')}]` : ''),
  );
}

const reachable = results.filter((r) => r.ok && r.train.regular);
console.log('');
if (reachable.length) {
  console.log(`→ 日帰りできる見込み。いちばん遅い便は ${reachable[0].train.name}（${reachable[0].station}${reachable[0].dep}発）`);
} else if (results.some((r) => r.ok)) {
  console.log('→ 間に合うのは臨時列車だけ。運転日を確かめるまでは、後泊か夜行バスも候補に出す');
} else {
  console.log('→ 終演後の新幹線には間に合わない見込み。後泊か夜行バスを提案する');
}
if (results.some((r) => !r.train.verified)) {
  console.log('※ 時刻未確認の便があります。公式の時刻表で確かめたら data/last-trains.json の verified を true にしてください');
}
