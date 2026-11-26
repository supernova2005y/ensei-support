'use client';

// 寄り道の計画。流れは「日帰りできる？ → いつ泊まる？（宿の検索）→ 何で行く？ → 何で帰る？ → 寄り道（見たいもの・駅の周りのお店・ご飯）→ しおり」。
// チケット代とグッズ予算は、しおりで入れる（入れると、円グラフがその場で動く）。
// 割り振りと総額の計算は src/lib/itinerary.ts（テストあり）。ここは画面と入力だけ。

import { useMemo, useState } from 'react';
import { cost, schedule, type Pattern, type Price, type Spot } from '@/lib/itinerary.ts';
import type { ItineraryData } from '@/lib/itineraryData.ts';
import type { StayItem } from '@/lib/stays.ts';
import type { HpShop } from '@/lib/hotpepper.ts';
import type { LastTrainJudgment } from '@/lib/lastTrain.ts';
import LastTrainCard from './LastTrainCard.tsx';
import StaysPanel from './StaysPanel.tsx';
import TripMap from './TripMap.tsx';
import ShioriMap from './ShioriMap.tsx';
import { dayRoutes } from '@/lib/shioriRoute.ts';

// 宿の検索に渡す値（会場・日付・人数の設定。EventView から渡される）
export interface TripStays {
  eventId: string;
  checkin: string;
  checkout: string;
  venueName: string;
  custom?: { date: string; start: string };
  setupMessage?: string;
}

type Screen = 'choose' | 'suggest' | 'plan';
type Step = 'day' | 'stay' | 'go' | 'back';

type ShopsState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'error'; message: string; hint?: string }
  | { status: 'done'; hubs: Record<string, HpShop[]>; credit: string; creditUrl: string };

const yen = (n: number) => `${n.toLocaleString('ja-JP')}円`;
const range = (p: Price) => (p.min !== p.max ? `${yen(p.min)}〜${yen(p.max)}` : yen(p.yen));
const COLORS = ['var(--accent)', '#7FA9B8', 'var(--mark)', '#C98A5A', '#9AA6B4', 'var(--warn)'];
const NO_FOOD: Price = { yen: 0, min: 0, max: 0, estimated: false };
const DONUT_R = 52;
const DONUT_C = 2 * Math.PI * DONUT_R;

