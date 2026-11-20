import type { LastTrainJudgment } from '@/lib/lastTrain.ts';

// 帰りの最終便に間に合うかのカード（scripts/last-train.mjs の表示を画面向けにしたもの）
export default function LastTrainCard({ judgment: j }: { judgment: LastTrainJudgment }) {
  return (
    <section className="section" aria-labelledby="t-last">
      <div className="section-head">
        <h2 id="t-last">日帰りできる？</h2>
        <span className="note">{j.to}まで新幹線で帰る場合</span>
      </div>
      <div className="card">
        {j.verdict === 'dayTrip' && j.best && (
          <p className="verdict ok">
            日帰りできる見込み：{j.best.station}
            {j.best.dep}発 {j.best.train}まで／終演が{j.best.latestEnd}までなら間に合う
          </p>
        )}
        {j.verdict === 'extraOnly' && (
          <p className="verdict ng">
            間に合うのは臨時列車だけ。運転日を確かめるまでは、後泊か夜行バスも考えておきましょう
          </p>
        )}
        {j.verdict === 'none' && (
          <p className="verdict ng">終演後の新幹線には間に合わない見込み。後泊か夜行バスを考えましょう</p>
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

        <p className="note">
          終演 {j.end}（{j.endIsEstimate ? '目安' : '指定'}）で判定。退場に{j.exitMinutes}分、駅の中の移動に
          {j.stationBufferMinutes}分をみています。
          {j.endIsEstimate && '終演時刻は公式の発表ではなく目安です。'}
        </p>
        {j.hasUnverified && (
          <p className="note">「時刻未確認」の便は、公式の時刻表で確かめてから当てにしてください。</p>
        )}
      </div>
    </section>
  );
}
