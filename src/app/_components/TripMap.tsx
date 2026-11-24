// 駅・会場・立ち寄り先の位置関係を、略図（SVG）で出す。地図サービスは使わない（Google のデータはここに載せない）。
// 位置は、候補と駅の座標から枠を決めて、全部が入るように写す。

import type { Spot } from '@/lib/itinerary.ts';
import type { Station } from '@/lib/itineraryData.ts';

const W = 900;
const H = 400;
const PAD = 50;

export default function TripMap(props: {
  venue: { name: string; lat: number; lng: number };
  stations: Station[];
  spots: Spot[]; // 地図に出す候補（表示中のもの）
  picked: Set<string>;
}) {
  const { venue, stations, spots, picked } = props;
  const points = [venue, ...stations, ...spots];
  const lats = points.map((p) => p.lat);
  const lngs = points.map((p) => p.lng);
  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);
  const minLng = Math.min(...lngs);
  const maxLng = Math.max(...lngs);
  const x = (lng: number) => PAD + ((lng - minLng) / (maxLng - minLng || 1)) * (W - 2 * PAD);
  const y = (lat: number) => PAD + ((maxLat - lat) / (maxLat - minLat || 1)) * (H - 2 * PAD);

  const vx = x(venue.lng);
  const vy = y(venue.lat);

  return (
    <svg className="trip-map" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="駅と立ち寄り候補の位置関係">
      {stations.map((st) => (
        <g key={st.id}>
          <rect x={x(st.lng) - 6} y={y(st.lat) - 6} width="12" height="12" rx="2" className="trip-map-station" />
          <text x={x(st.lng) + 12} y={y(st.lat) + 4} className="trip-map-label">
            {st.name}
          </text>
        </g>
      ))}
      <path
        d={`M ${vx} ${vy - 12} L ${vx + 11} ${vy + 8} L ${vx - 11} ${vy + 8} Z`}
        className="trip-map-venue"
      />
      <text x={vx + 16} y={vy + 6} className="trip-map-venue-label">
        会場 {venue.name}
      </text>
      {spots.map((s) => {
        const on = picked.has(s.id);
        return (
          <circle
            key={s.id}
            cx={x(s.lng)}
            cy={y(s.lat)}
            r={on ? 9 : 7}
            className={on ? 'trip-map-pick' : 'trip-map-candidate'}
          >
            <title>{s.title}</title>
          </circle>
        );
      })}
    </svg>
  );
}
