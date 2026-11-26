// 寄り道の画面に使う、公演ごとの土台を作る。サーバー側でだけ使う。
// 公演の設定（events/<id>.json）から、駅と会場を読む。ご飯・交通の種類・泊まり方・ジャンルは、どの公演でも同じ共通の設定。
// data/<id>.json があれば、その中身（手で入れた候補など）を使う。ファイルがなくても、寄り道の画面は出る（その都度の検索で店を出す）。

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { eventDate, loadEvent, type EventConfig } from './events.ts';
import type { Price, Spot } from './itinerary.ts';

export interface TransportMode {
  id: string;
  title: string;
  duration: string;
  arrive: string; // 会場の最寄りへ着く目安の時刻（HH:MM）
  price: Price;
  note: string;
}

export interface FoodGrade {
  id: string;
  title: string;
  note: string;
  price_per_day: Price;
}

export interface Station {
  id: string;
  name: string;
  lat: number;
  lng: number;
}

// 画面の「駅の周り」のまとまり。stationId は、お店を探す駅（stations の id）
export interface Hub {
  id: string;
  title: string;
  link: string;
  why: string;
  stationId: string;
}

export interface ItineraryData {
  event: {
    artist?: string;
    date: string;
    venue: { name: string; lat: number; lng: number };
    doors: string;
    start: string;
    end_estimate: string;
    notes: string[];
  };
  patterns: { id: 'after' | 'before' | 'day'; title: string; note: string }[];
  transport_modes: TransportMode[];
  local_transit: Price;
  food_grades: FoodGrade[];
  genres: string[];
  stations: Station[];
  hubs: Hub[];
  spots: Spot[];
}

// どの公演でも同じ共通の設定（交通の種類は、便の名前と目安の時間・料金だけ）
const PATTERNS: ItineraryData['patterns'] = [
  { id: 'after', title: '後泊（公演日泊）', note: '公演日の夜から泊まる。翌日にもう1日遊んで帰れる' },
  { id: 'before', title: '前泊（前日泊）', note: '前日の夜から泊まる。公演日は会場へ行って帰る' },
  { id: 'day', title: '日帰り', note: '朝に出て、終演後に帰る。宿代なし' },
];

// 運賃は行き先ごと（名古屋発）。東京行きと新大阪行きで、使える便と値段が違う
// 所要時間と運賃は、人が確かめた値（2026-11-26）。到着の目安の時刻は、割り振りの計算に使うだけで、画面には出さない
const TRANSPORT_TOKYO: TransportMode[] = [
  { id: 'nozomi', title: 'のぞみ', duration: '約1時間40分', arrive: '10:40', price: { yen: 10560, min: 10560, max: 11340, estimated: false }, note: '自由席10,560円・指定席11,340円' },
  { id: 'kodama', title: 'こだま', duration: '約2時間40分', arrive: '12:00', price: { yen: 10560, min: 10560, max: 11090, estimated: false }, note: '自由席10,560円・指定席11,090円' },
  { id: 'platto_kodama', title: 'ぷらっとこだま（土休日）', duration: '約2時間40分', arrive: '12:00', price: { yen: 9000, min: 9000, max: 9000, estimated: false }, note: 'ドリンク券つき。便の変更不可' },
  { id: 'bus_day', title: '昼行の高速バス', duration: '約5〜6時間半', arrive: '13:00', price: { yen: 4000, min: 3000, max: 5000, estimated: false }, note: '朝に出て昼すぎに着く' },
  { id: 'bus_night', title: '夜行バス', duration: '約6〜7時間', arrive: '06:30', price: { yen: 6500, min: 5000, max: 8000, estimated: false }, note: '朝から動ける。移動は寝ている間' },
];
const TRANSPORT_OSAKA: TransportMode[] = [
  { id: 'nozomi', title: 'のぞみ', duration: '約50分', arrive: '10:40', price: { yen: 5940, min: 5940, max: 6680, estimated: false }, note: '自由席5,940円・指定席6,680円' },
  { id: 'kodama', title: 'こだま', duration: '約1時間8分', arrive: '10:40', price: { yen: 5940, min: 5940, max: 6470, estimated: false }, note: '自由席5,940円・指定席6,470円' },
  { id: 'platto_kodama', title: 'ぷらっとこだま（土休日）', duration: '約1時間8分', arrive: '10:40', price: { yen: 5340, min: 5340, max: 5340, estimated: false }, note: 'ドリンク券つき。便の変更不可' },
  { id: 'hinotori', title: '近鉄特急ひのとり', duration: '約2時間30分', arrive: '12:00', price: { yen: 5280, min: 5280, max: 5280, estimated: false }, note: '名古屋から近鉄で。大阪難波方面' },
  { id: 'bus_osaka', title: '高速バス（梅田まで）', duration: '約3〜3時間半', arrive: '12:00', price: { yen: 2700, min: 2700, max: 3000, estimated: true }, note: '梅田まで。だいたい3,000円くらい' },
];

