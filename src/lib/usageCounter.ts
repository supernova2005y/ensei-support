// 月ごとの呼び出し回数を、どの利用者からも同じように数える（サーバー側でだけ使う）。
// 本番では Upstash（REST）に数える。Upstash の設定がないときは、数えられないので、呼び出し自体を止める
// （上限を超えて料金がかかるのを防ぐため）。手元で試すときだけ、メモリに数える仕組みを使う。
// 使う側は places.ts の UsageCounter（used / add）と同じ形で呼ぶ。NAVITIME にも同じ仕組みを使う。

export interface MonthlyCounter {
  used(name: string): Promise<number>;
  add(name: string, n: number): Promise<void>;
}

// JST の「年-月」（例：2026-11）。月が変わると、数えるキーも変わる
export function monthOf(now: number = Date.now()): string {
  return new Date(now + 9 * 3600_000).toISOString().slice(0, 7);
}

const TTL_SECONDS = 40 * 24 * 3600; // 月が変わったあと、古いキーは消えてよい

export function monthlyKey(name: string, now?: number): string {
  return `count:${name}:${monthOf(now)}`;
}

// 手元で試すとき用：このプロセスの中だけで数える（本番の上限には使わない）
export function createMemoryCounter(clock: () => number = Date.now): MonthlyCounter {
  const values = new Map<string, number>();
  return {
    async used(name) {
      return values.get(monthlyKey(name, clock())) ?? 0;
    },
    async add(name, n) {
      const key = monthlyKey(name, clock());
      values.set(key, (values.get(key) ?? 0) + n);
    },
  };
}

// Upstash（REST）に数える。URL と Token は、Upstash の画面に出るものを使う
export function createUpstashCounter(
  opts: { url: string; token: string; fetchImpl?: typeof fetch; clock?: () => number },
): MonthlyCounter {
  const doFetch = opts.fetchImpl ?? fetch;
  const clock = opts.clock ?? Date.now;
  const base = opts.url.replace(/\/+$/, '');
  const fail = () => new Error('上限を数える仕組み（Upstash）に問題があります');
  async function post(path: string, body: unknown): Promise<unknown> {
    const res = await doFetch(`${base}${path}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${opts.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      cache: 'no-store',
    });
    const json = (await res.json().catch(() => null)) as unknown;
    if (!res.ok || json === null) throw fail();
    return json;
  }
  async function command(args: (string | number)[]): Promise<unknown> {
    const body = (await post('', args)) as { result?: unknown; error?: string };
    if (body.error) throw fail();
    return body.result;
  }
  return {
    async used(name) {
      const v = await command(['GET', monthlyKey(name, clock())]);
      return Number(v ?? 0) || 0;
    },
    async add(name, n) {
      // 増やすのと期限を付けるのを、1回の通信（pipeline）で送る
      const key = monthlyKey(name, clock());
      const results = (await post('/pipeline', [
        ['INCRBY', key, n],
        ['EXPIRE', key, TTL_SECONDS],
      ])) as { result?: unknown; error?: string }[];
      if (!Array.isArray(results) || results.some((r) => r?.error)) throw fail();
    },
  };
}

// 環境変数から選ぶ。Upstash がなければ null（呼び出しは止める）
export function counterFromEnv(env: Record<string, string | undefined> = process.env): MonthlyCounter | null {
  const url = env.UPSTASH_REDIS_REST_URL;
  const token = env.UPSTASH_REDIS_REST_TOKEN;
  if (url && token) return createUpstashCounter({ url, token });
  return null;
}
