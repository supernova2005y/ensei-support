import type { LastTrainJudgment } from '@/lib/lastTrain.ts';

// 帰りの最終便に間に合うかのカード（scripts/last-train.mjs の表示を画面向けにしたもの）
export default function LastTrainCard({ judgment: j }: { judgment: LastTrainJudgment }) {
  // 判定の見出しの頭に付ける「終演 21:00（目安）で」
  const endLabel = `終演 ${j.end}（${j.endIsEstimate ? '目安' : '指定'}）`;
  return (
    <section className="section" aria-labelledby="t-last">
      <div className="section-head">
        <h2 id="t-last">日帰りできる？</h2>
        <span className="note">{j.to}まで新幹線で帰る場合</span>
      </div>
      <div className="card">
        {j.verdict === 'dayTrip' && j.best && (
          <p className="verdict ok">
            {endLabel}で日帰りできる見込み：{j.best.station}
            {j.best.dep}発 {j.best.train}まで
          </p>
        )}
        {j.verdict === 'extraOnly' && (
          <p className="verdict ng">
            {endLabel}で間に合うのは臨時列車だけ。運転日を確かめるまでは、後泊か夜行バスも考えておきましょう
          </p>
        )}
        {j.verdict === 'none' && (
          <p className="verdict ng">{endLabel}では新幹線に間に合わない見込み。後泊か夜行バスを考えましょう</p>
        )}

        <ul className="trains">
          {j.results.map((r) => (
            <li key={`${r.train}-${r.station}`}>
              <span className="mark" aria-label={r.ok ? '間に合う' : '間に合わない'}>
                {r.ok ? '○' : '×'}
              </span>
              <span>
                <b>{r.train}</b> {r.station}
                <span className="mono">{r.dep}</span>発 → {r.arrival}
                {!r.regular && <span className="tag">臨時・運転日要確認</span>}
                {!r.verified && <span className="tag">時刻未確認</span>}
                <br />
                <span className="note">
                  終演が<span className="mono">{r.latestEnd}</span>までなら間に合う
                  {r.localDeparture
                    ? `（${r.localDeparture.station}${r.localDeparture.dep}発の電車に乗る）`
                    : `（会場→${r.station} 約${r.boardingMinutes}分）`}
                </span>
              </span>
            </li>
          ))}
        </ul>
        {j.unjudged.length > 0 && (
          <p className="note">
            判定できない便：
            {j.unjudged.map((u) => `${u.train} ${u.station}${u.dep}発`).join('、')}（会場から駅までの時間が未取得）
          </p>
        )}

        {j.hasUnverified && (
          <p className="note">「時刻未確認」の便は、公式の時刻表で確かめてください。</p>
        )}
      </div>
    </section>
  );
}
