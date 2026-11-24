// 寄り道の割り振りと総額を計算する（API は呼ばない・ファイルも読まない純粋な関数だけを置く）。
// 試作（write/projects/遠征サポート/prototype/plan-flow-5sos-1122.html）の割り振りのルールを、テストできる形にしたもの。
//
// ルール（試作から）:
//   - 泊まり方は3つ：後泊（公演日の前日・公演日・翌日に分ける）、前泊（前日に寄り道、公演日は会場へ）、日帰り（公演日に全部）
//   - 寄り道候補は「美術館・アート → マーケット → パン屋・洋菓子・カフェ」の順に並べる（買い物は最後）
//   - 到着から開場までの空き時間に入る数（cap）まで詰め、あふれた分は別の日へ回す
//   - 日帰りで候補が多すぎるときは警告を出す（目安は3か所まで）
//
// 変えた点（試作との違い）:
//   - cap は、到着時刻の直書きをやめ、空き時間（開場までの時間）から決める（capFor）
//   - 交通・宿の値段は、このファイルに持たず、呼ぶ側（画面）から渡す（保存しない方針のため）

export type Pattern = 'after' | 'before' | 'day';

export interface Price {
  yen: number;
  min: number;
  max: number;
  estimated: boolean;
}

export interface Spot {
  id: string;
  title: string;
  genres: string[];
  hub: string; // どの駅の周りか（tokyo・ariake・far など）
  lat: number;
  lng: number;
  price: Price;
  hours: string; // 営業時間（自由な文章。「要確認」のときは確かめていない）
  availability: string; // 開催期間や営業の状態
  note: string;
  needs_check: boolean;
}

export interface DayPlan {
  label: string; // 「前日」「公演日」「翌日」
  items: Spot[];
}

export interface Schedule {
  days: DayPlan[];
  warnings: string[];
}

export interface ScheduleInput {
  pattern: Pattern;
  picks: Spot[];
  arrival: string; // 会場へ着く（または前日に東京に着く）時刻 HH:MM
  doors: string; // 開場 HH:MM
}

// 開場までの空き時間（時間）から、1日に入れる寄り道の数を決める。
// 試作の値（06:30着→4、10:40着→3、12:30着→2、14:00着→2）と同じになるように、しきい値で分けている
export function capFor(freeHours: number): number {
  if (freeHours >= 8) return 4;
  if (freeHours >= 4.5) return 3;
  return 2;
}

export function toHours(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return h + m / 60;
}

// 並べ順：美術館・アート → マーケット → パン屋・洋菓子・カフェ
export function kindRank(spot: Spot): number {
  if (spot.genres.includes('アート')) return 0;
  if (spot.genres.includes('マーケット')) return 1;
  return 2;
}

const isShop = (spot: Spot) => kindRank(spot) === 2;

export function orderSpots(spots: Spot[]): Spot[] {
  // Array.prototype.sort は安定しているので、同じ種類の中では元の順番を保つ
  return [...spots].sort((a, b) => kindRank(a) - kindRank(b));
}

const byHub = (spots: Spot[], hubs: string[]) => spots.filter((s) => hubs.includes(s.hub));

export function schedule(input: ScheduleInput): Schedule {
  const { pattern, picks, arrival, doors } = input;
  const freeHours = toHours(doors) - toHours(arrival);
  const cap = capFor(freeHours);
  const warnings: string[] = [];
  let days: DayPlan[];

  if (pattern === 'day') {
    // 日帰りは全部を公演日に入れ、多すぎるときは下の警告で知らせる（試作と同じ）
    days = [{ label: '公演日', items: orderSpots(byHub(picks, ['far', 'tokyo', 'ariake'])) }];
  } else if (pattern === 'before') {
    // 前日に、東京駅と清澄白河の候補を cap まで。残りと有明の候補は公演日へ
    const first = orderSpots(byHub(picks, ['far', 'tokyo']));
    days = [
      { label: '前日', items: first.slice(0, cap) },
      { label: '公演日', items: orderSpots([...first.slice(cap), ...byHub(picks, ['ariake'])]) },
    ];
  } else {
    // 後泊：公演日は、東京駅の美術館・マーケットと有明の候補を cap まで。あふれた分と買い物は翌日へ
    const dayOne = [...orderSpots(byHub(picks, ['tokyo']).filter((s) => !isShop(s))), ...orderSpots(byHub(picks, ['ariake']))];
    const shops = byHub(picks, ['tokyo']).filter(isShop);
    days = [
      { label: '公演日', items: dayOne.slice(0, cap) },
      { label: '翌日', items: [...orderSpots(byHub(picks, ['far'])), ...dayOne.slice(cap), ...shops] },
    ];
  }

  for (const day of days) {
    if (day.items.length > 3) {
      warnings.push(`${day.label}に${day.items.length}か所は多めです。数を絞るか、別の日に回しましょう（目安は3か所まで）`);
    }
  }
  return { days, warnings };
}

export interface CostInput {
  picks: Spot[];
  transportGo: Price; // 行きの運賃（画面で選んだ便の値段）
  transportBack: Price; // 帰りの運賃
  local?: Price; // 現地の電車代（任意。目安と幅）
  stay?: Price; // 宿（楽天の空室から、表示のたびに取った値。保存しない）
  foodPerDay: Price;
  days: number;
  ticketYen: number;
  goodsYen: number;
}

export interface CostPart {
  label: string;
  yen: number;
  lo: number;
  hi: number;
}

export interface Cost {
  parts: CostPart[];
  total: number;
  lo: number;
  hi: number;
}

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

export function cost(input: CostInput): Cost {
  const local = input.local ?? { yen: 0, min: 0, max: 0, estimated: false };
  const stay = input.stay ?? { yen: 0, min: 0, max: 0, estimated: false };
  const parts: CostPart[] = [
    {
      label: '交通（往復）',
      yen: input.transportGo.yen + input.transportBack.yen,
      lo: input.transportGo.min + input.transportBack.min,
      hi: input.transportGo.max + input.transportBack.max,
    },
    { label: '現地の電車', yen: local.yen, lo: local.min, hi: local.max },
    { label: '宿', yen: stay.yen, lo: stay.min, hi: stay.max },
    {
      label: `食事（${input.days}日分）`,
      yen: input.foodPerDay.yen * input.days,
      lo: input.foodPerDay.min * input.days,
      hi: input.foodPerDay.max * input.days,
    },
    {
      label: '立ち寄り',
      yen: sum(input.picks.map((s) => s.price.yen)),
      lo: sum(input.picks.map((s) => s.price.min)),
      hi: sum(input.picks.map((s) => s.price.max)),
    },
    { label: 'グッズ', yen: input.goodsYen, lo: input.goodsYen, hi: input.goodsYen },
    { label: 'チケット', yen: input.ticketYen, lo: input.ticketYen, hi: input.ticketYen },
  ];
  return {
    parts,
    total: sum(parts.map((p) => p.yen)),
    lo: sum(parts.map((p) => p.lo)),
    hi: sum(parts.map((p) => p.hi)),
  };
}
