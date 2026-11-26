// 地図（しおりの地図 ShioriMap と、寄り道の画面の地図 TripMap）で共通に使うもの。
// 地図の部品は Leaflet。下地は OpenFreeMap の Liberty（ベクタの地図。MapLibre で描き、@maplibre/maplibre-gl-leaflet で Leaflet に載せる）。
// キーはいらない。下地は、地理院・CARTO・OSM 標準・OpenFreeMap のほかのスタイルと見比べて、Liberty に決めた（2026-11-26）。
//
// 規約:
//   - 出典（OpenFreeMap・OpenMapTiles・OpenStreetMap）を地図の右下に出す
//   - ホットペッパーの店を出すときは、クレジットも地図の上に出す。店の名前・位置は、画面で取った値を出すだけで保存しない
//   - Google Places で取ったものは、Google 以外の地図に載せられないので、これらの地図には渡さない

import type * as Leaflet from 'leaflet';
import 'maplibre-gl/dist/maplibre-gl.css';

export const HP_CREDIT = 'Powered by <a href="http://webservice.recruit.co.jp/" target="_blank" rel="noopener">ホットペッパーグルメ Webサービス</a>';

const LIBERTY_STYLE = 'https://tiles.openfreemap.org/styles/liberty';
const OSM = '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors';
const OFM_CREDIT = `<a href="https://openfreemap.org" target="_blank" rel="noopener">OpenFreeMap</a> &copy; <a href="https://www.openmaptiles.org/" target="_blank" rel="noopener">OpenMapTiles</a> ${OSM}`;

export interface MapPin {
  id: string;
  name: string;
  lat: number;
  lng: number;
}

export const ok = (p: { lat: number; lng: number }) => Number.isFinite(p.lat) && Number.isFinite(p.lng);

// 地図の中の文字は HTML として入るので、名前はエスケープする
export const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

// Leaflet と MapLibre はブラウザでしか動かない（window を使う）ので、画面に出たあと useEffect の中で読み込む
export async function loadLeaflet() {
  const [L, gl, maplibre] = await Promise.all([import('leaflet'), import('@maplibre/maplibre-gl-leaflet'), import('maplibre-gl')]);
  // 裏の処理（ワーカー）のファイルは、ビルドの前に public/maplibre/ へ写してある（scripts/copy-maplibre-worker.mjs）
  maplibre.setWorkerUrl('/maplibre/maplibre-gl-worker.mjs');
  return { L: L.default ?? L, maplibreGL: gl.maplibreGL };
}

type Loaded = Awaited<ReturnType<typeof loadLeaflet>>;

// OpenFreeMap（Liberty）を下地にした地図を作る
export function createBaseMap({ L, maplibreGL }: Loaded, el: HTMLElement): Leaflet.Map {
  // MapLibre の推奨：緯度の端で Leaflet とずれないように、動かせる範囲とズームの下限を決める
  const map = L.map(el, {
    scrollWheelZoom: false,
    minZoom: 4,
    maxBounds: [
      [85, -Infinity],
      [-85, Infinity],
    ],
    maxBoundsViscosity: 1,
  });
  map.attributionControl.setPrefix(false);

  const base = maplibreGL({ style: LIBERTY_STYLE });
  // MapLibre の層は出典を Leaflet に渡さないので、ここで渡す（右下に出る）
  base.getAttribution = () => OFM_CREDIT;
  base.addTo(map);
  return map;
}

export interface PinOptions {
  permanent?: boolean; // 名前を常に出す（駅・会場）。ほかは指を乗せたとき・タップしたときに出す
  side?: 'left' | 'right'; // 常に出す名前の向き
  z?: number; // 重なったときの前後（大きいほど手前）
}

// ピンを1つ足す関数を返す。足したピンの位置は bounds に入る（全体が入るように映すため）
export function pinAdder(L: Loaded['L'], layer: Leaflet.Map | Leaflet.LayerGroup, bounds: [number, number][]) {
  return (p: { lat: number; lng: number }, cls: string, label: string, text = '', opts: PinOptions = {}) => {
    if (!ok(p)) return;
    const side = opts.side ?? 'right';
    const icon = L.divIcon({ className: '', html: `<span class="shiori-pin ${cls}">${esc(text)}</span>`, iconSize: [26, 26], iconAnchor: [13, 13] });
    L.marker([p.lat, p.lng], { icon, title: label, zIndexOffset: opts.z ?? 0 })
      .bindTooltip(
        esc(label),
        opts.permanent ? { permanent: true, direction: side, offset: [side === 'right' ? 12 : -12, 0], className: 'shiori-label' } : {},
      )
      .addTo(layer);
    bounds.push([p.lat, p.lng]);
  };
}
