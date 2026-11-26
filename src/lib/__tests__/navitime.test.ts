import assert from 'node:assert/strict';
import test from 'node:test';
import { departureTime, fetchTransit, homewardRoutes, NavitimeError, stationName, type RouteBody } from '../navitime.ts';

// 会場→名古屋の返事の形をまねた偽のデータ（日付は 2026-12-06。時刻は平均の待ち時間による見込み）
const t = (hhmm: string) => `2026-12-06T${hhmm}:00+09:00`;
const walk = (from: string, to: string) => ({ type: 'move', move: 'walk', from_time: t(from), to_time: t(to) });
const ride = (line: string, from: string, to: string) => ({ type: 'move', move: 'local_train', line_name: line, from_time: t(from), to_time: t(to) });
const point = (name: string) => ({ type: 'point', name });
const fare = { unit_0: 6000, unit_1: 4000, unit_2: 5000, unit_3: 8000, unit_48: 5990 };

const body: RouteBody = {
  items: [
    {
      summary: { move: { from_time: t('19:50'), fare } },
      sections: [point('start'), walk('19:50', '19:52'), point('国際展示場（りんかい線）'), ride('りんかい線', '19:55', '20:09'), point('大崎'), ride('ＪＲ山手線', '20:14', '20:17'), point('品川'), ride('のぞみ（東海道）', '20:40', '22:10'), point('名古屋'), walk('22:10', '22:15'), point('goal')],
    },
    {
      // 同じ品川・同じ路線で、着くのが遅い候補 → まとめられる
      summary: { move: { from_time: t('19:50'), fare } },
      sections: [point('start'), walk('19:50', '19:52'), point('国際展示場（りんかい線）'), ride('りんかい線', '19:55', '20:12'), point('大崎'), ride('ＪＲ山手線', '20:16', '20:20'), point('品川'), ride('のぞみ（東海道）', '20:40', '22:15'), point('名古屋')],
    },
    {
      summary: { move: { from_time: t('19:50'), fare: { unit_0: 6100, unit_1: 4000, unit_2: 5000 } } },
      sections: [point('start'), walk('19:50', '19:52'), point('国際展示場（りんかい線）'), ride('りんかい線', '19:55', '20:09'), point('大崎'), ride('ＪＲ埼京線快速', '20:09', '20:13'), point('恵比寿（東京都）'), ride('東急東横線', '20:27', '20:46'), point('日吉（神奈川県）'), ride('東急新横浜線', '20:46', '20:54'), point('新横浜'), ride('のぞみ（東海道）', '21:20', '22:37'), point('名古屋')],
    },
    {
      // 新幹線を使わない経路は除く
      summary: { move: { from_time: t('19:50'), fare: { unit_0: 5000 } } },
      sections: [point('start'), ride('近鉄特急', '20:00', '23:00'), point('名古屋')],
    },
  ],
};

test('駅の名前から、かっこ書き（路線・都道府県）を外す', () => {
  assert.equal(stationName('国際展示場（りんかい線）'), '国際展示場');
  assert.equal(stationName('恵比寿（東京都）'), '恵比寿');
  assert.equal(stationName('品川'), '品川');
});

test('乗車駅・そこまでの分（会場を出てから着くまで）・路線・運賃（乗車券＋特急券）を取り出す。発車時刻は持たない', () => {
  const routes = homewardRoutes(body);
  assert.deepEqual(routes[0], {
    boarding: '品川',
    minutes: 27,
    lines: ['りんかい線', 'ＪＲ山手線'],
    train: 'のぞみ',
    fare: { ticket: 6000, nonReserved: 10000, reserved: 11000 },
  });
  assert.equal(routes[1].boarding, '新横浜');
  assert.equal(routes[1].minutes, 64);
  assert.deepEqual(routes[1].lines, ['りんかい線', 'ＪＲ埼京線快速', '東急東横線', '東急新横浜線']);
  assert.ok(routes.every((r) => !('dep' in r)));
});

test('同じ乗車駅・同じ路線の候補はまとめ、新幹線を使わない経路は除く。件数は max まで', () => {
  assert.equal(homewardRoutes(body).length, 2);
  assert.equal(homewardRoutes(body, 1).length, 1);
  assert.deepEqual(homewardRoutes({}), []);
});

test('出発の時刻：終演の目安に退場の分を足す。日をまたぐときは翌日にする', () => {
  assert.equal(departureTime('2026-12-06', '19:30', 20), '2026-12-06T19:50:00');
  assert.equal(departureTime('2026-12-31', '23:50', 20), '2027-01-01T00:10:00');
});

test('fetchTransit：キーとホストを付けて呼び、残り回数をヘッダーから読む。エラーは NavitimeError にする', async () => {
  let seen: { url: string; key: string | null; host: string | null } | undefined;
  const ok = (async (url: string, init: RequestInit) => {
    const h = new Headers(init.headers);
    seen = { url, key: h.get('x-rapidapi-key'), host: h.get('x-rapidapi-host') };
    return new Response(JSON.stringify(body), { status: 200, headers: { 'x-ratelimit-requests-remaining': '498' } });
  }) as typeof fetch;
  const r = await fetchTransit('k', { lat: 35.6, lng: 139.7 }, { lat: 35.1, lng: 136.8 }, '2026-12-06T19:50:00', ok);
  assert.equal(r.remaining, 498);
  assert.equal(r.body.items?.length, 4);
  assert.equal(seen?.key, 'k');
  assert.equal(seen?.host, 'navitime-route-totalnavi.p.rapidapi.com');
  assert.match(seen?.url ?? '', /start=35\.6%2C139\.7&goal=35\.1%2C136\.8&start_time=2026-12-06T19%3A50%3A00/);

  const noHeader = (async () => new Response(JSON.stringify(body), { status: 200 })) as typeof fetch;
  assert.equal((await fetchTransit('k', { lat: 0, lng: 0 }, { lat: 0, lng: 0 }, 'x', noHeader)).remaining, null);

  const ng = (async () => new Response(JSON.stringify({ message: 'You are not subscribed to this API.' }), { status: 403 })) as typeof fetch;
  await assert.rejects(fetchTransit('k', { lat: 0, lng: 0 }, { lat: 0, lng: 0 }, 'x', ng), (e) => e instanceof NavitimeError && e.status === 403);
});
