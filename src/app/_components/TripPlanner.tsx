'use client';

// 寄り道の3画面（選ぶ → 駅の周りで探す → 旅のしおり）。試作（prototype/plan-flow-live-b.html）と同じ流れと見た目。
// 割り振りと総額の計算は src/lib/itinerary.ts（テストあり）。ここは画面と入力だけ。
// 宿の料金は、楽天の空室検索で確かめた額を自分で入れる（保存も取得もしない）。

import { useMemo, useRef, useState } from 'react';
import { cost, schedule, type Pattern, type Price, type Spot } from '@/lib/itinerary.ts';
import type { ItineraryData } from '@/lib/itineraryData.ts';
import type { StayItem } from '@/lib/stays.ts';
import StaysPanel from './StaysPanel.tsx';
import TripMap from './TripMap.tsx';

// 宿の画面に渡す値（会場・日付・人数の設定。EventView から渡される）
export interface TripStays {
  eventId: string;
  checkin: string;
  checkout: string;
  venueName: string;
  custom?: { date: string; start: string };
  setupMessage?: string;
}

type Screen = 'choose' | 'suggest' | 'plan';
const ORDER: Screen[] = ['choose', 'suggest', 'plan'];
const PROGRESS = ['1 泊まり方と行き方を選ぶ', '2 駅の周りで探す', '3 旅のしおり'];
const NEXT_LABEL: Record<Screen, string> = {
  choose: '駅の周りを探す',
  suggest: 'しおりを作る',
  plan: '最初から選び直す',
};

// 乗り降りする駅の周りのまとまり（試作の hub）。spot.hub はこの id のどれか
const HUBS = [
  { id: 'tokyo', title: '東京駅・丸の内', link: '行きの到着・帰りの出発地', why: '到着してすぐ寄れる。終演後は時間がないので、行きに寄るのがおすすめ' },
  { id: 'ariake', title: '有明・豊洲', link: '会場の近く', why: 'ゆりかもめ・りんかい線で会場まで数駅。開場前の時間つぶしにも' },
  { id: 'far', title: '清澄白河', link: '', why: '東京駅や豊洲から20分ほど。時間に余裕があるとき' },
];

const yen = (n: number) => `${n.toLocaleString('ja-JP')}円`;
const range = (p: Price) => (p.min !== p.max ? `${yen(p.min)}〜${yen(p.max)}` : yen(p.yen));

const COLORS = ['var(--accent)', '#7FA9B8', 'var(--mark)', '#C98A5A', '#9AA6B4', 'var(--warn)'];

