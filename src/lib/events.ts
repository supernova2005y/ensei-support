// 公演ごとの設定ファイル（リポジトリ直下の events/*.json）を読む。サーバー側でだけ使う。
// ファイル名（拡張子なし）を公演の id として URL に使う（例: events/live-b.json → /events/live-b）。

import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

export interface LatLng {
  lat: number;
  lng: number;
}

// 会場へ行きやすい駅（この駅の周りの宿も探す）
export interface Station extends LatLng {
  name: string;
  minutes: number; // 駅から会場まで（徒歩込み）の分
  line: string;
}

export interface Boarding extends Partial<LatLng> {
  name: string;
  minutes?: number | null; // 会場から乗車駅まで（徒歩込み）の分。未取得なら null
  minutesNote?: string;
}

export interface EventConfig {
  name: string;
  artist?: string; // アーティスト名（見出しに使う。なければ name）
  tourName?: string; // 公演（ツアー）名。わかっていれば見出しに添える
  date?: string; // 公演日（YYYY-MM-DD）。なければ checkin を公演日とみなす
  venue: LatLng & {
    name: string;
    note?: string;
    open?: string;
    start?: string;
    endEstimate?: string;
    endNote?: string;
  };
  checkin: string;
  checkout: string;
  stationsNote?: string;
  stations?: Station[];
  origin?: LatLng & { name: string };
  homeward?: {
    to: string;
    exitMinutes?: number;
    exitNote?: string;
    boarding: Boarding[];
  };
}

const EVENTS_DIR = path.join(process.cwd(), 'events');
const ID_PATTERN = /^[a-z0-9][a-z0-9-]*$/;

export function isValidEventId(id: string): boolean {
  return ID_PATTERN.test(id);
}

export function listEventIds(): string[] {
  return readdirSync(EVENTS_DIR)
    .filter((f) => f.endsWith('.json'))
    .map((f) => f.slice(0, -'.json'.length))
    .filter(isValidEventId)
    .sort();
}

// 見つからなければ null（id は URL から来るので、ファイル名として安全な形かを先に確かめる）
export function loadEvent(id: string): EventConfig | null {
  if (!isValidEventId(id) || !listEventIds().includes(id)) return null;
  return JSON.parse(readFileSync(path.join(EVENTS_DIR, `${id}.json`), 'utf8')) as EventConfig;
}

export function eventDate(event: EventConfig): string {
  return event.date ?? event.checkin;
}

// 2026-12-13 → 2026年12月13日（日）
export function formatDateJa(ymd: string): string {
  const [y, m, d] = ymd.split('-').map(Number);
  const week = '日月火水木金土'[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
  return `${y}年${m}月${d}日（${week}）`;
}
