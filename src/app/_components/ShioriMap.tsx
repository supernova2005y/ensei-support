'use client';

// しおりの地図。下地は地理院タイル（国土地理院の淡色地図）、地図の部品は Leaflet。キーはいらない。
// 出すもの：駅・会場・寄り道（日ごとの色と番号）・宿・ホットペッパーで選んだ店。日ごとの順番は線でつなぐ（src/lib/shioriRoute.ts）。
//
// 規約:
//   - 地理院タイルは出典（「地理院タイル」へのリンク）を地図の上に出す
//   - ホットペッパーの店を出すときは、クレジットも地図の上に出す。店の名前・位置は、画面で取った値を出すだけで保存しない
//   - Google Places で取ったものは、Google 以外の地図に載せられないので、この地図には渡さない
//
// Leaflet はブラウザでしか動かない（window を使う）ので、画面に出たあと useEffect の中で読み込む。

import { useEffect, useRef } from 'react';
import type { Map as LeafletMap } from 'leaflet';
import 'leaflet/dist/leaflet.css';
import type { DayRoute } from '@/lib/shioriRoute.ts';

const GSI_PALE = 'https://cyberjapandata.gsi.go.jp/xyz/pale/{z}/{x}/{y}.png';
const GSI_CREDIT = '<a href="https://maps.gsi.go.jp/development/ichiran.html" target="_blank" rel="noopener">地理院タイル</a>';
const HP_CREDIT = 'Powered by <a href="http://webservice.recruit.co.jp/" target="_blank" rel="noopener">ホットペッパーグルメ Webサービス</a>';

export interface MapPin {
  id: string;
  name: string;
  lat: number;
  lng: number;
}

const ok = (p: { lat: number; lng: number }) => Number.isFinite(p.lat) && Number.isFinite(p.lng);

// 地図の中の文字は HTML として入るので、名前はエスケープする
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

export default function ShioriMap(props: {
  venue: { name: string; lat: number; lng: number };
  stations: MapPin[];
  routes: DayRoute[];
  shops: MapPin[];
}) {
  const box = useRef<HTMLDivElement>(null);
  // 中身が変わったときだけ作り直す（毎回の描画で地図を作り直さない）
  const key = JSON.stringify(props);

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    let map: LeafletMap | null = null;
    let cancelled = false;
    const { venue, stations, routes, shops } = JSON.parse(key) as typeof props;

    (async () => {
      const L = (await import('leaflet')).default;
      if (cancelled) return;
      map = L.map(el, { scrollWheelZoom: false });
      L.tileLayer(GSI_PALE, { minZoom: 5, maxZoom: 18, attribution: GSI_CREDIT }).addTo(map);
      map.attributionControl.setPrefix(false);
      if (shops.length > 0) map.attributionControl.addAttribution(HP_CREDIT);

      const icon = (cls: string, text = '') =>
        L.divIcon({ className: '', html: `<span class="shiori-pin ${cls}">${esc(text)}</span>`, iconSize: [26, 26], iconAnchor: [13, 13] });
      const bounds: [number, number][] = [];
      // permanent: 名前を常に出す（駅・会場）。ほかは指を乗せたとき・タップしたときに出す
      // z: 重なったときの前後（寄り道・会場を手前、駅を奥に）。side: 常に出す名前の向き
      const add = (p: { lat: number; lng: number }, cls: string, label: string, text = '', opts: { permanent?: boolean; side?: 'left' | 'right'; z?: number } = {}) => {
        if (!ok(p)) return;
        const side = opts.side ?? 'right';
        L.marker([p.lat, p.lng], { icon: icon(cls, text), title: label, zIndexOffset: opts.z ?? 0 })
          .bindTooltip(esc(label), opts.permanent ? { permanent: true, direction: side, offset: [side === 'right' ? 12 : -12, 0], className: 'shiori-label' } : {})
          .addTo(map!);
        bounds.push([p.lat, p.lng]);
      };

      stations.forEach((st) => add(st, 'is-station', st.name, '駅', { permanent: true, z: -500 }));
      shops.forEach((s) => add(s, 'is-shop', s.name, '食'));
      add(venue, 'is-venue', venue.name, '★', { permanent: true, side: 'left', z: 800 });

      routes.forEach((r, i) => {
        const line = r.points.filter(ok).map((p) => [p.lat, p.lng] as [number, number]);
        if (line.length >= 2) L.polyline(line, { className: `shiori-line shiori-day-${i}`, weight: 4, opacity: 0.85 }).addTo(map!);
        r.points.forEach((p) => {
          if (p.kind === 'spot') add(p, `is-spot shiori-day-${i}`, `${r.label} ${p.order}. ${p.name}`, String(p.order), { z: 1000 });
          if (p.kind === 'stay') add(p, 'is-stay', `宿 ${p.name}`, '宿', { z: 600 });
        });
      });

      if (bounds.length > 1) map.fitBounds(bounds, { padding: [28, 28], maxZoom: 15 });
      else map.setView(ok(venue) ? [venue.lat, venue.lng] : [35.68, 139.76], 14);
    })();

    return () => {
      cancelled = true;
      map?.remove();
    };
  }, [key]);

  return <div ref={box} className="shiori-map" role="region" aria-label="旅のしおりの地図" />;
}
