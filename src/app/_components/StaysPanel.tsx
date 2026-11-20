'use client';

// 宿を探す画面。人数とグレードを選んで「空室を探す」を押すと、/api/stays（サーバー）経由で楽天トラベルを検索する。
// グレードは全部の宿を取ってから分けるので、グレードを選び直しても検索し直さない（人数を変えたら探し直す）。

import { useRef, useState } from 'react';
import type { StaysResponse } from '@/lib/rakuten.ts';
import { GRADES, HIDDEN_GEM_REVIEW, POOR_REVIEW, POOR_REVIEW_MIN_COUNT, type Grade, type StayItem } from '@/lib/stays.ts';

const ADULT_OPTIONS = [1, 2, 3, 4];

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

function StayCard({ stay }: { stay: StayItem }) {
  return (
    <li className="stay">
      <span className="name">{stay.name}</span>
      <span>
        <span className="price">{yen(stay.total)}</span>
        {stay.perPerson !== undefined && <span className="pp">1人あたり{yen(stay.perPerson)}</span>}
      </span>
      <span className="review">
        {stay.reviewAverage ? `★${stay.reviewAverage}（${stay.reviewCount ?? 0}件）` : '★なし（評価がまだない）'}
      </span>
      <span className="access">{stay.access}</span>
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
}) {
  const [adults, setAdults] = useState(1);
  const [grade, setGrade] = useState<Grade>('リーズナブル');
  const [state, setState] = useState<State>({ status: 'idle' });
  const abortRef = useRef<AbortController | null>(null);

  async function search(e: React.FormEvent) {
    e.preventDefault();
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setState({ status: 'loading' });
    try {
      const params = new URLSearchParams({ event: props.eventId, adults: String(adults), ...props.custom });
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

  const data = state.status === 'done' ? state.data : null;
  const group = data?.grades.find((g) => g.grade === grade);

  return (
    <section className="section" aria-labelledby="t-stay">
      <div className="section-head">
        <h2 id="t-stay">どこに泊まる？</h2>
        <span className="note">
          {shortDate(props.checkin)}〜{shortDate(props.checkout)}・素泊まりも含む最安のプラン
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
          <legend>宿のグレード</legend>
          <div className="opts">
            {GRADES.map((g) => {
              const info = data?.grades.find((x) => x.grade === g);
              return (
                <label key={g} className="opt">
                  <input type="radio" name="grade" value={g} checked={grade === g} onChange={() => setGrade(g)} />
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

      {state.status === 'loading' && (
        <p className="loading" role="status">
          楽天トラベルで空室を探しています（15秒ほどかかります）
        </p>
      )}

      {state.status === 'error' && (
        <div className="error" role="alert">
          <b>空室を探せませんでした</b>
          <span>{state.error}</span>
          {state.hint && <span className="note">{state.hint}</span>}
        </div>
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
            {data.rentalExcluded > 0 && `（民泊・アパート型の${data.rentalExcluded}件は除外）`}
          </p>

          {data.soldOut && (
            <div className="tip">
              <b>会場の周りで楽天に空室がない施設</b>
              <span className="mono">
                {data.soldOut.bands.map((b) => `${b.km}km以内 ${b.listed}件中${b.full}件`).join(' / ')}
              </span>
              {data.soldOut.nearFullNames.length > 0 && (
                <span>1km以内で空室なし：{data.soldOut.nearFullNames.join('、')}</span>
              )}
            </div>
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
              {group.hotels.length ? (
                <ul className="cards">
                  {group.hotels.map((h) => (
                    <StayCard key={h.no ?? h.name} stay={h} />
                  ))}
                </ul>
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
                    {data.hiddenGems.map((h) => (
                      <StayCard key={h.no ?? h.name} stay={h} />
                    ))}
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
