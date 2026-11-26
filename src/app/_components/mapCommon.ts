// 地図（しおりの地図 ShioriMap と、寄り道の画面の地図 TripMap）で共通に使うもの。
// 地図の部品は Leaflet。下地は OpenFreeMap（ベクタの地図。MapLibre で描き、@maplibre/maplibre-gl-leaflet で Leaflet に載せる）を既定にする。
// キーはいらない。
//
// 見比べ用に、右上の切り替えボタンで下地を替えられる（選んだものは、その人のブラウザに覚える）。
// 候補：OpenFreeMap（Liberty・Positron・Bright）、地理院タイル（淡色地図）、CARTO Voyager、OpenStreetMap 標準。
// 決まったら、切り替えボタンと使わない候補は外す（CARTO は無料なのが非商用のみ、OSM 標準はアプリからの大量の利用が禁止のため、見比べ専用）。
//
// 規約:
//   - どの下地も、出典を地図の右下に出す（下の BASEMAPS の attribution）
//   - ホットペッパーの店を出すときは、クレジットも地図の上に出す。店の名前・位置は、画面で取った値を出すだけで保存しない
//   - Google Places で取ったものは、Google 以外の地図に載せられないので、これらの地図には渡さない

import type * as Leaflet from 'leaflet';
import 'maplibre-gl/dist/maplibre-gl.css';

export const HP_CREDIT = 'Powered by <a href="http://webservice.recruit.co.jp/" target="_blank" rel="noopener">ホットペッパーグルメ Webサービス</a>';

const OSM = '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors';
const OFM = `<a href="https://openfreemap.org" target="_blank" rel="noopener">OpenFreeMap</a> &copy; <a href="https://www.openmaptiles.org/" target="_blank" rel="noopener">OpenMapTiles</a> ${OSM}`;

interface Basemap {
  id: string;
  label: string;
  kind: 'vector' | 'raster';
  url: string; // vector はスタイルの URL、raster はタイルの URL
  attribution: string;
  maxZoom?: number;
}

export const BASEMAPS: Basemap[] = [
  { id: 'ofm-liberty', label: 'OpenFreeMap（Liberty）', kind: 'vector', url: 'https://tiles.openfreemap.org/styles/liberty', attribution: OFM },
  { id: 'ofm-positron', label: 'OpenFreeMap（Positron）', kind: 'vector', url: 'https://tiles.openfreemap.org/styles/positron', attribution: OFM },
  { id: 'ofm-bright', label: 'OpenFreeMap（Bright）', kind: 'vector', url: 'https://tiles.openfreemap.org/styles/bright', attribution: OFM },
  {
    id: 'gsi-pale',
    label: '地理院タイル（淡色地図）',
    kind: 'raster',
    url: 'https://cyberjapandata.gsi.go.jp/xyz/pale/{z}/{x}/{y}.png',
    attribution: '<a href="https://maps.gsi.go.jp/development/ichiran.html" target="_blank" rel="noopener">地理院タイル</a>',
    maxZoom: 18,
  },
  {
    id: 'carto-voyager',
    label: 'CARTO Voyager（見比べ用）',
    kind: 'raster',
    url: 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png',
    attribution: `${OSM} &copy; <a href="https://carto.com/attributions" target="_blank" rel="noopener">CARTO</a>`,
    maxZoom: 19,
  },
  {
    id: 'osm',
    label: 'OpenStreetMap 標準（見比べ用）',
    kind: 'raster',
    url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
    attribution: OSM,
    maxZoom: 19,
  },
];

export const DEFAULT_BASEMAP = 'ofm-liberty';
const STORE_KEY = 'ensei-basemap';

// 選んだ下地を、その人のブラウザに覚える（使えないブラウザでは、毎回既定に戻るだけ）
function savedBasemap(): string {
  try {
    const v = window.localStorage.getItem(STORE_KEY);
    return v && BASEMAPS.some((b) => b.id === v) ? v : DEFAULT_BASEMAP;
  } catch {
    return DEFAULT_BASEMAP;
  }
}
function saveBasemap(id: string) {
  try {
    window.localStorage.setItem(STORE_KEY, id);
  } catch {
    // 覚えられなくても地図は使える
  }
}

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

// 下地つきの地図を作る。右上に下地の切り替えボタンを出す
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

  const layers: Record<string, Leaflet.Layer> = {};
  const byLabel = new Map<string, string>();
  for (const b of BASEMAPS) {
    let layer: Leaflet.Layer;
    if (b.kind === 'vector') {
      layer = maplibreGL({ style: b.url });
      // MapLibre の層は出典を Leaflet に渡さないので、ここで渡す（右下に出る）
      layer.getAttribution = () => b.attribution;
    } else {
      layer = L.tileLayer(b.url, { maxZoom: b.maxZoom ?? 18, attribution: b.attribution });
    }
    layers[b.label] = layer;
    byLabel.set(b.label, b.id);
  }
  const first = BASEMAPS.find((b) => b.id === savedBasemap()) ?? BASEMAPS[0];
  layers[first.label].addTo(map);
  L.control.layers(layers, undefined, { position: 'topright', collapsed: true }).addTo(map);
  map.on('baselayerchange', (e: Leaflet.LayersControlEvent) => {
    const id = byLabel.get(e.name);
    if (id) saveBasemap(id);
  });
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
