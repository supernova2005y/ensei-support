'use client';

// 日帰りの帰り：押したときだけ、会場から出発地までの経路を NAVITIME で調べて出す（/api/route）。
// 結果は保存しない（NAVITIME の規約）。画面を閉じたら消える。

import { useState } from 'react';
import type { HomewardRoute } from '@/lib/navitime.ts';

type State =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'done'; routes: HomewardRoute[]; to: string; credit: string }
  | { kind: 'error'; message: string };

const yen = (n: number) => `${n.toLocaleString()}円`;

export default function HomewardRoutes({ eventId, date, end }: { eventId: string; date: string; end: string }) {
  const [state, setState] = useState<State>({ kind: 'idle' });

  async function search() {
    setState({ kind: 'loading' });
    try {
      const params = new URLSearchParams({ event: eventId, date, end });
      const res = await fetch(`/api/route?${params}`, { cache: 'no-store' });
      const body = await res.json().catch(() => null);
      if (!res.ok || !body) {
        setState({ kind: 'error', message: body?.error ?? '経路を調べられませんでした。' });
        return;
      }
      setState({ kind: 'done', routes: body.routes ?? [], to: body.to, credit: body.credit });
    } catch {
      setState({ kind: 'error', message: '通信に失敗しました。少し待ってから、もう一度試してください。' });
    }
  }

  if (state.kind === 'idle' || state.kind === 'loading') {
    return (
      <div className="homeward">
        <button type="button" className="btn" onClick={search} disabled={state.kind === 'loading'}>
          {state.kind === 'loading' ? '調べています…' : '乗車駅までの行き方と運賃を調べる'}
        </button>
        <p className="note">終演の目安に退場の時間を足した時刻で、NAVITIME の経路検索を1回使います（回数に上限があります）。</p>
      </div>
    );
  }
  if (state.kind === 'error') {
    return (
      <p className="error" role="alert">
        {state.message}
      </p>
    );
  }
  return (
    <div className="homeward">
      <h3 className="sub-head">乗車駅までの行き方と、{state.to}までの運賃</h3>
      {state.routes.length === 0 ? (
        <p className="note">新幹線を使う経路が見つかりませんでした。</p>
      ) : (
        <ul className="trains">
          {state.routes.map((r) => (
            <li key={`${r.boarding}-${r.lines.join('-')}`}>
              <span className="mark" aria-hidden="true">
                ・
              </span>
              <span>
                <b>{r.boarding}</b>まで 約{r.minutes}分（{r.lines.join(' → ') || '徒歩'}）→ {r.train}
                <br />
                <span className="note">
                  {[r.fare.nonReserved && `自由席 ${yen(r.fare.nonReserved)}`, r.fare.reserved && `指定席 ${yen(r.fare.reserved)}`]
                    .filter(Boolean)
                    .join('・') || `乗車券 ${yen(r.fare.ticket)}`}
                </span>
              </span>
            </li>
          ))}
        </ul>
      )}
      <p className="note">
        所要時間は、乗り換えの待ちを平均で見込んだ目安です（時刻表ではありません）。運賃は会場の最寄り駅から{state.to}まで。
        {state.credit}
      </p>
    </div>
  );
}
