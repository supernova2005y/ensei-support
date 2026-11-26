'use client';

// 寄り道の画面の地図。駅・会場・寄り道の候補・選んだ宿・選んだお店を、淡色地図（地理院タイル＋Leaflet）の上に出す。
// 下地・出典・ピンの作り方は mapCommon.ts（しおりの地図と共通）。Google のデータはここに載せない。
//
// 見分け方（前の略図と同じ）：候補は点線の丸、「行きたい」に入れたものは塗りの丸。
// 「行きたい」を押すたびに地図を作り直すと、拡大した位置が戻ってしまうので、地図は1回だけ作り、ピンだけ描き直す。
// 全体が入るように映し直すのは、出ている点の位置が変わったとき（見たいものを変えたとき・宿やお店を選んだとき）だけ。

import { useEffect, useRef, useState } from 'react';
import type * as Leaflet from 'leaflet';
import 'leaflet/dist/leaflet.css';
import type { Spot } from '@/lib/itinerary.ts';
import type { Station } from '@/lib/itineraryData.ts';
import { createBaseMap, HP_CREDIT, loadLeaflet, pinAdder, type MapPin } from './mapCommon.ts';

export default function TripMap(props: {
  venue: { name: string; lat: number; lng: number };
  stations: Station[];
  spots: Spot[]; // 地図に出す候補（表示中のもの）
  picked: Set<string>;
  stay?: MapPin | null; // 選んだ宿（位置がわかるときだけ出す）
  shops?: MapPin[]; // ご飯・カフェで選んだお店（駅の周りの候補から選んだもの）
}) {
  const { venue, stations, spots, picked, stay, shops = [] } = props;
  const box = useRef<HTMLDivElement>(null);
  const lib = useRef<typeof Leaflet | null>(null);
  const map = useRef<Leaflet.Map | null>(null);
  const layer = useRef<Leaflet.LayerGroup | null>(null);
  const fitted = useRef('');
  const [ready, setReady] = useState(false);

  // 地図を1回だけ作る
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    let cancelled = false;
    (async () => {
      const L = await loadLeaflet();
      if (cancelled) return;
      lib.current = L;
      map.current = createBaseMap(L, el);
      layer.current = L.layerGroup().addTo(map.current);
      setReady(true);
    })();
    return () => {
      cancelled = true;
      map.current?.remove();
      map.current = null;
      layer.current = null;
      fitted.current = '';
    };
  }, []);

  // ピンを描き直す（中身が変わったときだけ）
  const pickedIds = spots.filter((s) => picked.has(s.id)).map((s) => s.id);
  const key = JSON.stringify({ venue, stations, spots: spots.map((s) => [s.id, s.title, s.lat, s.lng]), pickedIds, stay, shops });
  useEffect(() => {
    const L = lib.current;
    const m = map.current;
    const g = layer.current;
    if (!ready || !L || !m || !g) return;
    const d = JSON.parse(key) as {
      venue: typeof venue;
      stations: Station[];
      spots: [string, string, number, number][];
      pickedIds: string[];
      stay: MapPin | null | undefined;
      shops: MapPin[];
    };
    const on = new Set(d.pickedIds);

    g.clearLayers();
    const bounds: [number, number][] = [];
    const add = pinAdder(L, g, bounds);
    d.stations.forEach((st) => add(st, 'is-station', st.name, '駅', { permanent: true, z: -500 }));
    add(d.venue, 'is-venue', d.venue.name, '★', { permanent: true, side: 'left', z: 800 });
    if (d.stay) add(d.stay, 'is-stay', `宿 ${d.stay.name}`, '宿', { z: 600 });
    d.shops.forEach((s) => add(s, 'is-shop', s.name, '食', { z: 400 }));
    d.spots.forEach(([id, title, lat, lng]) => {
      const picked = on.has(id);
      add({ lat, lng }, picked ? 'is-pick' : 'is-candidate', picked ? `${title}（行きたい）` : title, '', { z: picked ? 1000 : 200 });
    });

    // 映し直すのは、点の位置の組み合わせが変わったときだけ（「行きたい」の切り替えでは動かさない）
    const where = JSON.stringify(bounds);
    if (where !== fitted.current) {
      fitted.current = where;
      if (bounds.length > 1) m.fitBounds(bounds, { padding: [28, 28], maxZoom: 15 });
      else m.setView([d.venue.lat, d.venue.lng], 14);
    }
    // お店を出しているときだけ、ホットペッパーのクレジットを出す
    m.attributionControl.removeAttribution(HP_CREDIT);
    if (d.shops.length > 0) m.attributionControl.addAttribution(HP_CREDIT);
  }, [ready, key]);

  return <div ref={box} className="shiori-map" role="region" aria-label="駅と立ち寄り候補の地図" />;
}
