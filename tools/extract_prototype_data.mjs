// 試作 HTML の固定データ（PATTERN・GO・BACK・STAY・FOOD・GENRES・ST・SP）を取り出し、
// docs/データの形.md の形に直して data/<名前>.json に書き出す。
// 公演そのもの（会場・時刻）は、アプリが読む公演の設定 events/<名前>.json から取る（値を二重に持たない）。
// 使い方: node tools/extract_prototype_data.mjs prototype/plan-flow-live-b.html events/live-b.json data/live-b.json
import { readFileSync, writeFileSync } from 'node:fs';
import vm from 'node:vm';

const [src, eventFile, out] = process.argv.slice(2);
if (!src || !eventFile || !out) { console.error('使い方: node tools/extract_prototype_data.mjs <試作.html> <公演の設定.json> <出力.json>'); process.exit(1); }
const ev = JSON.parse(readFileSync(eventFile, 'utf8'));

const html = readFileSync(src, 'utf8');
const script = html.slice(html.indexOf('<script>') + 8, html.indexOf('const state'));
const ctx = {};
vm.runInNewContext(script + '\nthis.D = {PATTERN, GO, BACK, STAY, FOOD, GENRES, ST, SP};', ctx);
const D = ctx.D;

// 値段は「目安・下限・上限」の3つにそろえる。幅がないものは3つとも同じ
const price = o => ({ yen: o.p, min: o.lo ?? o.p, max: o.hi ?? o.p, estimated: /推定/.test(o.d ?? '') });
const transport = (dir, pattern) => D[dir][pattern].map(o => ({
  id: o.id, direction: dir === 'GO' ? 'go' : 'back', pattern,
  title: o.t, duration: o.time, depart: o.dep, arrive: o.arr, note: o.d, price: price(o),
}));

const data = {
  schema_version: 1,
  source: { from: src, note: '試作の固定値。2026-10-19 に Web 検索で集めた値で、API の実データではない' },
  event: {
    from: eventFile, artist: ev.artist ?? ev.name, date: ev.date ?? ev.checkin,
    venue: { name: ev.venue.name, lat: ev.venue.lat, lng: ev.venue.lng },
    doors: ev.venue.open, start: ev.venue.start, end_estimate: ev.venue.endEstimate,
    notes: ['前日も同じ会場で公演', '翌日は祝日（3連休）→ ホテルが埋まりやすい'],
  },
  origin: '名古屋',
  patterns: D.PATTERN.map(o => ({ id: o.id, title: o.t, note: o.d })),
  transport: Object.keys(D.GO).flatMap(pt => [...transport('GO', pt), ...transport('BACK', pt)]),
  food_grades: D.FOOD.map(o => ({ id: o.id, title: o.t, note: o.d, price_per_day: price(o) })),
  genres: D.GENRES,
  stations: Object.entries(D.ST).map(([id, s]) => ({ id, name: s.n, lat: s.lat, lng: s.lng })),
  spots: Object.entries(D.SP).map(([id, s]) => ({
    id, title: s.t, genres: s.g, hub: s.hub, lat: s.lat, lng: s.lng,
    hours: s.open, availability: s.ok, note: s.d, map_query: s.q, price: price(s),
    needs_check: s.open === '要確認' || /要確認/.test(s.ok),
  })),
};

// 形の確認（足りない値があれば止める）
const must = (cond, msg) => { if (!cond) { console.error('データの形が正しくありません: ' + msg); process.exit(1); } };
for (const t of data.transport) must(t.id && t.title && Number.isFinite(t.price.yen) && t.price.min <= t.price.yen && t.price.yen <= t.price.max, `transport ${t.pattern}/${t.id}`);
for (const s of data.spots) must(s.genres.every(g => data.genres.includes(g)) && Number.isFinite(s.lat), `spot ${s.id}`);

writeFileSync(out, JSON.stringify(data, null, 2) + '\n');
console.log(`${out} に書き出しました：交通 ${data.transport.length}・立ち寄り先 ${data.spots.length}・駅 ${data.stations.length}`);
