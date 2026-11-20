// 「自分の公演で調べる」：会場（events/*.json にある会場から選ぶ）・日付・開演時刻から、公演の設定を作る。
// 会場の座標・行きやすい駅・帰りの乗車駅は、選んだ会場の設定ファイルのものをそのまま使い、日付と時刻だけ差し替える。
// 会場を自由入力にしないのは、名前から座標を出すのに有料の API（Google Places など）が要るため。

import { listEventIds, loadEvent, type EventConfig } from './events.ts';

export interface VenueOption {
  id: string; // 元にする公演の設定ファイルの id（events/<id>.json）
  name: string;
}

const DEFAULT_OPEN_BEFORE_MIN = 60; // 開場は開演の何分前か（元の設定にないとき）
const DEFAULT_LENGTH_MIN = 150; // 開演から終演まで（元の設定にないとき）
const MAX_DAYS_AHEAD = 365;

// 同じ会場が複数の公演にあっても、候補には1つだけ出す
export function listVenueOptions(): VenueOption[] {
  const seen = new Set<string>();
  const options: VenueOption[] = [];
  for (const id of listEventIds()) {
    const event = loadEvent(id);
    if (!event || seen.has(event.venue.name)) continue;
    seen.add(event.venue.name);
    options.push({ id, name: event.venue.name });
  }
  return options;
}

const toMin = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
};
const toClock = (min: number) =>
  `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;

// 日本時間の今日（YYYY-MM-DD）
export function todayJst(now: number = Date.now()): string {
  return new Date(now + 9 * 3600_000).toISOString().slice(0, 10);
}

function addDays(ymd: string, days: number): string {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

// 入力の形と範囲を確かめる。問題があれば画面に出す文を返す（なければ null）
export function checkDate(date: string, now: number = Date.now()): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || addDays(date, 0) !== date) return '日付を選んでください。';
  const today = todayJst(now);
  if (date < today) return '過ぎた日付では空室を探せません。今日以降の日付を選んでください。';
  if (date > addDays(today, MAX_DAYS_AHEAD)) return '1年より先の日付では探せません。';
  return null;
}

export function checkStart(start: string): string | null {
  if (!/^\d{2}:\d{2}$/.test(start)) return '開演時刻を選んでください。';
  const min = toMin(start);
  if (min < 9 * 60 || min > 21 * 60) return '開演時刻は 9:00〜21:00 の間で選んでください。';
  return null;
}

// 元の公演の設定から、日付と時刻だけを差し替えた設定を作る。泊まりは公演の夜の1泊
export function buildCustomEvent(base: EventConfig, input: { date: string; start: string }): EventConfig {
  const baseStart = base.venue.start ? toMin(base.venue.start) : undefined;
  const openBefore =
    baseStart !== undefined && base.venue.open ? baseStart - toMin(base.venue.open) : DEFAULT_OPEN_BEFORE_MIN;
  const length =
    baseStart !== undefined && base.venue.endEstimate ? toMin(base.venue.endEstimate) - baseStart : DEFAULT_LENGTH_MIN;
  const start = toMin(input.start);

  return {
    ...base,
    name: 'あなたの公演',
    artist: 'あなたの公演',
    tourName: undefined,
    date: input.date,
    checkin: input.date,
    checkout: addDays(input.date, 1),
    venue: {
      ...base.venue,
      open: toClock(start - openBefore),
      start: input.start,
      endEstimate: toClock(start + length),
      endNote: `終演時刻は目安（開演${input.start}＋約${Math.round(length / 30) / 2}時間）。公式の発表で直してください`,
    },
  };
}
