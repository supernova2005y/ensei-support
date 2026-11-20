// 終演後に、帰りの最終便に間に合うかを判定する（API は呼ばない）。scripts/last-train.mjs を移したもの。
//
// 使うデータ:
//   - 最終便の表 data/last-trains.json（主な区間の最終便。人が公式の時刻表で確かめたものに verified: true を付ける）
//   - 公演の設定ファイルの venue.endEstimate（終演の目安）、homeward（帰り先・退場にかかる時間・乗車駅までの時間）
//     乗車駅までの時間は scripts/navitime-route.mjs --homeward --update で取る
//
// 判定: 終演 ＋ 退場の余裕 ＋ 会場から乗車駅まで（徒歩込み）＋ 駅の中の移動と乗り換えの余裕 ≦ 発車時刻 なら間に合う

import type { EventConfig } from './events.ts';

export const STATION_BUFFER_MINUTES = 10; // 新幹線の改札を通ってホームに上がるまでの余裕
const DEFAULT_EXIT_MINUTES = 20;

export interface LastTrainTable {
  note?: string;
  routes: {
    from: string;
    to: string;
    line: string;
    timetableValidUntil?: string;
    trains: {
      name: string;
      regular: boolean; // false は臨時列車（運転日を確かめてから使う）
      dayTypes?: string;
      departures: Record<string, string | null>;
      arrival: Record<string, string>;
      sources?: string[];
      checked?: string;
      verified: boolean; // 人が公式の時刻表で確かめたら true
      // 臨時列車で、人が日付を指定して確かめた結果（YYYY-MM-DD）。runsOn の日は定期の便と同じに扱い、notRunsOn の日は出さない
      runsOn?: string[];
      notRunsOn?: string[];
    }[];
  }[];
}

export interface TrainResult {
  train: string;
  line: string;
  station: string;
  dep: string;
  arrival: string; // 「名古屋23:49着」
  boardingMinutes: number;
  localDeparture?: { station: string; dep: string }; // 最寄り駅の最終の発車時刻で判定したとき
  latestEnd: string; // 終演がこの時刻までなら間に合う
  ok: boolean;
  regular: boolean;
  verified: boolean;
  dayTypes?: string;
}

export interface LastTrainJudgment {
  end: string; // 判定に使った終演時刻
  endIsEstimate: boolean;
  endNote?: string;
  to: string;
  exitMinutes: number;
  exitNote?: string;
  stationBufferMinutes: number;
  results: TrainResult[]; // 遅い順（終演の許容時刻が遅い順）
  unjudged: { train: string; station: string; dep: string }[]; // 会場→乗車駅の時間が未取得で判定できない便
  verdict: 'dayTrip' | 'extraOnly' | 'none';
  best?: TrainResult; // verdict が dayTrip のとき、間に合ういちばん遅い定期の便
  hasUnverified: boolean;
}

const toMin = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
};
const toClock = (min: number) =>
  `${String(Math.floor(min / 60) % 24).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;

// 帰りの情報（homeward）や終演の目安がない公演では null
export function judgeLastTrains(
  event: Pick<EventConfig, 'venue' | 'homeward' | 'checkin' | 'date'>,
  table: LastTrainTable,
  endOverride?: string,
): LastTrainJudgment | null {
  const homeward = event.homeward;
  const end = endOverride ?? event.venue.endEstimate;
  if (!homeward || !end) return null;
  const exitMinutes = homeward.exitMinutes ?? DEFAULT_EXIT_MINUTES;
  const day = event.date ?? event.checkin; // 公演日（臨時列車の運転日の照合に使う）
  const routes = table.routes.filter((r) => r.to === homeward.to);

  const results: TrainResult[] = [];
  const unjudged: LastTrainJudgment['unjudged'] = [];
  for (const route of routes) {
    for (const train of route.trains) {
      // 走らないと確かめた日の公演では、その便を出さない
      if (train.notRunsOn?.includes(day)) continue;
      const runsConfirmed = Boolean(train.runsOn?.includes(day));
      for (const [station, dep] of Object.entries(train.departures)) {
        if (!dep) continue;
        const boarding = homeward.boarding.find((b) => b.name === station);
        // この公演の乗車駅に入っていない駅（例：大阪の公演で東京発の便）は、判定の対象にしない
        if (!boarding) continue;
        if (boarding.minutes == null) {
          unjudged.push({ train: train.name, station, dep });
          continue;
        }
        // 終演がこの時刻までなら間に合う。最寄り駅の最終の発車時刻を確かめてあれば、そこから退場の時間を引く
        // （本数が少ない路線では「新幹線の発車 − 移動の分数」より早い電車に乗る必要があるため）
        const localDep = boarding.lastLocal?.trains[train.name];
        const latestEnd = localDep
          ? toMin(localDep) - exitMinutes
          : toMin(dep) - STATION_BUFFER_MINUTES - boarding.minutes - exitMinutes;
        results.push({
          train: train.name,
          line: route.line,
          station,
          dep,
          arrival: Object.entries(train.arrival)
            .map(([st, t]) => `${st}${t}着`)
            .join('・'),
          boardingMinutes: boarding.minutes,
          localDeparture: localDep ? { station: boarding.lastLocal!.station, dep: localDep } : undefined,
          latestEnd: toClock(latestEnd),
          ok: toMin(end) <= latestEnd,
          regular: train.regular || runsConfirmed,
          verified: train.verified,
          dayTypes: runsConfirmed ? `臨時列車。この日（${day}）の運転は確認済み` : train.dayTypes,
        });
      }
    }
  }

  results.sort((a, b) => toMin(b.latestEnd) - toMin(a.latestEnd));
  const reachable = results.filter((r) => r.ok && r.regular);
  const verdict: LastTrainJudgment['verdict'] = reachable.length
    ? 'dayTrip'
    : results.some((r) => r.ok)
      ? 'extraOnly' // 間に合うのは臨時列車だけ。運転日を確かめるまでは、後泊か夜行バスも候補に出す
      : 'none'; // 終演後の新幹線には間に合わない見込み。後泊か夜行バスを提案する

  return {
    end,
    endIsEstimate: endOverride === undefined,
    endNote: endOverride === undefined ? event.venue.endNote : undefined,
    to: homeward.to,
    exitMinutes,
    exitNote: homeward.exitNote,
    stationBufferMinutes: STATION_BUFFER_MINUTES,
    results,
    unjudged,
    verdict,
    best: reachable[0],
    hasUnverified: results.some((r) => !r.verified),
  };
}
