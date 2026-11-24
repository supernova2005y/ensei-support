// ホットペッパーグルメ（グルメサーチAPI）で、乗り降りする駅の周りのお店を取る（サーバー側でだけ使う）。
// 規約（2026-11-24 に確認した範囲）：クレジット表示（Powered by ホットペッパーグルメ Webサービス）を出す。
// 店名・住所は保存しない（取った都度、画面に表示するだけ）。店名を第三者に再販しない。
// 返ってくるエラーは HTTP 200 のままなので、本文の results.error で判定する。

export const GOURMET_ENDPOINT = 'https://webservice.recruit.co.jp/hotpepper/gourmet/v1/';

// 検索範囲のコード（API の仕様：1=300m, 2=500m, 3=1km）
const RANGE_CODE: Record<number, string> = { 300: '1', 500: '2', 1000: '3' };

export interface HpShop {
  id: string;
  name: string;
  genre: string;
  address: string;
  lat: number;
  lng: number;
  budget: string; // 平均の予算（自由な文章のまま。例：「2001～3000円」）
  open: string; // 営業時間（自由な文章。公演の日に開いているかは、お店のページで確かめる）
  close: string; // 定休日（同上）
  access: string;
  url: string;
}

export class HotPepperError extends Error {
  hint?: string;
  constructor(message: string, hint?: string) {
    super(message);
    this.hint = hint;
  }
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown) => (typeof v === 'string' ? v : '');
const num = (v: unknown) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : NaN;
};

// 本文（JSON）から、お店の一覧を取り出す。形が合わない項目は捨てる
export function parseShops(body: unknown): HpShop[] {
  const results = isObj(body) && isObj(body.results) ? body.results : null;
  if (!results) return [];
  const shops = Array.isArray(results.shop) ? results.shop : [];
  return shops
    .filter(isObj)
    .map((s): HpShop => {
      const genre = isObj(s.genre) ? str(s.genre.name) : '';
      const budget = isObj(s.budget) ? str(s.budget.average) : '';
      const urls = isObj(s.urls) ? str(s.urls.pc) : '';
      return {
        id: str(s.id),
        name: str(s.name),
        genre,
        address: str(s.address),
        lat: num(s.lat),
        lng: num(s.lng),
        budget,
        open: str(s.open),
        close: str(s.close),
        access: str(s.access),
        url: urls,
      };
    })
    .filter((s) => s.id && s.name && Number.isFinite(s.lat) && Number.isFinite(s.lng));
}

// 駅の周りのお店を取る。range は 300・500・1000（m）のどれか
export async function fetchShops(
  key: string,
  center: { lat: number; lng: number },
  opts: { rangeM?: number; count?: number; fetchImpl?: typeof fetch } = {},
): Promise<HpShop[]> {
  const rangeM = opts.rangeM ?? 500;
  const range = RANGE_CODE[rangeM];
  if (!range) throw new HotPepperError(`検索範囲は ${Object.keys(RANGE_CODE).join(' / ')} m のどれかにしてください`);
  const params = new URLSearchParams({
    key,
    lat: String(center.lat),
    lng: String(center.lng),
    range,
    count: String(opts.count ?? 20),
    format: 'json',
  });
  const doFetch = opts.fetchImpl ?? fetch;
  let res: Response;
  try {
    res = await doFetch(`${GOURMET_ENDPOINT}?${params}`, { cache: 'no-store' });
  } catch {
    throw new HotPepperError('ホットペッパーに問い合わせできませんでした。少し待ってから、もう一度試してください。');
  }
  const body: unknown = await res.json().catch(() => null);
  const error = isObj(body) && isObj(body.results) ? body.results.error : undefined;
  if (!res.ok || error) {
    const first = Array.isArray(error) ? error[0] : error;
    const code = isObj(first) ? String(first.code ?? '') : '';
    if (code === '2000') {
      throw new HotPepperError(
        'ホットペッパーのキーが認められませんでした。',
        'HOTPEPPER_API_KEY を確かめてください（Vercel の環境変数も）',
      );
    }
    throw new HotPepperError('ホットペッパーからお店を取れませんでした。少し待ってから、もう一度試してください。');
  }
  return parseShops(body);
}