export default function TripPlanner({
  data,
  stays,
  eventId,
  lastTrain,
}: {
  data: ItineraryData;
  stays?: TripStays;
  eventId: string;
  lastTrain?: LastTrainJudgment | null;
}) {
  const [screen, setScreen] = useState<Screen>('choose');
  const [qStep, setQStep] = useState(0);
  const [dayChoice, setDayChoice] = useState<'yes' | 'no' | null>(null); // 日帰りできる？
  const [stayPattern, setStayPattern] = useState<Pattern>('after'); // いつ泊まる？（前泊・後泊）
  const [stayPicked, setStayPicked] = useState(false);
  const [selectedStay, setSelectedStay] = useState<StayItem | null>(null);
  const [goId, setGoId] = useState(''); // 選ぶまで、どれも選ばれていない（選んだら次へ進むため）
  const [backId, setBackId] = useState('');
  const [foodId, setFoodId] = useState(''); // ご飯のグレード（寄り道の画面で選ぶ。選ばなければ食事代は入れない）
  const [genres, setGenres] = useState<Set<string>>(() => new Set(data.genres));
  const [ticket, setTicket] = useState(0);
  const [goods, setGoods] = useState(0);
  const [picks, setPicks] = useState<Set<string>>(() => new Set());
  const [months, setMonths] = useState(1);
  const [shops, setShops] = useState<ShopsState>({ status: 'idle' });
  const [hpPicks, setHpPicks] = useState<Map<string, HpShop>>(() => new Map());

  // 質問の順番は、日帰りかどうかで変わる
  const steps: Step[] = dayChoice === 'no' ? ['day', 'stay', 'go', 'back'] : dayChoice === 'yes' ? ['day', 'go', 'back'] : ['day'];
  const curStep = steps[Math.min(qStep, steps.length - 1)];
  const lastStep = qStep >= steps.length - 1;

  const pattern: Pattern = dayChoice === 'yes' ? 'day' : stayPattern;
  const hasStay = pattern !== 'day';
  const goChosen = data.transport_modes.find((m) => m.id === goId);
  const backChosen = data.transport_modes.find((m) => m.id === backId);
  const go = goChosen ?? data.transport_modes[0];
  const back = backChosen ?? data.transport_modes[0];
  const food = data.food_grades.find((f) => f.id === foodId);
  const days = pattern === 'day' ? 1 : 2;
  const stayPrice: Price | undefined =
    hasStay && selectedStay
      ? { yen: selectedStay.total, min: selectedStay.total, max: selectedStay.total, estimated: false }
      : undefined;

  const pickedSpots = useMemo(() => data.spots.filter((s) => picks.has(s.id)), [data.spots, picks]);
  const shownSpots = useMemo(
    () => data.spots.filter((s) => s.genres.some((g) => genres.has(g)) || picks.has(s.id)),
    [data.spots, genres, picks],
  );
  const plan = useMemo(
    () => schedule({ pattern, picks: pickedSpots, arrival: go.arrive, doors: data.event.doors }),
    [pattern, pickedSpots, go.arrive, data.event.doors],
  );
  const routes = useMemo(
    () =>
      dayRoutes({
        pattern,
        days: plan.days,
        venue: data.event.venue,
        stay: hasStay && selectedStay ? { name: selectedStay.name, lat: selectedStay.lat, lng: selectedStay.lng } : null,
      }),
    [pattern, plan.days, data.event.venue, hasStay, selectedStay],
  );
  const c = useMemo(
    () =>
      cost({
        picks: pickedSpots,
        transportGo: goChosen ? goChosen.price : NO_FOOD, // 選ぶまでは0円
        transportBack: backChosen ? backChosen.price : NO_FOOD,
        local: goChosen ? data.local_transit : NO_FOOD,
        stay: stayPrice,
        foodPerDay: food ? food.price_per_day : NO_FOOD,
        days,
        ticketYen: ticket,
        goodsYen: goods,
      }),
    // 選んだ便（goChosen・backChosen）で計算し直す。go・back は初期値（先頭の便）と同じ物を指すことがあるので、依存に入れない
    [pickedSpots, goChosen, backChosen, data.local_transit, stayPrice, food, days, ticket, goods],
  );

  const toggle = <T,>(set: Set<T>, v: T): Set<T> => {
    const next = new Set(set);
    if (next.has(v)) next.delete(v);
    else next.add(v);
    return next;
  };

  // 選んだ宿に位置があれば、その近くのお店も探す（「宿の近く」の欄）
  const nearStay = hasStay && selectedStay && selectedStay.lat != null && selectedStay.lng != null ? selectedStay : null;
  const shopHubs = nearStay
    ? [...data.hubs, { id: 'stay', title: `宿の近く（${nearStay.station ?? nearStay.name}）` }]
    : data.hubs;

  async function findShops() {
    setShops({ status: 'loading' });
    const near = nearStay ? `&near=${nearStay.lat},${nearStay.lng}` : '';
    try {
      const res = await fetch(`/api/shops?event=${encodeURIComponent(eventId)}${near}`, { cache: 'no-store' });
      const body = await res.json().catch(() => null);
      if (!res.ok || !body) {
        setShops({ status: 'error', message: body?.error ?? `サーバーがエラーを返しました（HTTP ${res.status}）。`, hint: body?.hint });
        return;
      }
      setShops({ status: 'done', hubs: body.hubs, credit: body.credit, creditUrl: body.creditUrl });
    } catch {
      setShops({ status: 'error', message: '通信できませんでした。電波のよいところで、もう一度試してください。' });
    }
  }

  const toggleHp = (shop: HpShop) =>
    setHpPicks((prev) => {
      const next = new Map(prev);
      if (next.has(shop.id)) next.delete(shop.id);
      else next.set(shop.id, shop);
      return next;
    });

  const scrollTop = () => window.scrollTo({ top: 0, behavior: 'smooth' });

  // 下のバーの動き
  const onChoose = screen === 'choose';
  const barDisabled =
    onChoose && ((curStep === 'day' && dayChoice === null) || (curStep === 'stay' && !stayPicked));
  const barLabel = screen === 'suggest' ? 'しおりを作る' : '最初から選び直す';
  const showPrimary = !onChoose;
  // 宿を検索したあと、宿を選ばずに次へ進む（下のバーの右側）
  const skipStayVisible = onChoose && curStep === 'stay' && stayPicked && !selectedStay;
  const showBack = onChoose ? qStep > 0 : true;
  // 選んだら次の質問へ（最後の質問を選んだら、寄り道の画面へ）
  const advance = () => {
    if (lastStep) {
      setScreen('suggest');
      scrollTop();
    } else {
      setQStep(qStep + 1);
    }
  };
  const barAction = () => {
    if (screen === 'choose') {
      if (lastStep) {
        setScreen('suggest');
      } else {
        setQStep(qStep + 1);
      }
    } else if (screen === 'suggest') {
      setScreen('plan');
    } else {
      setScreen('choose');
      setQStep(0);
    }
    scrollTop();
  };
  // 戻るときは、戻った先の質問から後ろの答えを消す（料金の合計からも引かれ、選び直せる）
  const clearAnswersFrom = (name: Step) => {
    const later = steps.slice(steps.indexOf(name));
    if (later.includes('day')) setDayChoice(null);
    if (later.includes('stay')) {
      setStayPicked(false);
      setSelectedStay(null);
    }
    if (later.includes('go')) setGoId('');
    if (later.includes('back')) setBackId('');
  };
  const backAction = () => {
    if (screen === 'choose') {
      const target = Math.max(0, qStep - 1);
      clearAnswersFrom(steps[target]);
      setQStep(target);
    } else if (screen === 'suggest') {
      setScreen('choose');
      setQStep(steps.length - 1);
    } else {
      setScreen('suggest');
    }
    scrollTop();
  };

  // 日帰り判定の一覧は、「日帰りできる？」と、日帰りを選んだあとの「何で帰る？」で出す
  const showLastTrain = lastTrain && (curStep === 'day' || (curStep === 'back' && dayChoice === 'yes'));

  return (
    <section className="trip" aria-label="寄り道の計画">
      {screen === 'choose' && (
        <div className="trip-screen">
          {curStep === 'day' && (
            <>
              {showLastTrain && <LastTrainCard judgment={lastTrain} />}
              {!lastTrain && (
                <div className="trip-hint">
                  <span className="trip-hint-head">新幹線の目安</span>
                  <ul>
                    {data.transport_modes
                      .filter((m) => m.id === 'nozomi' || m.id === 'kodama')
                      .map((m) => (
                        <li key={m.id}>
                          <b>{m.title}</b> {m.duration}・{range(m.price)}
                        </li>
                      ))}
                  </ul>
                </div>
              )}
              <div className="trip-opts">
                <label className="trip-opt">
                  <input
                    type="radio"
                    name="dayq"
                    checked={dayChoice === 'yes'}
                    onChange={() => {
                      setDayChoice('yes');
                      setSelectedStay(null);
                      setQStep(1); // 選んだら次の質問へ
                    }}
                  />
                  <span className="t">はい（日帰り）</span>
                  <span className="d">宿は探しません</span>
                </label>
                <label className="trip-opt">
                  <input
                    type="radio"
                    name="dayq"
                    checked={dayChoice === 'no'}
                    onChange={() => {
                      setDayChoice('no');
                      setQStep(1);
                    }}
                  />
                  <span className="t">いいえ（泊まる）</span>
                  <span className="d">次の質問で、泊まり方を選びます</span>
                </label>
              </div>
            </>
          )}

          {curStep === 'stay' && (
            <>
              <div className="trip-screen-head">
                <h3>いつ泊まる？</h3>
                </div>
              <div className="trip-opts">
                {(['before', 'after'] as const).map((id) => {
                  const p = data.patterns.find((x) => x.id === id);
                  return (
                    <label key={id} className="trip-opt">
                      <input
                        type="radio"
                        name="stayq"
                        checked={stayPicked && stayPattern === id}
                        onChange={() => {
                          setStayPattern(id);
                          setStayPicked(true);
                          setSelectedStay(null);
                          if (!stays) setQStep(2); // 宿を検索しない公演は、ここで次へ
                        }}
                      />
                      <span className="t">{p?.title}</span>
                      <span className="d">{p?.note}</span>
                    </label>
                  );
                })}
              </div>
              {stayPicked && stays && (
                <div className="trip-stay">
                  <StaysPanel
                    eventId={stays.eventId}
                    checkin={stays.checkin}
                    checkout={stays.checkout}
                    venueName={stays.venueName}
                    custom={stays.custom}
                    setupMessage={stays.setupMessage}
                    selected={selectedStay}
                    onSelect={(st) => {
                      setSelectedStay(st); // 宿を選んだら次へ
                      setQStep(qStep + 1);
                    }}
                    stay={stayPattern === 'before' ? 'before' : 'after'}
                  />
                </div>
              )}
              {stayPicked && !stays && <p className="trip-tip">この公演では、宿の検索はまだ使えません。</p>}
              {selectedStay && <p className="trip-note">選んだ宿：{selectedStay.name}（{yen(selectedStay.total)}）</p>}
            </>
          )}

          {curStep === 'go' && (
            <>
              <div className="trip-screen-head">
                <h3>何で行く？</h3>
                <span className="trip-note">料金は目安。幅は（下限〜上限）で出しています</span>
              </div>
              <div className="trip-opts">
                {data.transport_modes.map((m) => (
                  <TransportOpt
                  key={m.id}
                  name="go"
                  m={m}
                  checked={goId === m.id}
                  onPick={() => {
                    setGoId(m.id);
                    advance();
                  }}
                />
                ))}
              </div>
            </>
          )}

          {curStep === 'back' && (
            <>
              <div className="trip-screen-head">
                <h3>何で帰る？</h3>
                <span className="trip-note">
                  {dayChoice === 'yes' ? '日帰りの判定を、上で見られます' : '料金は目安。幅は（下限〜上限）で出しています'}
                </span>
              </div>
              <div className="trip-opts">
                {data.transport_modes.map((m) => (
                  <TransportOpt
                  key={m.id}
                  name="back"
                  m={m}
                  checked={backId === m.id}
                  onPick={() => {
                    setBackId(m.id);
                    advance();
                  }}
                />
                ))}
              </div>
            </>
          )}
        </div>
      )}

      {screen === 'suggest' && (
        <div className="trip-screen">
          <div className="trip-screen-head">
            <h3>寄り道を探す</h3>
            <span className="trip-note">見たいものを選ぶと、駅の周りに出ます。気になるものは「行きたい」にすると、しおりに入ります</span>
          </div>

          <div className="trip-step">
            <div className="trip-step-head">
              <h4>見たいもの</h4>
              <span className="trip-q">いくつでも</span>
            </div>
            <div className="trip-genres">
              {data.genres.map((g) => (
                <label key={g} className="trip-genre">
                  <input type="checkbox" checked={genres.has(g)} onChange={() => setGenres((s) => toggle(s, g))} />
                  <span>{g}</span>
                </label>
              ))}
            </div>
          </div>

          <div className="trip-chosen">
            <span>{pattern === 'day' ? '日帰り' : pattern === 'before' ? '前泊' : '後泊'}</span>
            <span>行き：{go.title}</span>
            <span>帰り：{back.title}</span>
            {hasStay && selectedStay && <span>宿：{selectedStay.name}（{yen(selectedStay.total)}）</span>}
          </div>

          <div className="trip-mapbox">
            <div className="trip-mapwrap">
              <TripMap
                venue={data.event.venue}
                stations={data.stations}
                spots={shownSpots}
                picked={picks}
                stay={hasStay && selectedStay && selectedStay.lat != null && selectedStay.lng != null ? { id: 'stay', name: selectedStay.name, lat: selectedStay.lat, lng: selectedStay.lng } : null}
                shops={[...hpPicks.values()].map((sh) => ({ id: sh.id, name: sh.name, lat: sh.lat, lng: sh.lng }))}
              />
            </div>
            <span className="trip-note">塗りの丸＝行きたいに入れたもの、点線の丸＝候補。位置関係の略図です。</span>
          </div>

          {data.hubs.map((hub) => {
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
                  <p className="trip-empty">選んだものは、この駅の周りにはまだ候補がありません。</p>
                )}
              </div>
            );
          })}

          <div className="trip-step">
            <div className="trip-step-head">
              <h4>ご飯・カフェ（任意）</h4>
              <span className="trip-q">グレードを選んでから探します</span>
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
            <button type="button" className="trip-btn ghost" onClick={findShops} disabled={!food || shops.status === 'loading'}>
              {food ? `${food.title}のグレードで、駅の周りのお店を探す` : 'グレードを選んでから探せます'}
            </button>
            <span className="trip-note">店の営業時間と定休日は、お店のページで確かめてください。</span>
          </div>

          {shops.status === 'loading' && <p className="trip-note" role="status">お店を探しています…</p>}
          {shops.status === 'error' && (
            <div className="error" role="alert">
              <b>お店を探せませんでした</b>
              <span>{shops.message}</span>
              {shops.hint && <span className="note">{shops.hint}</span>}
            </div>
          )}
          {shops.status === 'done' && (
            <>
              {shopHubs.map((hub) => {
                const list = shops.hubs[hub.id] ?? [];
                return (
                  <div key={hub.id} className="trip-hub">
                    <div className="trip-hub-head">
                      <h4>{hub.title}</h4>
                    </div>
                    {list.length ? (
                      <div className="trip-cards">
                        {list.map((s) => {
                          const on = hpPicks.has(s.id);
                          return (
                            <div key={s.id} className={`trip-spot${on ? ' on' : ''}`}>
                              <span>
                                {s.genre && <span className="trip-tag">{s.genre}</span>}
                                <span className="trip-tag warn">営業は要確認</span>
                              </span>
                              <span className="t">{s.name}</span>
                              <span className="d">予算の目安 {s.budget || '—'}</span>
                              <span className="d">{s.access}</span>
                              <span className="d">定休日：{s.close || '要確認'}</span>
                              <div className="row">
                                {s.url && (
                                  <a href={s.url} target="_blank" rel="noopener">
                                    お店のページ ↗
                                  </a>
                                )}
                                <button type="button" aria-pressed={on} onClick={() => toggleHp(s)}>
                                  {on ? '行きたい ✓' : '行きたい'}
                                </button>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    ) : (
                      <p className="trip-empty">この駅の周りに、お店が見つかりませんでした。</p>
                    )}
                  </div>
                );
              })}
              <p className="trip-note">
                <a href={shops.creditUrl} target="_blank" rel="noopener">
                  {shops.credit}
                </a>
              </p>
            </>
          )}
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
              {/* 旅程は1つのブロックにまとめ、日ごとに見出し（1日目（公演日）など）を入れて縦に並べる */}
              <div className="trip-day">
                <h4>旅程</h4>
                {plan.days.map((day, i) => (
                  <div key={`${day.label}-${i}`} className="trip-tl-day">
                    <h5>
                      {i + 1}日目（{day.label}）
                    </h5>
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

              {/* 左下：総額の内訳（円グラフ）。チケット代・グッズ予算を入れると、その場で動く */}
              <div className="trip-donut-box">
                <svg viewBox="0 0 140 140" className="trip-donut" role="img" aria-label="総額の内訳">
                  <circle cx="70" cy="70" r={DONUT_R} className="trip-donut-bg" />
                  {(() => {
                    let acc = 0;
                    return c.parts.map((p, i) => {
                      const len = c.total > 0 ? (p.yen / c.total) * DONUT_C : 0;
                      const seg = (
                        <circle
                          key={p.label}
                          cx="70"
                          cy="70"
                          r={DONUT_R}
                          style={{
                            stroke: COLORS[i % COLORS.length],
                            strokeDasharray: `${len} ${DONUT_C - len}`,
                            strokeDashoffset: -acc,
                          }}
                          className="trip-donut-seg"
                        />
                      );
                      acc += len;
                      return seg;
                    });
                  })()}
                  <text x="70" y="66" textAnchor="middle" className="trip-donut-label">
                    合計
                  </text>
                  <text x="70" y="84" textAnchor="middle" className="trip-donut-value">
                    {c.total.toLocaleString('ja-JP')}円
                  </text>
                </svg>
              </div>
            </div>

            <aside className="trip-receipt" aria-label="合計">
              <div className="trip-fields">
                <label className="trip-field">
                  <span>チケット代（円）</span>
                  <input
                    type="number"
                    min={0}
                    step={100}
                    inputMode="numeric"
                    placeholder="0"
                    value={ticket || ''}
                    onChange={(e) => setTicket(Number(e.target.value) || 0)}
                  />
                </label>
                <label className="trip-field">
                  <span>グッズ予算（円）</span>
                  <input
                    type="number"
                    min={0}
                    step={500}
                    inputMode="numeric"
                    placeholder="0"
                    value={goods || ''}
                    onChange={(e) => setGoods(Number(e.target.value) || 0)}
                  />
                </label>
              </div>
              <h4>この遠征の総額</h4>
              <span className="trip-big mono">{yen(c.total)}</span>
              <span className="trip-note">幅をみると {yen(c.lo)}〜{yen(c.hi)}</span>
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
                  <span className="pm mono">{yen(Math.ceil(c.hi / months / 100) * 100)}</span>
                </div>
              </div>
              <p className="trip-skip">
                この遠征を見送った場合、チケット以外で <b className="mono">{yen(c.total - ticket)}</b> が浮く計算です。
              </p>
            </aside>
          </div>

          <div className="trip-mapbox">
            <h4>地図で見る</h4>
            <ShioriMap
              venue={data.event.venue}
              stations={data.stations}
              routes={routes}
              shops={[...hpPicks.values()].map((sh) => ({ id: sh.id, name: sh.name, lat: sh.lat, lng: sh.lng }))}
            />
            <div className="shiori-legend">
              {routes.map((r, i) => (
                <span key={`${r.label}-${i}`}>
                  <span className={`shiori-swatch shiori-day-${i}`} />
                  {r.label}
                </span>
              ))}
              <span>★ 会場</span>
              <span>数字 寄り道の順番</span>
              <span>宿・駅・食（ご飯・カフェ）</span>
            </div>
            <span className="trip-note">線は、その日に回る順番をまっすぐ結んだものです（道順ではありません）。駅とご飯・カフェは線に入れていません。</span>
          </div>

          {hpPicks.size > 0 && (
            <div className="trip-day">
              <h4>ご飯・カフェの候補（料金は食事代の目安に含みます）</h4>
              <ul className="trip-tl">
                {[...hpPicks.values()].map((s) => (
                  <li key={s.id}>
                    <span className="h">・</span>
                    <span className="w">
                      {s.name}
                      <span className="trip-note"> {s.address}</span>
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      <div className="trip-bar">
        <div className="trip-bar-in">
          <div className="trip-bar-left">
            {showBack && (
              <button type="button" className="trip-btn ghost" onClick={backAction}>
                戻る
              </button>
            )}
          </div>
          <div className="trip-tot">
            <b className="mono">{yen(c.total)}</b>
            <span className="mono">{yen(c.lo)}〜{yen(c.hi)}</span>
          </div>
          <div className="trip-bar-right">
            {skipStayVisible && (
              <button type="button" className="trip-btn primary" onClick={() => setQStep(qStep + 1)}>
                宿は選ばずに次へ
              </button>
            )}
            {showPrimary && (
              <button type="button" className="trip-btn primary" onClick={barAction} disabled={barDisabled}>
                {barLabel}
              </button>
            )}
          </div>
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
