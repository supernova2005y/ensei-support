'use client';

// しおりの地図。下地・出典・ピンの作り方は mapCommon.ts（寄り道の画面の地図と共通）。
// 出すもの：駅・会場・寄り道（日ごとの色と番号）・宿・ホットペッパーで選んだ店。日ごとの順番は線でつなぐ（src/lib/shioriRoute.ts）。

import { useEffect, useRef } from 'react';
import type { Map as LeafletMap } from 'leaflet';
import 'leaflet/dist/leaflet.css';
import type { DayRoute } from '@/lib/shioriRoute.ts';
import { createBaseMap, HP_CREDIT, loadLeaflet, ok, pinAdder, type MapPin } from './mapCommon.ts';

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
      const lib = await loadLeaflet();
      const L = lib.L;
      if (cancelled) return;
      map = createBaseMap(lib, el);
      if (shops.length > 0) map.attributionControl.addAttribution(HP_CREDIT);
      const bounds: [number, number][] = [];
      const add = pinAdder(L, map, bounds);

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
