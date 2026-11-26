'use client';

// 寄り道の候補がない公演で、泊まり方（日帰り・前泊・後泊）を選ぶ欄と、宿の画面。
// 日帰りを選ぶと、宿は探さない。候補がある公演では、泊まり方は寄り道の画面の中で選ぶ（TripPlanner）。

import { useState } from 'react';
import StaysPanel from './StaysPanel.tsx';
import LastTrainCard from './LastTrainCard.tsx';
import type { LastTrainJudgment } from '@/lib/lastTrain.ts';

type Mode = 'day' | 'before' | 'after';

const MODES: { id: Mode; title: string; note: string }[] = [
  { id: 'day', title: '日帰り', note: '朝に出て、終演後に帰る。宿代なし' },
  { id: 'before', title: '前泊（前日泊）', note: '前日の夜から泊まる' },
  { id: 'after', title: '後泊（公演日泊）', note: '公演日の夜から泊まる' },
];

export default function EventStays(props: {
  eventId: string;
  checkin: string;
  checkout: string;
  venueName: string;
  custom?: { date: string; start: string };
  setupMessage?: string;
  lastTrain?: LastTrainJudgment | null;
}) {
  const { lastTrain, ...stayProps } = props;
  const [mode, setMode] = useState<Mode>('after');
  const [picked, setPicked] = useState(false); // 泊まり方を選んだか（選んだら、帰りの便の判定は消す）

  return (
    <section className="section" aria-labelledby="t-mode">
      <div className="section-head">
        <h2 id="t-mode">泊まり方</h2>
      </div>
      {(!picked || mode === 'day') && lastTrain && <LastTrainCard judgment={lastTrain} />}
      <div className="opts">
        {MODES.map((m) => (
          <label key={m.id} className="opt">
            <input
              type="radio"
              name="mode"
              checked={picked && mode === m.id}
              onChange={() => {
                setMode(m.id);
                setPicked(true);
              }}
            />
            <span className="t">{m.title}</span>
            <span className="d">{m.note}</span>
          </label>
        ))}
      </div>
      {!picked ? null : mode === 'day' ? (
        <p className="note">日帰りなので、宿は探しません。</p>
      ) : (
        <StaysPanel {...stayProps} stay={mode} />
      )}
    </section>
  );
}
