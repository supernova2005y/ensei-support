# このリポジトリでのルール

推し活遠征プランナー（仮称）の企画・調査・試作。中身は `README.md`。

## 書くときの注意

- 公開する予定なので、ユーザー本人の実際の旅程（何時の便に乗るか、どこに泊まるか）は書かない。試作のデータは、時刻や発着場所をぼかした目安にする
- 公演名・日付はぼかす（「公演A」「公演B」、文章では「10月の土曜」「前日・公演日・翌日」など）。データとテストの日付は、同じ曜日の別の日にする
- 実際に寄ったお店の名前は書かない。楽天などの API で取った施設名・料金は、そのまま保存しない（件数・料金の切れ目・目安にする）

## 作業の進め方

- **返答は日本語で書く**（見出し・表・説明文を含む）。ファイル名・コマンドなど固有の英語表記はそのままでよい
- **具体的な手段が決まったら、実行する前に解説して、ユーザーの OK を待つ。** 何を・どうやって・なぜ、を短く伝える。誤字の修正など小さい修正は、解説なしで進めてよい

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
