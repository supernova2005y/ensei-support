// 寄り道の候補の一覧（data/<公演の id>.json）を読む。サーバー側でだけ使う。
// 中身は、自分で決めた候補だけ（店名・公演名は実名。宿と交通の具体的な便は入れない）。

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
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
  spots: Spot[];
}

// 公演の id に対応するファイルがなければ null（候補がない公演では、しおりを出さない）
export function loadItineraryData(eventId: string): ItineraryData | null {
  if (!/^[a-z0-9][a-z0-9-]*$/.test(eventId)) return null;
  const file = path.join(process.cwd(), 'data', `${eventId}.json`);
  if (!existsSync(file)) return null;
  return JSON.parse(readFileSync(file, 'utf8')) as ItineraryData;
}
