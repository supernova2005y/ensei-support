// Upstash（REST）につながるかを確かめるスクリプト。外部ライブラリは使わない。
// 使い方: .env に UPSTASH_REDIS_REST_URL と UPSTASH_REDIS_REST_TOKEN を書いてから
//   node scripts/upstash-check.mjs
// 確認用のキー（count:upstash-check:YYYY-MM）を1増やして読み戻し、今月の NAVITIME・Google Places の回数も表示する。
// 値（URL・トークン）は画面に出さない。

try {
  process.loadEnvFile('.env');
} catch {
  // .env がなければ環境変数だけを見る
}
const url = process.env.UPSTASH_REDIS_REST_URL?.replace(/\/+$/, '');
const token = process.env.UPSTASH_REDIS_REST_TOKEN;
if (!url || !token) {
  console.error('.env に UPSTASH_REDIS_REST_URL と UPSTASH_REDIS_REST_TOKEN がありません（.env.example を参照）');
  process.exit(1);
}

const month = new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 7);

async function call(path, body) {
  const res = await fetch(`${url}${path}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => null);
  if (!res.ok || !json || json.error) {
    console.error(`Upstash がエラーを返しました（HTTP ${res.status}）: ${json?.error ?? '本文なし'}`);
    if (res.status === 401) console.error('→ トークンが違います。REST API の欄の UPSTASH_REDIS_REST_TOKEN をコピーし直してください');
    process.exit(1);
  }
  return json;
}

const key = `count:upstash-check:${month}`;
const [incr] = await call('/pipeline', [
  ['INCRBY', key, 1],
  ['EXPIRE', key, 40 * 24 * 3600],
]);
const got = await call('', ['GET', key]);
console.log(`つながりました。確認用のキーは ${incr.result} 回目（読み戻した値: ${got.result}）`);

for (const name of ['navitime', 'nearby_pro', 'nearby_enterprise']) {
  const v = await call('', ['GET', `count:${name}:${month}`]);
  console.log(`  ${month} の ${name}: ${v.result ?? 0} 回（このアプリが数えた分だけ）`);
}