export default function TripPlanner({ data, stays }: { data: ItineraryData; stays?: TripStays }) {
  const [screen, setScreen] = useState<Screen>('choose');
  const [pattern, setPattern] = useState<Pattern>('after');
  const [goId, setGoId] = useState(data.transport_modes[0]?.id ?? '');
  const [backId, setBackId] = useState(data.transport_modes[0]?.id ?? '');
  const [selectedStay, setSelectedStay] = useState<StayItem | null>(null); // 宿の画面で「この宿にする」を押した宿
  const tripRef = useRef<HTMLElement>(null);
  const [foodId, setFoodId] = useState(data.food_grades[1]?.id ?? data.food_grades[0]?.id ?? '');
  const [genres, setGenres] = useState<Set<string>>(() => new Set(data.genres));
  const [ticket, setTicket] = useState(0);
  const [goods, setGoods] = useState(8000);
  const [picks, setPicks] = useState<Set<string>>(() => new Set());
  const [months, setMonths] = useState(1);

  const go = data.transport_modes.find((m) => m.id === goId) ?? data.transport_modes[0];
  const back = data.transport_modes.find((m) => m.id === backId) ?? data.transport_modes[0];
  const food = data.food_grades.find((f) => f.id === foodId) ?? data.food_grades[0];
  const days = pattern === 'day' ? 1 : 2;
  const hasStay = pattern !== 'day';
  const pickedSpots = useMemo(() => data.spots.filter((s) => picks.has(s.id)), [data.spots, picks]);
  const shownSpots = useMemo(
    () => data.spots.filter((s) => s.genres.some((g) => genres.has(g)) || picks.has(s.id)),
    [data.spots, genres, picks],
  );

  const plan = useMemo(
    () => schedule({ pattern, picks: pickedSpots, arrival: go.arrive, doors: data.event.doors }),
    [pattern, pickedSpots, go.arrive, data.event.doors],
  );

  // 宿の料金は、選んだ宿の宿泊日の合計（予約ページと同じ額）。保存はしない（画面の中だけで使う）
  const stayPrice: Price | undefined =
    hasStay && selectedStay
      ? { yen: selectedStay.total, min: selectedStay.total, max: selectedStay.total, estimated: false }
      : undefined;

  const c = useMemo(
    () =>
      cost({
        picks: pickedSpots,
        transportGo: go.price,
        transportBack: back.price,
        local: data.local_transit,
        stay: stayPrice,
        foodPerDay: food.price_per_day,
        days,
        ticketYen: ticket,
        goodsYen: goods,
      }),
    [pickedSpots, go, back, data.local_transit, stayPrice, food, days, ticket, goods],
  );

  const toggle = <T,>(set: Set<T>, v: T): Set<T> => {
    const next = new Set(set);
    if (next.has(v)) next.delete(v);
    else next.add(v);
    return next;
  };

  const idx = ORDER.indexOf(screen);
  
  const next = () => setScreen(idx === 2 ? 'choose' : ORDER[idx + 1]);
  const prev = () => setScreen(ORDER[Math.max(0, idx - 1)]);
  // 宿を選んだあと：寄り道の画面に切り替えて、そこまでスクロールする
  const goSuggest = () => {
    setScreen('suggest');
    requestAnimationFrame(() => tripRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
  };

  const pmYen = Math.ceil(c.hi / months / 100) * 100;

  return (
    <section ref={tripRef} className="trip" aria-label="寄り道の計画">
      <h2 className="trip-title">寄り道の計画</h2>
      <ol className="trip-progress" aria-label="進み具合">
        {PROGRESS.map((label, i) => (
          <li key={label} className={i < idx ? 'done' : i === idx ? 'now' : ''}>
            <button type="button" onClick={() => setScreen(ORDER[i])}>
              {label}
            </button>
          </li>
        ))}
      </ol>

      {screen === 'choose' && (
        <div className="trip-screen">
          <div className="trip-screen-head">
            <h3>まず、泊まり方と行き方を選ぼう</h3>
            <span className="trip-note">料金は目安。幅は（下限〜上限）で出しています</span>
          </div>

          <div className="trip-step">
            <div className="trip-step-head">
              <h4>泊まる？</h4>
            </div>
            <div className="trip-opts">
              {data.patterns.map((p) => (
                <label key={p.id} className="trip-opt">
                  <input type="radio" name="pattern" checked={pattern === p.id} onChange={() => setPattern(p.id)} />
                  <span className="t">{p.title}</span>
                  <span className="d">{p.note}</span>
                </label>
              ))}
            </div>
          </div>

          <div className="trip-step">
            <div className="trip-step-head">
              <h4>何で行く？</h4>
            </div>
            <div className="trip-opts">
              {data.transport_modes.map((m) => (
                <TransportOpt key={m.id} name="go" m={m} checked={goId === m.id} onPick={() => setGoId(m.id)} />
              ))}
            </div>
          </div>

          <div className="trip-step">
            <div className="trip-step-head">
              <h4>何で帰る？</h4>
            </div>
            <div className="trip-opts">
              {data.transport_modes.map((m) => (
                <TransportOpt key={m.id} name="back" m={m} checked={backId === m.id} onPick={() => setBackId(m.id)} />
              ))}
            </div>
          </div>

          {hasStay && stays && (
            <div className="trip-stay">
              <StaysPanel
                eventId={stays.eventId}
                checkin={stays.checkin}
                checkout={stays.checkout}
                venueName={stays.venueName}
                custom={stays.custom}
                setupMessage={stays.setupMessage}
                selected={selectedStay}
                onSelect={setSelectedStay}
              />
              {selectedStay && (
                <div className="trip-stay-next">
                  <span>選んだ宿：{selectedStay.name}（{yen(selectedStay.total)}）</span>
                  <button type="button" className="trip-btn primary" onClick={goSuggest}>
                    寄り道を選ぶ ↓
                  </button>
                </div>
              )}
            </div>
          )}

          <div className="trip-step">
            <div className="trip-step-head">
              <h4>ご飯のグレードは？</h4>
              <span className="trip-q">1日あたり</span>
            </div>
            <div className="trip-opts">
              {data.food_grades.map((f) => (
                <label key={f.id} className="trip-opt">
                  <input type="radio" name="food" checked={foodId === f.id} onChange={() => setFoodId(f.id)} />
                  <span className="t">{f.title}</span>
                  <span className="row">
                    <span className="price">{range(f.price_per_day)}</span>
                  </span>
                  <span className="d">{f.note}</span>
                </label>
              ))}
            </div>
          </div>

          <div className="trip-step">
            <div className="trip-step-head">
              <h4>前後で見たいものは？</h4>
              <span className="trip-q">いくつでも。次の画面で、駅の周りから探します</span>
            </div>
            <div className="trip-genres">
              {data.genres.map((g) => (
                <label key={g} className="trip-genre">
                  <input
                    type="checkbox"
                    checked={genres.has(g)}
                    onChange={() => setGenres((s) => toggle(s, g))}
                  />
                  <span>{g}</span>
                </label>
              ))}
            </div>
          </div>

          <div className="trip-step">
            <div className="trip-step-head">
              <h4>そのほか</h4>
            </div>
            <div className="trip-fields">
              <label className="trip-field">
                <span>チケット代（円）</span>
                <input type="number" min={0} step={100} inputMode="numeric" value={ticket} onChange={(e) => setTicket(Number(e.target.value) || 0)} />
              </label>
              <label className="trip-field">
                <span>グッズ予算（円）</span>
                <input type="number" min={0} step={500} inputMode="numeric" value={goods} onChange={(e) => setGoods(Number(e.target.value) || 0)} />
              </label>
            </div>
          </div>
        </div>
      )}

      {screen === 'suggest' && (
        <div className="trip-screen">
          <div className="trip-screen-head">
            <h3>乗り降りする駅の周りで、好きそうなもの</h3>
            <span className="trip-note">気になるものを「行きたい」にすると、しおりと合計に入ります</span>
          </div>
          <div className="trip-chosen">
            <span>{pattern === 'after' ? '後泊' : pattern === 'before' ? '前泊' : '日帰り'}</span>
            <span>行き：{go.title}</span>
            <span>帰り：{back.title}</span>
            {hasStay && selectedStay && <span>宿：{selectedStay.name}（{yen(selectedStay.total)}）</span>}
            <span>ご飯：{food.title}</span>
            {[...genres].map((g) => (
              <span key={g}>#{g}</span>
            ))}
          </div>
          <div className="trip-mapbox">
            <div className="trip-mapwrap">
              <TripMap venue={data.event.venue} stations={data.stations} spots={shownSpots} picked={picks} />
            </div>
            <span className="trip-note">塗りの丸＝行きたいに入れたもの、点線の丸＝候補。位置関係の略図です。</span>
          </div>

          {HUBS.map((hub) => {
            const items = shownSpots.filter((s) => s.hub === hub.id);
            return (
              <div key={hub.id} className="trip-hub">
                <div className="trip-hub-head">
                  <h4>{hub.title}</h4>
                  {hub.link && <span className="trip-link">{hub.link}</span>}
                  <span className="trip-note">{hub.why}</span>
                </div>
                {items.length ? (
                  <div className="trip-cards">
                    {items.map((s) => {
                      const on = picks.has(s.id);
                      return (
                        <div key={s.id} className={`trip-spot${on ? ' on' : ''}`}>
                          <span>
                            {s.genres.map((g) => (
                              <span key={g} className="trip-tag">
                                {g}
                              </span>
                            ))}
                            {s.needs_check && <span className="trip-tag warn">要確認</span>}
                          </span>
                          <span className="t">{s.title}</span>
                          <span className="d">{s.hours === '要確認' ? '営業時間は要確認' : `営業時間 ${s.hours}`}・{s.availability}</span>
                          <span className="d">{s.note}</span>
                          <div className="row">
                            <span className="mono note">
                              {range(s.price)}
                              {s.price.estimated ? '（推定）' : ''}
                            </span>
                            <button type="button" aria-pressed={on} onClick={() => setPicks((p) => toggle(p, s.id))}>
                              {on ? '行きたい ✓' : '行きたい'}
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <p className="trip-empty">選んだジャンルでは、この駅の周りの候補がまだありません。</p>
                )}
              </div>
            );
          })}
        </div>
      )}

      {screen === 'plan' && (
        <div className="trip-screen">
          <div className="trip-screen-head">
            <h3>旅のしおり</h3>
            <span className="trip-note">選んだ行き方と立ち寄り先から順番を組みました。時間は目安です</span>
          </div>
          {plan.warnings.map((w) => (
            <p key={w} className="trip-tip" role="status">
              {w}
            </p>
          ))}
          <div className="trip-summary">
            <div className="trip-days">
              {plan.days.map((day, i) => (
                <div key={`${day.label}-${i}`} className="trip-day">
                  <h4>{day.label}</h4>
                  <ul className="trip-tl">
                    {i === 0 && (
                      <li>
                        <span className="h">{go.arrive}</span>
                        <span className="w">{go.title}で到着（{go.duration}）</span>
                      </li>
                    )}
                    {day.items.map((s) => (
                      <li key={s.id} className="spotrow">
                        <span className="h">↓</span>
                        <span className="w">
                          {s.title}
                          <span className="trip-note"> 営業時間 {s.hours === '要確認' ? '要確認' : s.hours}</span>
                        </span>
                      </li>
                    ))}
                    {day.label === '公演日' && (
                      <>
                        <li>
                          <span className="h">{data.event.doors}</span>
                          <span className="w">開場</span>
                        </li>
                        <li className="live">
                          <span className="h">{data.event.start}</span>
                          <span className="w">開演</span>
                        </li>
                        <li>
                          <span className="h">{data.event.end_estimate}</span>
                          <span className="w">終演（目安）</span>
                        </li>
                      </>
                    )}
                    {i === plan.days.length - 1 && (
                      <li>
                        <span className="h">→</span>
                        <span className="w">{back.title}で帰る（{back.duration}）</span>
                      </li>
                    )}
                  </ul>
                </div>
              ))}
            </div>

            <aside className="trip-receipt" aria-label="合計">
              <h4>この遠征の総額</h4>
              <span className="trip-big mono">{yen(c.total)}</span>
              <span className="trip-note">幅をみると {yen(c.lo)}〜{yen(c.hi)}</span>
              <div className="trip-stack" aria-hidden="true">
                {c.parts.map((p, i) =>
                  p.yen > 0 ? (
                    <span key={p.label} style={{ width: `${(p.yen / c.total) * 100}%`, background: COLORS[i % COLORS.length] }} />
                  ) : null,
                )}
              </div>
              <ul className="trip-rows">
                {c.parts.map((p, i) => (
                  <li key={p.label}>
                    <span className="sw" style={{ background: COLORS[i % COLORS.length] }} />
                    <span>{p.label}</span>
                    <span className="v mono">{yen(p.yen)}</span>
                  </li>
                ))}
              </ul>
              <div className="trip-save">
                <label>
                  <select value={months} onChange={(e) => setMonths(Number(e.target.value))} aria-label="積み立て期間">
                    <option value={1}>1か月</option>
                    <option value={2}>2か月</option>
                  </select>{' '}
                  で積み立てるなら
                </label>
                <div className="row">
                  <span className="trip-note">毎月（高めの額で計算）</span>
                  <span className="pm mono">{yen(pmYen)}</span>
                </div>
              </div>
              <p className="trip-skip">
                この遠征を見送った場合、チケット以外で <b className="mono">{yen(c.total - ticket)}</b> が浮く計算です。
              </p>
            </aside>
          </div>
        </div>
      )}

      <div className="trip-bar">
        <div className="trip-bar-in">
          {idx > 0 && (
            <button type="button" className="trip-btn ghost" onClick={prev}>
              戻る
            </button>
          )}
          <div className="trip-tot">
            <b className="mono">{yen(c.total)}</b>
            <span className="mono">{yen(c.lo)}〜{yen(c.hi)}</span>
          </div>
          <span className="trip-sp" />
          <button type="button" className="trip-btn primary" onClick={next}>
            {NEXT_LABEL[screen]}
          </button>
        </div>
      </div>
    </section>
  );
}

function TransportOpt(props: {
  name: string;
  m: { id: string; title: string; duration: string; price: Price; note: string };
  checked: boolean;
  onPick: () => void;
}) {
  const { name, m, checked, onPick } = props;
  return (
    <label className="trip-opt">
      <input type="radio" name={name} checked={checked} onChange={onPick} />
      <span className="t">{m.title}</span>
      <span className="row">
        <span className="time">{m.duration}</span>
        <span className="price">{range(m.price)}</span>
      </span>
      <span className="d">{m.note}</span>
    </label>
  );
}
