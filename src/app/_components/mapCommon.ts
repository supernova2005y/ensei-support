// 地図（しおりの地図 ShioriMap と、寄り道の画面の地図 TripMap）で共通に使うもの。
// 下地は地理院タイル（国土地理院の淡色地図）、地図の部品は Leaflet。キーはいらない。
//
// 規約:
//   - 地理院タイルは出典（「地理院タイル」へのリンク）を地図の上に出す
//   - ホットペッパーの店を出すときは、クレジットも地図の上に出す。店の名前・位置は、画面で取った値を出すだけで保存しない
//   - Google Places で取ったものは、Google 以外の地図に載せられないので、これらの地図には渡さない

import type * as Leaflet from 'leaflet';

export const GSI_PALE = 'https://cyberjapandata.gsi.go.jp/xyz/pale/{z}/{x}/{y}.png';
export const GSI_CREDIT = '<a href="https://maps.gsi.go.jp/development/ichiran.html" target="_blank" rel="noopener">地理院タイル</a>';
export const HP_CREDIT = 'Powered by <a href="http://webservice.recruit.co.jp/" target="_blank" rel="noopener">ホットペッパーグルメ Webサービス</a>';

export interface MapPin {
  id: string;
  name: string;
  lat: number;
  lng: number;
}

export const ok = (p: { lat: number; lng: number }) => Number.isFinite(p.lat) && Number.isFinite(p.lng);

// 地図の中の文字は HTML として入るので、名前はエスケープする
export const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

// Leaflet はブラウザでしか動かない（window を使う）ので、画面に出たあと useEffect の中で読み込む
export const loadLeaflet = async () => (await import('leaflet')).default;

// 淡色地図を下地にした地図を作る
export function createBaseMap(L: typeof Leaflet, el: HTMLElement): Leaflet.Map {
  const map = L.map(el, { scrollWheelZoom: false });
  L.tileLayer(GSI_PALE, { minZoom: 5, maxZoom: 18, attribution: GSI_CREDIT }).addTo(map);
  map.attributionControl.setPrefix(false);
  return map;
}

export interface PinOptions {
  permanent?: boolean; // 名前を常に出す（駅・会場）。ほかは指を乗せたとき・タップしたときに出す
  side?: 'left' | 'right'; // 常に出す名前の向き
  z?: number; // 重なったときの前後（大きいほど手前）
}

// ピンを1つ足す関数を返す。足したピンの位置は bounds に入る（全体が入るように映すため）
export function pinAdder(L: typeof Leaflet, layer: Leaflet.Map | Leaflet.LayerGroup, bounds: [number, number][]) {
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