// 公演の行き先から、使える交通の表を選ぶ（行き先が決まっていなければ東京）
function transportFor(event: EventConfig): TransportMode[] {
  return event.destination === '新大阪' ? TRANSPORT_OSAKA : TRANSPORT_TOKYO;
}

const LOCAL_TRANSIT: Price = { yen: 1100, min: 1000, max: 1500, estimated: true };

const FOOD_GRADES: FoodGrade[] = [
  { id: 'f1', title: '節約', note: 'チェーン店やコンビニ中心', price_per_day: { yen: 2000, min: 1500, max: 2500, estimated: false } },
  { id: 'f2', title: 'ふつう', note: 'カフェ1回くらい', price_per_day: { yen: 3500, min: 2500, max: 4500, estimated: false } },
  { id: 'f3', title: 'ちょっといい', note: '終演後にちゃんと食べる', price_per_day: { yen: 6000, min: 4500, max: 8000, estimated: false } },
];

const GENRES = ['アート', 'マーケット', 'パン屋', '洋菓子', 'カフェ'];

// 公演の設定の駅から、画面の「駅の周り」を作る（駅の id は s0・s1…）
function fromEvent(event: EventConfig): ItineraryData {
  const stations: Station[] = (event.stations ?? []).map((st, i) => ({ id: `s${i}`, name: st.name, lat: st.lat, lng: st.lng }));
  const hubs: Hub[] = (event.stations ?? []).map((st, i) => ({
    id: `s${i}`,
    title: `${st.name}の周り`,
    link: '',
    why: st.minutes != null ? `会場へは${st.minutes}分ほど（${st.line ?? '電車'}）` : '会場までの時間は未確認',
    stationId: `s${i}`,
  }));
  return {
    event: {
      artist: event.artist ?? event.name,
      date: eventDate(event),
      venue: { name: event.venue.name, lat: event.venue.lat, lng: event.venue.lng },
      doors: event.venue.open ?? '',
      start: event.venue.start ?? '',
      end_estimate: event.venue.endEstimate ?? '',
      notes: [],
    },
    patterns: PATTERNS,
    transport_modes: transportFor(event),
    local_transit: LOCAL_TRANSIT,
    food_grades: FOOD_GRADES,
    genres: GENRES,
    stations,
    hubs,
    spots: [],
  };
}

// 試作から書き出した data/<id>.json（手で入れた候補）がある公演は、その中身を使う。
// 古い形のファイルには hubs がないので、東京・有明・清澄白河の3つを使う。
const LEGACY_HUBS: Hub[] = [
  { id: 'tokyo', title: '東京駅・丸の内', link: '行きの到着・帰りの出発地', why: '到着してすぐ寄れる。終演後は時間がないので、行きに寄るのがおすすめ', stationId: 'tokyo' },
  { id: 'ariake', title: '有明・豊洲', link: '会場の近く', why: 'ゆりかもめ・りんかい線で会場まで数駅。開場前の時間つぶしにも', stationId: 'ariake' },
  { id: 'far', title: '清澄白河', link: '', why: '東京駅や豊洲から20分ほど。時間に余裕があるとき', stationId: 'kiyosumi' },
];

// 公演の id から、寄り道の画面の土台を作る。events/<id>.json がなければ null
export function loadItineraryData(eventId: string): ItineraryData | null {
  if (!/^[a-z0-9][a-z0-9-]*$/.test(eventId)) return null;
  const event = loadEvent(eventId);
  if (!event) return null;
  const file = path.join(process.cwd(), 'data', `${eventId}.json`);
  if (!existsSync(file)) return fromEvent(event);
  const saved = JSON.parse(readFileSync(file, 'utf8')) as Partial<ItineraryData>;
  const base = fromEvent(event);
  return {
    ...base,
    ...saved,
    event: saved.event ?? base.event,
    transport_modes: transportFor(event), // 運賃は、公演の行き先で決める（保存されている値は使わない）
    stations: saved.stations ?? base.stations,
    hubs: saved.hubs ?? LEGACY_HUBS,
    spots: saved.spots ?? [],
  } as ItineraryData;
}
