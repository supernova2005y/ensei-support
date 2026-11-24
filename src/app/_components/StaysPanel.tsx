'use client';

// 宿を探す画面。人数とグレードを選んで「空室を探す」を押すと、/api/stays（サーバー）経由で楽天トラベルを検索する。
// グレードは全部の宿を取ってから分けるので、グレードを選び直しても検索し直さない（人数を変えたら探し直す）。

import { useEffect, useRef, useState } from 'react';
import type { StaysResponse, StayMode } from '@/lib/rakuten.ts';
import {
  GRADES,
  HIDDEN_GEM_REVIEW,
  POOR_REVIEW,
  POOR_REVIEW_MIN_COUNT,
  previousDay,
  type Grade,
  type StayItem,
} from '@/lib/stays.ts';

const ADULT_OPTIONS = [1, 2, 3, 4];

// 「評価が高い」順に選ぶときの、評価の件数の下限（少ないうちは、★の平均が当てにならないため）
const RATED_MIN_COUNT = 10;

// 1つのグレードの宿を、最安2件と評価が高い2件に絞る（hotels は安い順）
function pickFour(hotels: StayItem[]): { cheap: StayItem[]; rated: StayItem[] } {
  const cheap = hotels.slice(0, 2);
  const rated = hotels
    .slice(2)
    .filter((h) => (h.reviewAverage ?? 0) > 0 && (h.reviewCount ?? 0) >= RATED_MIN_COUNT)
    .sort((a, b) => (b.reviewAverage ?? 0) - (a.reviewAverage ?? 0) || (b.reviewCount ?? 0) - (a.reviewCount ?? 0))
    .slice(0, 2);
  return { cheap, rated };
}

type State =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'error'; error: string; hint?: string }
  | { status: 'done'; data: StaysResponse };

const yen = (n: number) => `${n.toLocaleString('ja-JP')}円`;
const shortDate = (ymd: string) => {
  const [, m, d] = ymd.split('-').map(Number);
  return `${m}/${d}`;
};

// 探している間の段階。時間で切り替える目安（サーバーからは途中経過が届かないため、実際の進みではない）
const SEARCH_EXPECTED_MS = 15000;
const SEARCH_STEPS: { fromMs: number; label: string }[] = [
  { fromMs: 0, label: '楽天トラベルに問い合わせ中' },
  { fromMs: 4000, label: '空室の結果を受け取り中' },
  { fromMs: 10000, label: '宿を料金ごとに整理中' },
  { fromMs: 13000, label: 'もうすぐ終わります' },
];

function SearchProgress() {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    const start = Date.now();
    const timer = setInterval(() => setElapsed(Date.now() - start), 200);
    return () => clearInterval(timer);
  }, []);

  const step = [...SEARCH_STEPS].reverse().find((s) => elapsed >= s.fromMs) ?? SEARCH_STEPS[0];
  // 目安の時間に近づいたら、100%までは行かない（遅いときに「終わった」と見えないように）
  const percent = Math.min(95, (elapsed / SEARCH_EXPECTED_MS) * 100);

  return (
    <div className="stay-progress" role="status" aria-live="polite">
      <span className="stay-progress-label">{step.label}…</span>
      <div className="stay-progress-bar" aria-hidden="true">
        <span style={{ width: `${percent}%` }} />
      </div>
      <span className="note">15秒ほどかかります。このまま待ってください。</span>
    </div>
  );
}

// 宿の候補の1件。onSelect があるときだけ「この宿にする」を出す（寄り道の画面と組み合わせるとき）
function StayCard({ stay, selected, onSelect }: { stay: StayItem; selected?: boolean; onSelect?: () => void }) {
  return (
    <li className={`stay${selected ? ' stay-selected' : ''}`}>
      <span className="name">{stay.name}</span>
      <span>
        <span className="price">{yen(stay.total)}</span>
        {stay.perPerson !== undefined && <span className="pp">1人あたり{yen(stay.perPerson)}</span>}
      </span>
      <span className="review">
        {stay.reviewAverage ? `★${stay.reviewAverage}（${stay.reviewCount ?? 0}件）` : '★なし（評価がまだない）'}
      </span>
      <span className="access">{stay.access}</span>
      {onSelect && (
        <button type="button" className="stay-pick" aria-pressed={selected} onClick={onSelect}>
          {selected ? 'この宿を選びました ✓' : 'この宿にする'}
        </button>
      )}
      {stay.url && (
        <a className="book" href={stay.url} target="_blank" rel="noopener sponsored">
          楽天トラベルで予約する ↗
        </a>
      )}
    </li>
  );
}

