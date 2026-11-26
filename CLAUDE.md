# このリポジトリでのルール

推し活遠征プランナー（仮称）の企画・調査・試作。中身は `README.md`。

## 書くときの注意

- 公開版に載せるので、ユーザー本人の実際の旅程（乗る便・時刻、泊まった場所、実際に回った順番）は書かない。試作のデータは、時刻や発着場所をぼかした目安にする
- 公演名・店名は実名で書いてよい（2026-11-24 にユーザーが決めた範囲）。ただし、テストの日付は、同じ曜日の別の日にする
- API で取ったデータの扱い（2026-11-24 に規約を確認）：
  - **ホットペッパー**：お店の名前・住所は、データファイル（`data/` など）に保存しない。画面には、クレジット表示（「Powered by ホットペッパーグルメ Webサービス」）を必ず出す。店名を第三者に再販しない
  - **Google Places**：名前・住所・レビューは保存しない。place_id は保存してよい。緯度・経度は連続30日まで。表示は取得した都度にし、Google のロゴ・帰属表示を出す。Google のデータは Google 以外の地図に載せない。AI への入力に使わない。呼び出しは回数の上限で止める（`src/lib/places.ts` の仕組み）
  - **楽天**：空室・料金は保存しない（件数・料金の切れ目・目安のみ）。検索は回数の上限で止める（`src/lib/rateLimit.ts`）
  - **NAVITIME**（2026-11-26 に規約を確認。`docs/API規約メモ_NAVITIME.md`）：結果（経路・時刻・運賃・緯度経度）は、`events/`・`data/`・`out/` などに保存しない。表示は取得した都度にし、「NAVITIME」の表示を出す。呼び出しは回数の上限で止める（`src/lib/navitimeQuota.ts`）。所要時間を設定ファイルに入れるときは、人が乗換検索で確かめた値にする
- 寄り道候補のデータは、人が確かめた値（店名・公演名を含む）を `data/` に置いてよい。API から取った名前・住所は、そのまま置かない

## 作業の進め方

- **返答は日本語で書く**（見出し・表・説明文を含む）。ファイル名・コマンドなど固有の英語表記はそのままでよい
- **具体的な手段が決まったら、実行する前に解説して、ユーザーの OK を待つ。** 何を・どうやって・なぜ、を短く伝える。誤字の修正など小さい修正は、解説なしで進めてよい

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
