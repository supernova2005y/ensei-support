// 楽天トラベルへの検索の回数を、こちら側で絞る（サーバー側でだけ使う）。
//
// 楽天は回数の上限を公開していないが、短い時間に続けて呼ぶと 429 で一時的に止まる。
// 1回の「空室を探す」で楽天を10回前後呼ぶので、次の3つで絞る：
//   - 同じ人（IPアドレス）は PER_IP_INTERVAL_MS に1回、1日 PER_IP_DAILY 回まで
//   - 全体で同時に1件だけ（楽天は1秒おきに呼ぶ前提なので、検索が重なると 429 になる）
//   - 全体で1日 GLOBAL_DAILY 回まで
//
// 数はサーバーのメモリに持つ。Vercel は関数の箱（インスタンス）を複数立てることがあり、そのときは箱ごとに数えるので、
// 厳密な上限ではなく「ほぼ守られる」程度。厳密にするには外部の保存先（Upstash Redis など）が要る。
// 楽天の検索結果そのものは、ここでも保存しない（数えるのは回数と時刻だけ）。

export const PER_IP_INTERVAL_MS = 60_000;
export const PER_IP_DAILY = 10;
export const GLOBAL_DAILY = 200;
const BUSY_RETRY_MS = 60_000; // ほかの人の検索中に断ったとき、待ってもらう目安

export type Decision = { ok: true; release: () => void } | { ok: false; retryAfterMs: number; reason: 'busy' | 'perIp' | 'daily' };

interface IpRecord {
  last: number;
  count: number;
}

// 日付の切り替えは日本時間の0時
function dayKey(now: number): string {
  return new Date(now + 9 * 3600_000).toISOString().slice(0, 10);
}
function msUntilNextDay(now: number): number {
  const jst = now + 9 * 3600_000;
  return 86_400_000 - (jst % 86_400_000);
}

export function createLimiter(clock: () => number = Date.now) {
  let day = '';
  let globalCount = 0;
  let running = false;
  const ips = new Map<string, IpRecord>();

  return function tryAcquire(ip: string): Decision {
    const now = clock();
    const today = dayKey(now);
    if (today !== day) {
      // 日が変わったら数え直す（古い記録も捨てるので、メモリが増え続けない）
      day = today;
      globalCount = 0;
      ips.clear();
    }

    if (globalCount >= GLOBAL_DAILY) return { ok: false, reason: 'daily', retryAfterMs: msUntilNextDay(now) };

    const rec = ips.get(ip);
    if (rec) {
      if (rec.count >= PER_IP_DAILY) return { ok: false, reason: 'daily', retryAfterMs: msUntilNextDay(now) };
      const wait = rec.last + PER_IP_INTERVAL_MS - now;
      if (wait > 0) return { ok: false, reason: 'perIp', retryAfterMs: wait };
    }

    if (running) return { ok: false, reason: 'busy', retryAfterMs: BUSY_RETRY_MS };

    running = true;
    globalCount += 1;
    ips.set(ip, { last: now, count: (rec?.count ?? 0) + 1 });
    let released = false;
    return {
      ok: true,
      release: () => {
        if (released) return;
        released = true;
        running = false;
      },
    };
  };
}

// 断ったときに画面に出す文（「◯分後にもう一度」）
export function limitMessage(d: Extract<Decision, { ok: false }>): string {
  if (d.reason === 'daily') return '今日の検索の回数の上限に達しました。明日もう一度探してください。';
  const minutes = Math.max(1, Math.ceil(d.retryAfterMs / 60_000));
  return `いまは混み合っています。${minutes}分後にもう一度探してください。`;
}