export default function StaysPanel(props: {
  eventId: string;
  checkin: string;
  checkout: string;
  venueName: string;
  // 自分の公演で調べるときだけ入る（会場は eventId のものを使い、日付と時刻を差し替える）
  custom?: { date: string; start: string };
  // 楽天のキーがない環境のときだけ入る案内。入っていたら「空室を探す」を押せないようにする
  setupMessage?: string;
  // 選んだ宿（寄り道の画面と組み合わせるとき）。入っていれば、候補に「この宿にする」を出す
  selected?: StayItem | null;
  onSelect?: (stay: StayItem) => void;
  // 泊まり方（前泊なら、前日の夜から泊まる宿を探す）。既定は後泊
  stay?: StayMode;
}) {
  const [adults, setAdults] = useState(1);
  const [grade, setGrade] = useState<Grade>('リーズナブル');
  const [expanded, setExpanded] = useState(false); // 「もっと見る」で、そのグレードの全部を出す
  const [exHostel, setExHostel] = useState(true); // ホステルを除く（画面で選ぶ。既定は除く）
  const [exGuest, setExGuest] = useState(true); // ゲストハウスを除く
  const mode: StayMode = props.stay ?? 'after';
  const [checkIn, checkOut] =
    mode === 'before' ? [previousDay(props.checkin), props.checkin] : [props.checkin, props.checkout];
  const [state, setState] = useState<State>({ status: 'idle' });
  const abortRef = useRef<AbortController | null>(null);

  async function search(e: React.FormEvent) {
    e.preventDefault();
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setState({ status: 'loading' });
    try {
      const params = new URLSearchParams({ event: props.eventId, adults: String(adults), stay: mode, ...props.custom });
      const res = await fetch(`/api/stays?${params}`, { signal: controller.signal, cache: 'no-store' });
      const body = await res.json().catch(() => null);
      if (!res.ok || !body) {
        setState({
          status: 'error',
          error: body?.error ?? `サーバーがエラーを返しました（HTTP ${res.status}）。`,
          hint: body?.hint,
        });
        return;
      }
      setState({ status: 'done', data: body as StaysResponse });
    } catch (err) {
      if (controller.signal.aborted) return;
      setState({ status: 'error', error: '通信できませんでした。電波のよいところで、もう一度探してください。' });
      console.error(err);
    }
  }

  // 結果は泊まり方ごとに取っている。泊まり方が違う結果は出さず、「空室を探す」を押してもらう
  const fresh = state.status === 'done' && state.data.stay === mode;
  const staleMode = state.status === 'done' && !fresh;
  const lodgingKey = `${exHostel ? 1 : 0}${exGuest ? 1 : 0}`;
  const data = state.status === 'done' && fresh ? { ...state.data, ...state.data.variants[lodgingKey] } : null;
  const group = data?.grades.find((g) => g.grade === grade);
  const four = group ? pickFour(group.hotels) : null;

  const isSelected = (h: StayItem) =>
    props.selected !== undefined && props.selected !== null && (h.no ?? h.name) === (props.selected.no ?? props.selected.name);
  const renderCard = (h: StayItem) => (
    <StayCard
      key={h.no ?? h.name}
      stay={h}
      selected={isSelected(h)}
      onSelect={props.onSelect ? () => props.onSelect?.(h) : undefined}
    />
  );

  return (
    <section className="section" aria-labelledby="t-stay">
      <div className="section-head">
        <h2 id="t-stay">どこに泊まる？</h2>
        <span className="note">
          {shortDate(checkIn)}〜{shortDate(checkOut)}・素泊まりも含む最安のプラン
        </span>
      </div>

      <form className="form" onSubmit={search}>
        <div className="field-row">
          <label htmlFor="adults">人数</label>
          <select id="adults" value={adults} onChange={(e) => setAdults(Number(e.target.value))}>
            {ADULT_OPTIONS.map((n) => (
              <option key={n} value={n}>
                大人{n}名
              </option>
            ))}
          </select>
          <span className="note">1部屋に泊まる人数</span>
        </div>
        <fieldset>
          <legend>除く施設</legend>
          <label className="check">
            <input type="checkbox" checked={exHostel} onChange={() => setExHostel((v) => !v)} />
            ホステルを除く
          </label>
          <label className="check">
            <input type="checkbox" checked={exGuest} onChange={() => setExGuest((v) => !v)} />
            ゲストハウスを除く
          </label>
        </fieldset>
        <fieldset>
          <legend>宿のグレード</legend>
          <div className="opts">
            {GRADES.map((g) => {
              const info = data?.grades.find((x) => x.grade === g);
              return (
                <label key={g} className="opt">
                  <input
                    type="radio"
                    name="grade"
                    value={g}
                    checked={grade === g}
                    onChange={() => {
                      setGrade(g);
                      setExpanded(false);
                    }}
                  />
                  <span className="t">{g}</span>
                  {info && (
                    <span className="d">
                      {info.hotels.length}件
                      {info.min !== undefined && info.max !== undefined && ` ${yen(info.min)}〜${yen(info.max)}`}
                    </span>
                  )}
                </label>
              );
            })}
          </div>
        </fieldset>
        {props.setupMessage && (
          <div className="tip" role="note">
            <b>楽天トラベルAPI 取得待ち</b>
            <span>{props.setupMessage}</span>
          </div>
        )}
        <button className="btn" type="submit" disabled={state.status === 'loading' || Boolean(props.setupMessage)}>
          {data && data.adults === adults ? 'もう一度探す' : '空室を探す'}
        </button>
        <p className="note">グレードは、この日の空室の料金の切れ目で4つに分けています。</p>
        <p className="note">利用回数に上限を設けているため、空室を取得できないことがあります。</p>
      </form>

      {state.status === 'loading' && <SearchProgress />}

      {state.status === 'error' && (
        <div className="error" role="alert">
          <b>空室を探せませんでした</b>
          <span>{state.error}</span>
          {state.hint && <span className="note">{state.hint}</span>}
        </div>
      )}

      {staleMode && (
        <p className="note">泊まり方を変えました。「空室を探す」を押すと、この泊まり方の空室を探します。</p>
      )}

      {data && (
        <>
          {data.adults !== adults && (
            <p className="note">※ 下の結果は大人{data.adults}名で探したものです。人数を変えたら「空室を探す」を押してください。</p>
          )}
          <p className="note">
            {props.venueName}の半径{data.venueRadiusKm}km
            {data.stationNames.length > 0 &&
              `と、会場へ行きやすい駅（${data.stationNames.join('・')}）の半径${data.stationRadiusKm}km`}
            で探しました。空室のある施設 {data.vacantCount}件
            {data.rentalExcluded > 0 && `（民泊・アパート型など${data.rentalExcluded}件を除いています）`}
          </p>

          {data.soldOut && data.soldOut.bands.length > 0 && (
            <p className="note">
              空室のない施設が{data.soldOut.bands[data.soldOut.bands.length - 1].full}件ありました。
            </p>
          )}

          {group && (
            <div className="section">
              <div className="section-head">
                <h3>
                  {group.grade}
                  {group.min !== undefined && group.max !== undefined && `（${yen(group.min)}〜${yen(group.max)}）`}
                </h3>
                <span className="note">{group.hotels.length}件・安い順</span>
              </div>
              {four && group.hotels.length ? (
                expanded ? (
                  <>
                    <h3 className="sub-head">
                      このグレードの全部
                      <span className="note">（安い順）</span>
                    </h3>
                    <ul className="cards">{group.hotels.map(renderCard)}</ul>
                    <button type="button" className="btn ghost" onClick={() => setExpanded(false)}>
                      閉じる
                    </button>
                  </>
                ) : (
                  <>
                    <h3 className="sub-head">
                      最安
                      <span className="note">（安い順に2件）</span>
                    </h3>
                    <ul className="cards">{four.cheap.map(renderCard)}</ul>

                    <h3 className="sub-head">
                      評価が高い
                      <span className="note">（★が高い順。評価{RATED_MIN_COUNT}件以上）</span>
                    </h3>
                    {four.rated.length ? (
                      <ul className="cards">{four.rated.map(renderCard)}</ul>
                    ) : (
                      <p className="empty">評価が{RATED_MIN_COUNT}件以上ある宿は、このグレードにはありませんでした。</p>
                    )}
                    {group.hotels.length > four.cheap.length + four.rated.length && (
                      <button type="button" className="btn ghost" onClick={() => setExpanded(true)}>
                        もっと見る（残り{group.hotels.length - four.cheap.length - four.rated.length}件）
                      </button>
                    )}
                  </>
                )
              ) : (
                <p className="empty">このグレードで空室のある宿は見つかりませんでした。</p>
              )}
              {group.removedPoor.length > 0 && (
                <p className="note">
                  評判が明らかによくない宿（★{POOR_REVIEW}未満・評価{POOR_REVIEW_MIN_COUNT}件以上）は外しました：
                  {group.removedPoor.join('、')}
                </p>
              )}

              {grade === '奮発' && data.hiddenGems.length > 0 && (
                <>
                  <h3 className="sub-head">
                    評価が高いのに手頃
                    <span className="note">（ちょっとリッチの値段で★{HIDDEN_GEM_REVIEW}以上）</span>
                  </h3>
                  <ul className="cards">
                    {data.hiddenGems.map(renderCard)}
                  </ul>
                </>
              )}
            </div>
          )}

          {data.breaks.length > 0 && (
            <p className="note">
              グレードの境目：
              {GRADES.map((g, i) => (i === 0 ? g : `${data.breaks[i - 1] !== undefined ? yen(data.breaks[i - 1]) : '—'}〜 ${g}`)).join(' / ')}
            </p>
          )}
          {data.nights !== 1 && <p className="note">※ 料金は{data.nights}泊分の合計です。</p>}
          {data.adults > 1 && <p className="note">※ 料金は{data.adults}名分の合計です。</p>}
          {data.stationsNote && <p className="note">※ 駅から会場までの時間：{data.stationsNote}</p>}
          {data.notes.map((n) => (
            <p key={n} className="note">
              ※ {n}
            </p>
          ))}
        </>
      )}
    </section>
  );
}
