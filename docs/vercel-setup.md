# Vercel で公開する手順

このアプリ（Next.js）を Vercel に置いて、スマホで開けるようにする手順です。
楽天のキーは Vercel の設定画面に入れます。コードやチャットには貼りません。

---

## 0. 先に用意するもの

- GitHub のアカウント（`supernova2005y`）
- 楽天ウェブサービスのアプリの情報（`.env` に書いたものと同じ）
  - アプリID
  - アクセスキー（`pk_` で始まる）
  - アフィリエイトID（なくても動きます）

---

## 1. Vercel に登録する

1. https://vercel.com/signup を開きます。
2. プランは **Hobby** を選びます（無料）。
3. 「Continue with GitHub」を押して、GitHub でログインします。
4. GitHub に「Vercel にアクセスを許可しますか」と聞かれたら、許可します。
   - リポジトリの選び方を聞かれたら、「Only select repositories」で `ensei-support` だけを選ぶと安心です。

---

## 2. リポジトリを取り込む

1. Vercel の画面で「Add New…」→「Project」を押します。
2. 一覧から `supernova2005y/ensei-support` の「Import」を押します。
   - 出てこないときは「Adjust GitHub App Permissions」から `ensei-support` を許可します。
3. 「Framework Preset」が **Next.js** になっていることを確かめます。
4. ほかの項目（Root Directory、Build Command など）は、そのままで大丈夫です。

### ブランチについて

- Vercel は、GitHub の **main ブランチ** を本番として公開します。
- アプリのコードが main 以外のブランチにある場合は、次のどちらかにします。
  - おすすめ：GitHub でプルリクエストを作り、main にマージする。
  - または：Vercel の「Settings」→「Environments」→「Production」で、本番にするブランチを変える。
- main 以外のブランチに push すると、「Preview（お試し版）」として別の URL で公開されます。

---

## 3. 環境変数（キー）を入れる

取り込みの画面の「Environment Variables」を開いて、次の4つを入れます。
あとから入れる場合は、プロジェクトの「Settings」→「Environment Variables」です。

| Key（名前） | Value（値） |
|---|---|
| `RAKUTEN_APPLICATION_ID` | 楽天のアプリID |
| `RAKUTEN_ACCESS_KEY` | 楽天のアクセスキー（`pk_` で始まる） |
| `RAKUTEN_AFFILIATE_ID` | 楽天のアフィリエイトID（なければ空のままでよい） |
| `RAKUTEN_REFERER` | `https://github.com/` |

### `RAKUTEN_REFERER` について

- 楽天のアプリ設定の「許可されたWebサイト」と、同じサイトを書きます。
- いまは `github.com` を登録しているので、`https://github.com/` と書きます。
- 楽天側の登録を変えたら、ここも同じものに変えます。

### 注意

- 値の前後に空白や改行を入れないでください。
- 環境変数を変えたら、**もう一度デプロイ** しないと反映されません（下の「5. やり直すとき」）。

---

## 4. デプロイして、スマホで開く

1. 「Deploy」を押します。1〜2分で終わります。
2. 「Congratulations!」の画面が出たら成功です。
3. 表示された URL（例：`https://ensei-support-xxxx.vercel.app`）を開きます。
4. スマホで開くには、次のどれかが簡単です。
   - パソコンの画面の URL を、自分宛てに LINE やメールで送る。
   - スマホで Vercel のサイトにログインして、プロジェクトの「Visit」を押す。
5. 公演を選び、「空室を探す」を押します。15秒ほどで宿の一覧が出ます。

### 「Vercel のログイン画面」が出るとき

- Preview（main 以外のブランチ）の URL は、最初は自分しか見られない設定です。
- 自分のスマホなら、Vercel にログインすれば見られます。
- ほかの人に見せたいときは、本番（main）の URL を使います。

---

## 5. やり直すとき（環境変数を変えた・エラーを直した）

1. プロジェクトの「Deployments」を開きます。
2. いちばん上のデプロイの「…」→「Redeploy」を押します。

---

## 6. エラーが出たとき

画面の赤い枠に、エラーの内容が出ます。

| 画面の表示 | よくある原因 | 直し方 |
|---|---|---|
| 「楽天APIのキーが設定されていません」 | 環境変数が入っていない | 3 の4つを入れて、5 でやり直す |
| 「HTTP 403」 | `RAKUTEN_REFERER` が楽天の「許可されたWebサイト」と違う | 楽天の登録を確かめ、`RAKUTEN_REFERER` を同じサイトにする（今は `https://github.com/`） |
| 「HTTP 503」 | アプリIDかアクセスキーが違う。または楽天に登録した直後 | 値をコピーし直す。登録直後なら、数分〜数十分待つ |
| 「HTTP 429」 | 短い時間に何回も探した | 1分ほど待ってから、もう一度探す |
| 「HTTP 400」 | 送った条件が楽天に受け付けられなかった | 画面の表示をそのままメモして、相談する |

もっと詳しく見たいときは、Vercel のプロジェクトの「Logs」で、エラーの記録を見られます。

---

## 7. お金と規約について

- **Vercel の Hobby プランは、個人の非商用の利用だけ** に使えます。
- 楽天アフィリエイトで収入が出るようになると、商用の利用になります。
- **収入が出始める前に**、Vercel の Pro プラン（有料）にするか、ほかのサーバーに移します。
- 楽天の規約で、楽天から取ったデータを、多くの人が共有する形で保存してはいけません。
  このアプリは、探すたびに楽天から取り、保存しない作りにしています。
- ページの一番下にある「Supported by Rakuten Developers」は、楽天ウェブサービスを使うときに必要な表示です。消さないでください。

---

## 8. 手元のパソコンで動かすとき（任意）

```sh
npm install
cp .env.example .env    # .env に楽天のキーを書く（.env は gitに載せない）
npm run dev             # http://localhost:3000 を開く
npm test                # グレード分けなどのテスト
```
