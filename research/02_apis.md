# 推し活遠征プランナー — 使えるAPI調査（機能一覧・料金比較）

調査日: 2026-10-17 ／ 対象市場: 日本 ／ 調査方法: 公式ドキュメント・料金ページを中心に Web 調査（一部は技術ブログ等の二次情報）

> **表記ルール**
> - ✅ = 公式ページで確認済み
> - 🔶 = 二次情報（技術ブログ・比較記事など）で確認。公式では未確認
> - ❓ = 未確認。推測や古い情報を含む。実装前に必ず確認すること
> - 価格はすべて調査日時点。USD は 1ドル≒150円 で概算した

---

## 0. 結論サマリー

### 0-1. 全体の見立て
- **宿は「楽天トラベル API」一択でMVPを始められる。** 個人でも無料で使え、空室・プラン料金・レビュー平均を返し、アフィリエイトリンクも自動で付く ✅。じゃらん Web サービスは2020年に新規登録を締め切っている ✅。Booking.com・Expedia・Agoda の API は審査・契約制で、個人のMVPには向かない。
- **電車の料金と所要時間を返すAPIは、日本では有料の国産APIしかない。** Google の Routes/Directions API は日本の公共交通ルートを返さない（ZERO_RESULTS）という報告が複数ある 🔶。候補は **NAVITIME API**（RapidAPI 経由で個人でも契約しやすい。月500回まで無料）と **駅すぱあと API**（Amazon の回数券 5,000回で 5,500円、またはフリープラン）。新幹線の特急料金・指定席料金まで分けて返すことを確認できたのは NAVITIME ✅。
- **高速バス・夜行バスの時刻と運賃を返す公開APIは見つからなかった。** 誘導はアフィリエイトリンクで行い、運賃の目安は LLM の Web 検索で取るしかない。
- **飛行機（国内線）**: 個人が使えるのは Duffel（予約API。従量課金）くらい。ANA/JAL の国内線をどこまで扱えるかは未確認 ❓。Skyscanner API は大手向けで、個人には出ない。MVPでは「駅すぱあと／NAVITIME の航空経路（所要時間・運賃の目安）＋予約サイトへのリンク」で足りる。
- **車（高速料金）**: NAVITIME の車ルート検索（route_car）が ETC 料金を返す ✅。Google Routes API の料金計算が日本に対応しているかは確認できなかった ❓。
- **飲食店**: **ホットペッパーグルメ API**（無料。個人可。クレジット表示が必要）を主軸にする。Google Places API (New) で補う。ぐるなび API は 2021年6月に有料化（月10万円・法人向け）🔶。食べログに公開APIはない。
- **展覧会・コラボカフェ・ポップアップ**: **構造化されたAPIはほぼない。** Tokyo Art Beat は1,300件以上の展覧会を載せているが、API は公開していない ✅。Ticketmaster・Songkick・Bandsintown は日本の公演データが薄いか、アクセスが制限されている。結局は **LLM の Web 検索ツール（Claude / OpenAI / Gemini）か Brave Search API** で拾い、出典リンク付きで見せるのが現実的。
- **LLM**: Web 検索ツールが 1,000回あたり 10ドル程度（Claude・OpenAI）。Gemini の Google 検索グラウンディングは月5,000回まで無料、その後 1,000回あたり 14ドル ✅。

### 0-2. MVPのおすすめ構成

| 役割 | 採用API | 理由 |
|---|---|---|
| 司令塔（LLM） | Claude Sonnet 5.5（重い処理）＋ Haiku 5.5（分類・整形） | ツール呼び出しと Web 検索・Web fetch が揃っている。Web fetch はトークン料金だけで追加料金なし |
| 宿 | 楽天トラベル 空室検索API | 無料。空室・料金・レビュー・地図座標・アフィリエイトリンクを一度に取れる |
| 鉄道・飛行機 | NAVITIME ルート検索(トータルナビ)（RapidAPI）※ 駅すぱあと 回数券型も候補 | 新幹線の運賃と特急料金を分けて返す。月500回まで無料 |
| 車 | NAVITIME 車ルート検索 | ETC 料金を返す |
| 高速バス | API なし → LLM Web 検索＋アフィリエイトリンク | — |
| 飲食 | ホットペッパーグルメAPI（主）、Google Places API (New)（補） | 無料で予算・ジャンル・座標で絞れる |
| 展覧会・コラボカフェ・地域イベント | Claude の Web 検索ツール（または Brave Search API） | 構造化APIがないため |
| 地図・ジオコーディング | Google Maps（Geocoding / Maps JS）または Yahoo! YOLP | 月1万回まで無料 |
| 天気 | 気象庁の公開データ（出典表示）／Google Weather API | 安い |
| 収益化 | 楽天アフィリエイト（楽天トラベル）、バリューコマース・A8.net（じゃらん・一休・高速バス 等） | — |

### 0-3. 月額コストの概算

**前提（1プラン作成あたり）**: LLM 入力 3万トークン・出力 5千トークン（Sonnet 5.5）、Web 検索 5回、楽天トラベル 3回、NAVITIME 3回、ホットペッパー 2回、Google Places 2回。

| 項目 | 1プランあたり | 個人プロトタイプ（月100プラン） | βテスト（月1,000プラン） |
|---|---|---|---|
| Claude Sonnet 5.5 トークン | 約0.11ドル（入力 0.06＋出力 0.05） | 約11ドル | 約110ドル（プロンプトキャッシュとHaiku併用で半分程度まで下げられる見込み） |
| Claude Web 検索 | 0.05ドル（5回 × 0.01ドル） | 約5ドル | 約50ドル |
| 楽天トラベル API | 0円 | 0円 | 0円 |
| NAVITIME（RapidAPI） | — | 300回 → Basic（無料、月500回） | 3,000回 → Pro（200ドル、月5,000回） |
| （代わりに駅すぱあと 回数券型） | 約1.1円/回 | 5,500円/5,000回（約2か月もつ） | 5,500円/月 前後 |
| ホットペッパー | 0円 | 0円 | 0円 |
| Google Places (Text Search Pro) | 約0.064ドル | 無料枠内（月5,000回） | 2,000回 → 無料枠内 |
| 地図・ジオコーディング | — | 無料枠内 | 無料枠内 |
| **合計の目安** | — | **月 約2,500〜3,000円**（約16〜20ドル） | **月 約5〜6万円**（約360ドル。NAVITIME を駅すぱあと回数券にすると約2.7万円） |

※ 公演日が同じユーザーが多いと、同じ会場・同じ日付の検索がかぶる。宿や交通の結果を短い時間キャッシュできれば、件数はかなり減らせる（ただし規約上キャッシュに制限のあるAPIがある。第4章参照）。

---

## 1. カテゴリ別の機能一覧・料金比較表

### 1-1. 宿泊

| API | 主な機能 | 日本の網羅性 | 料金 | 利用条件 | 2026年の状態 |
|---|---|---|---|---|---|
| **楽天トラベル API**（楽天ウェブサービス） | 施設検索（座標・地区・番号）、施設詳細、**空室検索（日付・人数・半径・料金上下限・朝食・禁煙・温泉などで絞り込み）**、キーワード検索、チェーン一覧、ランキング（総合・温泉・高級） | 国内最大級（楽天トラベル掲載施設） | 無料 ✅（規約上は将来有料にできる余地あり） | 楽天会員なら個人も可 ✅。1人5アプリまで | ✅ 稼働中。**2026-05-13 に旧ドメインが廃止され、新ドメイン(openapi.rakuten.co.jp)＋accessKey が必須に** 🔶 |
| じゃらん Web サービス | 宿表示・空室検索・エリア・温泉検索 | 国内大手 | 無料だった | — | ❌ **2020-02-25 で新規アカウント登録を終了** ✅ |
| Booking.com Demand API | 検索・空室・料金・予約 | 日本も対象 | 契約による（公開なし） | 「Managed Affiliate Partner」として契約が必要 ✅。2025年に小規模アフィリエイトを大量に打ち切り、Awin経由へ移行 🔶 | 稼働中（大口向け） |
| Expedia Rapid API（Hotels.com含む） | 地域・施設情報・空室検索・予約・予約管理・通知 | 日本も対象 | 手数料制。開発費は高い 🔶 | パートナー審査制。法人・実績が前提 🔶 | 稼働中（法人向け） |
| Agoda（Demand API / Affiliate Lite API） | Content / Search / Book / Pre-check / Post Booking | アジアに強い | 公開なし | Account Manager 経由でフィージビリティ審査・契約 ✅。Lite API にはサイトIDとAPIキーが必要 ✅ | 稼働中（審査制） |
| Google Hotels | — | — | — | 公開検索APIなし（Hotel Center は掲載側向け）✅。SerpAPI 等のスクレイピングAPIはある | 公式APIなし |
| Amadeus Self-Service | ホテル・航空検索 | — | — | Self-Service ポータルは **7月17日に終了**（2026年と推定）🔶。Enterprise のみ申込制 | ❌ 個人向けは終了 |
| Travelpayouts | 航空・ツアー等のデータAPIと送客 | 日本のホテルは弱い ❓ | 無料登録 | 誰でも登録可 🔶。ブランドごとに承認が必要 | 稼働中 |

### 1-2. 鉄道・交通の経路と運賃

| API | 主な機能 | 新幹線運賃 | 高速バス | 航空 | 料金 | 個人可否 |
|---|---|---|---|---|---|---|
| **NAVITIME API** | 電車＋徒歩の経路（トータルナビ）、車（**ETC料金**）、自転車、徒歩、地図、スポット検索、到達圏 | ✅ 乗車券・自由席・指定席・グリーンを分けて返す | ❓ 「バスを含む経路」はあるが、高速バスの扱いは未確認 | ✅ 航空を含む経路あり | RapidAPI: Basic 無料（月500回）、Pro 200ドル（月5,000回）、Ultra 300ドル（月1万回＋超過1回0.05ドル） ✅／直接契約は初期費用＋従量（要相談） | 法人向けとされるが、RapidAPI なら個人のクレカで契約できる 🔶 |
| **駅すぱあと API**（ヴァル研究所） | 経路探索、運賃計算、駅・路線、多言語 | スタンダード: 対応 ✅（新幹線の明記はなし ❓） | ❓ | フリーでも鉄道・航空の情報あり（制限つき）✅ | フリー 0円（結果は駅すぱあとの URL で返る）／回数券型 5,000回 5,500円・1万回 11,000円・2万回 22,000円（**時刻表ダイヤ探索は不可**、平均待ち時間の探索のみ）／スタンダード 初期＋従量（要問合せ、90日無料評価版あり）✅ | 個人可かは明記なし ❓（回数券は Amazon で購入）|
| ジョルダン 乗換案内Biz API | 経路検索 | ❓ | ❓ | ❓ | 非公開 | 法人向け 🔶 |
| **ジョルダン 乗換案内オープンAPI**（2026-10-19追記。初回の調査で見落としていた） | 経路検索（交通手段・運賃・所要時間） | ❓ 特急料金・指定席の内訳は未確認 | ✅ 高速バスを含む（駅名検索の区分に高速バス・空港連絡バス・フェリーがある） | ✅ 空路を含む | **無料**（利用登録と審査が必要。無料枠は月1種類3,000回・合計1万回との個人の記述あり 🔶） | 個人も可だが**一般に公開する用途に限る**（社内・私的な用途は不可）。**結果にジョルダン「乗換案内」へのリンクを必ず付ける**。公開前なら企画書の提出を求められるとの記述あり 🔶。**時刻表を考慮した経路ではない**との記述あり 🔶（終演後の最終便のような時刻の判断は苦手な可能性） |
|  | **仕様書（2018/07/04版）で確認したこと** ✅：経路検索（`sr`）の条件は出発地・到着地（駅・空港・バス停）とその区分、**日付（yyyymmdd）だけで、出発・到着の時刻は指定できない**。結果は経路ごとに所要時間・運賃・距離・乗換回数、区間ごとに運賃（`untin`）と**特急料金（`tokkyu`）・グリーン料金・寝台料金を分けて返す**。指定席と自由席の区別の項目は見当たらない。経路の種類として新幹線・のぞみ・特急・空路（`kuuro`）・バス・**高速バス（`kousoku`）**・深夜・フェリーの印があり、空路は航空会社名も返す。結果には乗換案内へのリンク（`jrdurl`）が付く。※仕様書の日本語の文字がこちらの環境では読めず、項目名と構造から読み取った | | | | | |
|  | **接続元の制限**（個人の解説記事より 🔶、2026-10-19追記）：ブラウザやスマホアプリから直接は呼べない。**審査に通ったあと、固定の接続元IPアドレスをジョルダンに伝え、そのIPからだけ呼べる**。アプリで使う場合は、固定IPのサーバー（記事ではさくらのVPS＋nginx の中継）を通す。アプリでの利用自体は、一般に公開する用途なら可（企画の内容による）。APIは http で提供され、呼び出し回数の上限があるのでキャッシュの検討が要る。→ **Vercel・Cloudflare Workers のようなサーバーレスは送信元IPが固定されないので、そのままでは使えない**（固定IPのオプションの有無と料金は要確認 ❓）。開発環境（Codespaces・自宅PC）からも、登録したIP以外からは試せない。 | | | | | |
| Google Routes / Directions API | 車・徒歩（日本対応）、公共交通（運賃フィールドあり） | ❌ 日本の公共交通は ZERO_RESULTS という報告（2025年8月、2026年7月）🔶 | ❌ | ❌ | Compute Routes Essentials 5ドル/1,000回（月1万回無料）、Pro 10ドル/1,000回（月5,000回無料）✅ | 個人可 |
| ODPT（公共交通オープンデータセンター） | 鉄道・バス・航空・船の時刻表、リアルタイム運行情報（JSON / GTFS） | ❓ JR東日本は関東の一部のみ | 路線バス中心 | 一部 | 登録無料 ✅ | 個人可 ✅（データごとにライセンスが異なる ❓） |
| 高速バス各社（バス比較なび、WILLER、高速バスネット、楽天トラベル高速バス 等） | — | — | 公開APIは見つからず | — | — | アフィリエイトのみ ❓ |
| Duffel | 航空券の検索・予約（Stays もあり） | — | — | 世界の航空会社。ANA/JAL国内線は ❓ | 確定1件 3ドル＋Managed Content 1%、検索が予約の1,500倍を超えると超過1回0.005ドル、為替2% ✅ | 誰でも登録可 ✅ |
| Skyscanner Travel API | 航空検索 | — | — | ✅ | 非公開 | MAU 10万以上などの審査。個人・学生は対象外 🔶 |
| Ignav（Amadeus の代替として登場） | 航空運賃検索・予約リンク | — | — | ❓ 日本国内線の網羅性は不明 | 1,000回無料、以降 2ドル/1,000回 🔶 | 可 🔶 |

### 1-3. 飲食店・スポット

| API | 主な機能 | 日本の網羅性 | 料金 | 条件 | 状態 |
|---|---|---|---|---|---|
| **ホットペッパーグルメ API**（リクルート） | 座標＋半径（300m〜3km）、予算、ジャンル、キーワード、個室・Wi-Fi などの条件、営業時間、平均予算、写真、URL | 国内の飲食店（ホットペッパー掲載店） | 無料 ✅ | 個人可。**クレジット表示（使っていることがわかるHTML）が必要** 🔶 | ✅ 稼働中（2026年6月にもメンテ告知あり） |
| **Google Places API (New)** | テキスト検索、周辺検索、詳細（営業時間・評価・写真・レビュー） | 非常に高い | Text Search Pro 32ドル/1,000回（月5,000回無料）、Place Details Essentials 5ドル（月1万回無料）・Pro 17ドル・Enterprise 20ドル ✅ | 個人可。**Google 以外の地図との併用禁止、緯度経度のキャッシュは30日まで、LLM へのコンテンツ投入に注意（第4章）** ✅ | 稼働中 |
| Maps Grounding Lite（Google、MCP） | 場所検索・天気・ルート（距離と時間のみ）を LLM に渡す | 高い | SKU ごとの従量課金 ✅ | **LLM に地図データを渡すための正式ルート** ✅ | 稼働中（GA かどうか ❓）|
| Yahoo! ローカルサーチ API（YOLP） | スポット検索、ジオコーダー、降水情報 | 国内 | 無料（1アプリ1日5万回まで）✅ | 個人可。**データで利益を得るサービスなどは不可・原則キャッシュ不可**（商用は別ページ確認）✅ | 稼働中（2022年に一部APIを終了）|
| ぐるなび API | レストラン検索 | 国内 | **月10万円（法人向け、3か月無料トライアル）** 🔶 | 法人のみ 🔶 | 2021年6月に有料化 🔶。公式ページは今回取得できず ❓ |
| 食べログ | — | — | — | **公開APIなし** ❓（スクレイピングは規約違反のおそれ） | — |
| Yelp Fusion | — | 日本は弱い ❓ | 有料化済み 🔶 | — | MVPでは不要 |

### 1-4. イベント・展覧会・公演

| API | 内容 | 日本の網羅性 | 料金・条件 | 判定 |
|---|---|---|---|---|
| Tokyo Art Beat | 展覧会1,300件超、アートスペース2,500件超 ✅ | 首都圏中心に全国 | **公開APIなし** ✅。提携は個別交渉になる ❓ | 将来の提携先候補 |
| ArtBeat API（NY Art Beat） | — | — | NY 版はサイト休止中 ✅ | ❌ |
| Ticketmaster Discovery API | イベント検索 | 日本は対象国の一覧で確認できず ❓（米欧豪が中心）| 1日5,000回・毎秒5回まで ✅ | ❌ 日本ではほぼ使えない見込み |
| Bandsintown API | アーティスト単位の公演 | 海外アーティストの来日公演は一部ある | **アーティスト本人か代理人が前提**。それ以外はメールで個別審査、学生・教育用途は不可 ✅ | ❌ |
| Songkick API | 公演データ | — | 新規受付は停止しているとの情報 ❓ | ❌ |
| Peatix | イベント | 小規模イベント | 公開検索APIは見つからず ❓ | ❌ |
| connpass | 勉強会 | IT 系のみ | — | 無関係 |
| ぴあ／イープラス／ローチケ | チケット販売 | 国内主要 | **公開APIなし** ❓。チケットぴあは楽天アフィリエイト（旧 Linkshare）でアフィリエイトあり 🔶 | リンク誘導のみ |
| 自治体オープンデータ（イベント情報） | 自治体ごとにばらばら | 一部の自治体のみ | 多くはCC BY 等 ❓ | 補助的 |
| **Brave Search API** | Web 検索（ニュース・画像等） | 日本語可 | Search 5ドル/1,000回、Answers 4ドル/1,000回＋トークン5ドル/100万。毎月5ドル分の無料クレジット ✅。**結果の保存は保存権つきプランのみ** ✅ | **展覧会・コラボカフェの主力候補** |
| SerpAPI | Google 検索結果の取得（Google Events / Google Hotels エンジンあり）✅ | 高い | 無料 月250回、25ドル/1,000回 〜 275ドル/3万回 ✅ | Google の規約上はグレー ❓ |
| LLM の Web 検索ツール | 下の 1-6 参照 | 高い | 10〜14ドル/1,000回 | **一番手軽** |

### 1-5. 地図・ジオコーディング・天気

| API | 料金 | 備考 |
|---|---|---|
| Google Geocoding | 5ドル/1,000回（月1万回無料）✅ | 日本のジオコーディング対応 ✅ |
| Google Maps JavaScript（Dynamic Maps） | 7ドル/1,000回（月1万回無料）✅ | — |
| Google Weather API | 0.15ドル/1,000回（月1万回無料）✅ | とても安い |
| Yahoo! YOLP（ジオコーダー・リバースジオコーダー・降水情報） | 無料（1日5万回）✅ | 商用条件を要確認 |
| 気象庁の公開データ | 無料 ✅ | 公共データ利用規約。**出典表示と、加工した場合はその旨の明記が必要** ✅。予報業務を自分で行うことは気象業務法の許可が必要 |
| Open-Meteo | 無料枠は**非商用のみ** ✅ | 商用プランは月100万回〜（価格はページに記載なし）|

### 1-6. LLM（Web 検索ツールつき）

| 提供元 | モデル | 入力 / 出力（100万トークンあたり） | Web 検索の料金 | 備考 |
|---|---|---|---|---|
| Anthropic | Claude Opus 5.5 | 4ドル / 20ドル ✅ | 10ドル/1,000回＋検索結果のトークン料 ✅ | Batch 50%引き、キャッシュ読み出しは入力の0.05倍 ✅ |
| Anthropic | **Claude Sonnet 5.5** | **2ドル / 10ドル** ✅ | 同上 | **Web fetch は追加料金なし（トークン代のみ）** ✅ |
| Anthropic | Claude Haiku 5.5 | 0.10ドル / 0.50ドル（10万トークン以下）✅ | 同上 | 10万トークン超は 0.50 / 2.50ドル |
| OpenAI | gpt-6-astra | 10ドル / 50ドル ✅ | 10ドル/1,000回 ✅ | 検索結果のトークンはモデルの料金で課金 |
| OpenAI | gpt-6.1-sol | 2ドル / 10ドル ✅ | 同上 | — |
| OpenAI | gpt-6-luna | 0.10ドル / 0.50ドル ✅ | 同上 | — |
| Google | Gemini 4 Argon | 2ドル / 10ドル（**2026-12-01 から 4ドル / 20ドルに値上げ**）✅ | Google 検索グラウンディング: 月5,000回まで無料、以降 14ドル/1,000回 ✅ | **Google マップのグラウンディングも同条件** ✅ |
| Google | Gemini 3.8 Flash | 0.75ドル / 3.75ドル（**2027-01-01 から 1.50 / 7.50ドル**）✅ | 同上 | 無料枠あり（ただしグラウンディングは無料枠では不可）|
| Google | Gemini 3.1 Flash-Lite | 0.25ドル / 1.50ドル ✅ | 同上 | — |

**ポイント**: 3社とも主力モデルの価格帯はほぼ同じ。Gemini は「Google マップのグラウンディング」で飲食店・スポットを規約上きれいに LLM に渡せるのが強み。Claude は Web fetch が追加料金なしで、展覧会ページの読み込みが安い。

### 1-7. アフィリエイト（収益化）

| プログラム | 対象 | ASP | 報酬 | 備考 |
|---|---|---|---|---|
| 楽天アフィリエイト | 楽天トラベル（宿・ANA/JAL楽パック・高速バス等）、楽天市場 | 楽天 | 楽天市場は商品ジャンル別に 2〜4%（2025年7月時点）🔶／楽天トラベルの料率は今回確認できず ❓ | **楽天APIの結果URLに自動でアフィリエイトIDが付く** ✅。楽天APIで稼げるのはこのルートだけ（規約）✅ |
| じゃらんnet | 宿 | バリューコマース 等 ❓ | 未確認 ❓ | API は使えないが、リンクでの送客は可能と見られる |
| 一休.com | 高級宿（「奮発」枠） | バリューコマース 等 ❓ | 未確認 ❓ | — |
| Booking.com | 宿 | Awin（2025年6月に移行）🔶 | — | 小規模アフィリエイトの切り捨てが起きた 🔶 |
| Agoda / Trip.com / Expedia / Hotels.com | 宿・航空 | Agoda Partners、Travelpayouts、Expedia Travel Creator Program 等 ❓ | 未確認 ❓ | — |
| 高速バス（バス比較なび、WILLER、楽天トラベル高速バス 等） | 夜行・高速バス | A8.net・バリューコマース 等 ❓ | 未確認 ❓ | API の代わりに誘導先として必須 |
| チケットぴあ | チケット | 楽天アフィリエイト（旧 Linkshare）のみ 🔶 | 未確認 ❓ | — |

※ 各ASPの料率はログイン後でないと見られないものが多い。β前に実際に登録して確認すること。

---

## 2. 各APIの詳細メモ

### 2-1. 楽天トラベル API（楽天ウェブサービス）✅
- **API一覧**: 施設検索、施設詳細、**空室検索**、地区コード、キーワード検索、チェーン一覧、ランキング。地区コード・チェーン一覧以外はアフィリエイト対応。
- **空室検索のエンドポイント**: `https://openapi.rakuten.co.jp/engine/api/Travel/VacantHotelSearch/20170426`
  - 必須: applicationId と accessKey、加えて施設番号・座標・地区コードのどれか。
  - 主な条件: チェックイン・チェックアウト日、大人・子どもの人数、部屋数、**半径 0.1〜3.0km**、**料金の上限・下限**、朝食・夕食・禁煙・大浴場・温泉などの絞り込み、並び替え、1ページ最大30件。
  - 返る内容: 1泊料金と合計、部屋名、プラン名、食事の有無、決済方法、**レビュー平均と件数**、最新レビュー、施設の最安値の目安。
  - **4グレードへの振り分け**: 料金上下限で4回呼ぶか、一度取ってから料金帯で分ける。レビュー平均・ランキング（高級ジャンル）も「奮発」枠の判定に使える。
  - 上限: 同じリクエストを短時間に何度も送ると一時的に止まる。超過時は HTTP 429。具体的な回数の上限は公開されていない。
- **2026年の大きな変更** 🔶: 旧ドメイン（app.rakuten.co.jp）は 2026-05-13 に廃止。新しい applicationId（UUID 形式）と accessKey（`pk_` で始まる）を取り直す必要がある。**Referer（または Origin）ヘッダー必須で、登録したサイトURLと一致しないと 403**。サーバーから呼ぶ場合は自分でヘッダーを付ける必要がある。
- **登録**: 楽天会員でログインし、アプリ名・URL・用途・想定QPSなどを登録。1人5アプリまで、アフィリエイトIDは1人1つ ✅。
- **規約の要点** ✅: 収益化は楽天アフィリエイト経由のみ（明示の許可がない限り）。楽天グループと競合するサービスは禁止。取得データを多数の人が共有できる形で保存するのは禁止。楽天のブランド表示（クレジット）が必要。

### 2-2. じゃらん Web サービス ✅
- 宿表示・空室検索・エリア・温泉検索の API があったが、**2020-02-25 に新規アカウント登録を終了**。既存のキーを持っていない限り使えない。
- ネット上には「個人でも使いやすい」と書く記事もある（2025年5月）が、公式ページの告知と矛盾するので、その記事は信用しない。

### 2-3. Booking.com / Expedia / Agoda / Google Hotels / Amadeus
- **Booking.com Demand API** ✅: Managed Affiliate Partner として登録し、契約後に Account Manager から Partner Centre の権限をもらって、API キーとアフィリエイトIDを発行する流れ。2025年5〜6月に、クリエイター・ブロガー系のアフィリエイトに一斉に契約終了の通知が出て Awin へ移行させられた 🔶。**個人の MVP では現実的でない。**
- **Expedia Rapid API** 🔶: 申込→承認→実装の認証→技術・商業審査の順。セルフ登録はない。業界の推計では実装に半年〜1年。法人向け。
- **Agoda** ✅: 「比較サイト向け（Search のみ）」「Agoda が決済まで代行」「自社で決済」の3つのモデル。フィージビリティ審査・契約・取引先登録が必要。Affiliate Lite API（都市IDまたはホテルIDと日付で料金と割引率を返す）もあるが、サイトIDとAPIキーは担当者経由 ✅。
- **Google Hotels** ✅: Google の Hotel Prices API は**掲載側（ホテル・OTA）が料金を送るためのもの**で、検索APIは公開されていない。SerpAPI の Google Hotels エンジンで取ることはできるが、Google の規約上はグレー。
- **Amadeus Self-Service** 🔶: ポータルは「7月17日」に終了（年は明記なし。2026年と推定）。今は Enterprise のみ申込制。**新規の候補から外す。**

### 2-4. NAVITIME API ✅
- **提供API**: 地図、ジオコーディング、ルート（トータルナビ＝電車＋徒歩）、車、自転車、徒歩、バイク、到達圏、交通情報、ドライブ情報など。
- **電車の運賃**: 公式の例（田町→名古屋）で、乗車券 6,380円と、特急料金の自由席・指定席・グリーン席を分けて返している。乗車券の区間と特急券の区間が違う場合も区間ごとに出る ✅。→ **「最安（自由席）」「快適（指定席）」の比較が作れる。**
- **車の料金**: `etc=use` で時間帯を考慮した ETC 料金。有料道路優先・無料道路のみなどの条件、スマートIC、車種区分を指定できる ✅。
- **契約形態**: ①直接契約（初期費用＋月額従量、交渉可。学術プランあり。オプション機能と技術サポートつき）②API マーケット（RapidAPI か SBI API Hub）。マーケットは API グループ単位の契約で基本機能のみ ✅。
- **RapidAPI の料金（全API共通）** ✅: Basic 無料（月500回、上限で停止、毎分50回）／Pro 200ドル（月5,000回、毎分100回）／Ultra 300ドル（月1万回、超過1回0.05ドル、毎分150回）。
- **注意**: 「法人向けサービス」と書かれている ✅。RapidAPI 経由なら個人のクレジットカードで契約できる見込みだが、規約上の個人可否は要確認 ❓。RapidAPI 版のトータルナビが運賃を返すかは RapidAPI のページで確認できなかった ❓（同じエンジンなので返す可能性は高い）。

### 2-5. 駅すぱあと API（ヴァル研究所。2024年2月に「駅すぱあと Webサービス」から改名）✅
- **フリー**: 0円。経路探索は結果を「駅すぱあと for Web」の URL で返すだけ（中身を自分のアプリで加工しにくい）。鉄道・航空の情報は制限つき。
- **回数券型（Amazon で購入）**: 5,000回 5,500円／1万回 11,000円／2万回 22,000円（約1.1円/回）。**時刻表に沿ったダイヤ探索はできず、平均待ち時間での探索のみ**。運賃と大まかな所要時間を出すのには使える。
- **スタンダード**: 初期費用＋従量（金額は非公開）。ダイヤ探索・定期区間の控除・IC運賃に対応。90日間の無料評価版あり。時刻表データの利用には別途ライセンス料がかかる場合がある 🔶。
- **エンタープライズ**: オンプレミス。要問合せ。
- 新幹線・高速バスの扱いはページに明記がない ❓。
- **2026-10-19追記** 🔶：フリープランは個人・学校向けとして続いている。2026年6月の個人ブログでは、申し込みから2日で利用環境ができ、APIキーで名古屋→高山の**所要時間と運賃を取得できた**（上の「結果はURLで返るだけ」と食い違うので、申し込んで確かめる）。時刻表（ダイヤ）に沿った探索はフリーでは使えない見込み。事前登録なしで試せる「駅すぱあと API Playground」がある。固定IPの制限があるかは未確認 ❓。

### 2-6. Google Routes / Directions API（日本の公共交通）
- 公式ドキュメント上は、公共交通ルートを「その地域で使える交通機関」で返し、全区間の運賃がわかる場合だけ運賃フィールドを返す ✅。
- ただし**日本では公共交通モードが ZERO_RESULTS になる**という報告がある（2025年8月の技術記事、2026年7月の Google 公式フォーラムの質問。後者は回答なし）🔶。Google の対応国一覧の日本の行にも公共交通の列はない（車・徒歩は対応）✅。
- 車ルートの有料道路料金計算が日本に対応しているかは、今回の調査では確認できなかった ❓。

### 2-7. ODPT（公共交通オープンデータセンター）✅
- 協議会の会員の交通事業者のデータ（鉄道・バス・航空・旅客船、リアルタイム含む）を共通の JSON 形式の REST API で提供。バスと船は GTFS もある。開発者登録は無料。
- JR東日本は関東の一部路線の遅延・在線情報などに限られる 🔶。新幹線の運賃・料金データがあるかは確認できなかった ❓。
- **使いどころ**: 経路と運賃の計算エンジンを自作するのは重すぎる。**当日の運行情報（遅延）の通知**などの補助用途向け。

### 2-8. 高速バス・夜行バス
- バス比較なび、WILLER、高速バスネット、楽天トラベル（高速バス）などの公開APIは見つからなかった。
- **代替**: LLM の Web 検索で「出発地→会場最寄り」の夜行バスの便と運賃目安を拾い、予約は各サイトのアフィリエイトリンクに飛ばす。表示時は「目安」と明記する。

### 2-9. 飛行機
- **Duffel** ✅: 登録してすぐ使える従量課金の予約API。確定1件 3ドル＋Managed Content 1%など。ただし国内線（ANA/JAL/LCC）の扱いが十分かは未確認 ❓。旅行業法との関係（予約の取次ぎ）は別途確認が必要。
- **Skyscanner** 🔶: MAU 10万以上などの条件があり、個人・学生・プロダクトのないスタートアップは対象外。
- **実務的には**: NAVITIME／駅すぱあとの航空経路で「所要時間と運賃の目安」を出し、予約は楽天トラベル（ANA/JAL楽パック）などのアフィリエイトに飛ばすのがMVP向き。

### 2-10. ホットペッパーグルメ API ✅
- グルメサーチAPI、店名サーチAPI、予算・エリア・ジャンル・クレジットカード・特集のマスタAPI。
- 座標＋半径（300m・500m・1km・2km・3km）、予算コード、ジャンル、キーワード、個室・コース・飲み放題・Wi-Fi などの条件で検索。1回最大100件。返す内容は店名・住所・座標・アクセス・営業時間・定休日・平均予算・写真・URL など。
- エラーでも HTTP 200 が返るので、本文でエラーを判定する必要がある。
- 2023年10月に旧API（api.hotpepper.jp）と JSONP を終了。現行は稼働中（2026年6月にメンテ告知）。
- 規約: 「ホットペッパーの API を使っている」ことを示すクレジット表示が必要 🔶。規約本体のページは今回取得できなかった ❓（呼び出し上限・キャッシュ・商用利用は要確認）。

### 2-11. Google Places API (New) ✅
- 料金（0〜10万回の単価）: Text Search Pro 32ドル、Enterprise 35ドル、Nearby Search Pro 32ドル、Place Details Essentials 5ドル・Pro 17ドル・Enterprise 20ドル（それぞれ1,000回あたり）。無料枠は SKU ごとに月 1,000〜10,000回。
- カフェ・コラボカフェの店舗・美術館の営業時間などを補うのに使う。コラボカフェの「開催期間」は持っていないので、Web 検索と組み合わせる。

### 2-12. ぐるなび API 🔶
- 2021年6月までは無料。その後は**月10万円・法人向け（3か月無料トライアルあり）**になったという記述がある。公式ページ（api.gnavi.co.jp）は今回アクセスできず未確認 ❓。**MVPでは使わない。**

### 2-13. 展覧会・コラボカフェ・地域イベント
- **構造化APIはほぼない**というのが今回の結論。
- Tokyo Art Beat（展覧会1,300件超）は API を公開していない ✅。将来の提携候補。
- コラボカフェ・ポップアップは、公式サイト・X（旧Twitter）・まとめサイトに散らばっている。**LLM の Web 検索＋Web fetch で「会場の都市・日付・推しの名前」で探し、出典リンクを必ず付ける**のが現実的。
- 推しのライブ日程も同様に、ファンクラブ・公式サイトから手入力か、メール（当選メール）の解析で取る。チケット各社のAPIはない。

### 2-14. Brave Search API ✅
- Search 5ドル/1,000回（毎秒50回）、Answers 4ドル/1,000回＋トークン料（毎秒2回）。毎月5ドル分の無料クレジットが自動で付く（ページ内に「最大20ドル」という別の記述もあり、食い違っている ❓）。
- **検索結果の保存や学習への利用は、保存権つきのプランのみ**。

### 2-15. LLM
- 料金は 1-6 の表の通り（各社の公式料金ページで確認）✅。
- **Claude**: Web 検索 10ドル/1,000回、Web fetch は追加料金なし。Batch で50%引き、プロンプトキャッシュの読み出しは入力単価の0.05倍（Sonnet / Opus 5.5）。
- **OpenAI**: Web 検索 10ドル/1,000回（推論しないモデルのプレビュー版は25ドル）。
- **Gemini**: Google 検索と Google マップのグラウンディングがそれぞれ月5,000回まで無料、その後 14ドル/1,000回。**Gemini 4 Argon は 2026-12-01、3.8 Flash は 2027-01-01 に値上げ予定**なので、コスト試算は値上げ後で見ておく。

---

## 3. 個人開発者が使えるか / 法人のみか

| 個人ですぐ使える | 個人でも使えそう（要確認） | 法人・審査制で個人には厳しい | 使えない |
|---|---|---|---|
| 楽天トラベル API（楽天会員）✅ | NAVITIME（RapidAPI 経由）🔶 | Booking.com Demand API ✅ | じゃらん Web サービス（新規登録終了）✅ |
| ホットペッパーグルメ API ✅ | 駅すぱあと 回数券型（Amazon）・フリー ❓ | Expedia Rapid API 🔶 | Amadeus Self-Service（終了）🔶 |
| Google Maps Platform（Places / Geocoding / Routes / Weather）✅ | ODPT（登録無料。データごとのライセンス ❓）| Agoda Demand / Lite API ✅ | Google Hotels（公式APIなし）✅ |
| Yahoo! YOLP ✅ | Duffel（登録は誰でも可。旅行業法の確認が必要）✅ | Skyscanner Travel API 🔶 | 食べログ（APIなし）❓ |
| Brave Search API ✅ | Travelpayouts 🔶 | 駅すぱあと スタンダード／NAVITIME 直接契約（法人向け）| Ticketmaster（日本のデータなし ❓）|
| Claude / OpenAI / Gemini API ✅ | SerpAPI（規約上グレー）| ぐるなび API（月10万円）🔶 | Bandsintown（アーティスト関係者のみ）✅ |
| 楽天アフィリエイト・A8.net・バリューコマース（個人登録可）| | ジョルダン 乗換案内Biz 🔶 | |

**メモ**: 宿の大手 OTA の API は**「アフィリエイトで十分な送客実績を作ってから API を申請する」**のが一般的な流れ。MVPは楽天＋アフィリエイトリンクで実績を作り、法人化後に Booking.com / Agoda に申し込むのがよい。

---

## 4. 規約上の注意

1. **楽天ウェブサービス** ✅
   - 収益化は楽天アフィリエイト経由のみ（明示の許可がない限り）。**有料サブスクの中で楽天データを見せるのが「収益化」に当たるか**は、プレミアム化を考えるときに楽天に確認が必要 ❓。
   - 楽天グループと競合するサービスは禁止。「宿予約の比較サイト」として他の OTA と並べて楽天を不利に扱う使い方は避ける。
   - 取得データを多くの人が共有できる形で保存するのは禁止 → **ユーザー間で結果をキャッシュして共有するのは避ける**か、ごく短時間にとどめる。
   - クレジット（ブランド表示）が必要。
2. **Google Maps Platform** ✅
   - Places のデータを **Google 以外の地図と一緒に表示するのは禁止**（Places UI Kit は例外）。
   - 緯度経度のキャッシュは最大30日。place_id はドキュメントに従ってキャッシュ可。
   - **Places のデータを LLM に渡して文章を作らせるのは、「Google マップのコンテンツから新しいコンテンツを作る」制限に触れるおそれがある。** 正式に LLM に渡すなら **Maps Grounding Lite**（または Gemini の Google マップのグラウンディング）を使い、出典リンクを内容のすぐ後に表示する。モデルの学習に使うのは禁止。
3. **ホットペッパー**: クレジット表示が必要 🔶。規約本体は要確認 ❓。
4. **Yahoo! YOLP** ✅: データで利益を得るサービス・特定ユーザー限定のサービスなどは許諾が外れる場合がある。原則として最新データを取得し、保存・キャッシュは不可。商用利用は別ページで要確認。
5. **NAVITIME（RapidAPI）**: 無料枠は「収益化前」の利用を想定していると読める ✅。商用での利用条件は RapidAPI の規約と NAVITIME に確認 ❓。技術サポートはなし ✅。
6. **気象庁**: 出典の表示と、加工した場合の明記が必要。独自の予報を出すことは気象業務法の許可が必要 ✅。
7. **Brave Search**: 結果の保存・学習利用は保存権つきプランのみ ✅。
8. **スクレイピング系（SerpAPI、Apify 等）**: 元サイト（Google、楽天、食べログ等）の規約に反するおそれ。**本番では使わない**前提にする。
9. **旅行業法**: アフィリエイトリンクで予約サイトに送るだけなら、旅行業登録はいらないと考えられている ❓。**自分のアプリ内で予約・決済まで行う（Duffel、Agoda の自社決済モデル等）と旅行業登録が必要になる可能性が高い** ❓。弁護士・観光庁への確認が必要。
10. **LLM の出力**: 運賃・空室は変わりやすい。「取得時刻」と「目安」を表示し、予約は必ずリンク先で確認してもらう形にする。

---

## 5. 取得できないデータと代替手段

| 取りたいデータ | APIで取れない理由 | 代替手段 |
|---|---|---|
| 高速バス・夜行バスの便と運賃 | 公開APIなし | LLM Web 検索で目安を取る＋予約サイトのアフィリエイトリンク。よく使う路線（地方→東京・大阪・名古屋・福岡）は手作業で目安表を作る |
| 国内線の航空券のリアルタイム価格 | Skyscanner は個人不可、Amadeus は終了 | NAVITIME／駅すぱあとの航空運賃（普通運賃の目安）＋楽天トラベル（ANA/JAL楽パック）のリンク。将来 Duffel を検討 |
| 新幹線の空席 | どのAPIも空席は返さない | えきねっと・スマートEXへのリンク |
| じゃらん・一休・Booking の空室と料金 | じゃらんは新規登録終了、ほかは審査制 | 楽天で比較し、ほかのサイトは「同じ宿をじゃらん/一休で見る」リンクで誘導 |
| 公演日によるホテル料金の高騰 | 過去の料金データはどのAPIにもない | **楽天の空室検索を定期的に呼んで自前で料金履歴をためる**（ただし保存・共有の規約に注意 ❓）。まずは「公演日」と「前後の日」の料金を同時に取って比べる |
| 展覧会の会期・内容 | 公開APIなし | LLM Web 検索＋Web fetch で美術館公式ページを読む。将来 Tokyo Art Beat 等と提携 |
| コラボカフェ・ポップアップ | 公開APIなし（多くは X や公式サイトのみ） | LLM Web 検索。ユーザー投稿（「この遠征で行ったカフェ」）を集める仕組み |
| 推しのライブ日程 | チケット各社のAPIなし | 手入力、当選メールの解析、カレンダー連携 |
| 食べログの評価 | APIなし | ホットペッパー＋Google の評価 |
| 地域のお祭り・イベント | 自治体ごとにばらばら | LLM Web 検索、自治体オープンデータ |

---

## 6. 出典一覧

### 宿泊
- [楽天ウェブサービス API 一覧](https://webservice.rakuten.co.jp/documentation)
- [楽天トラベル 空室検索API](https://webservice.rakuten.co.jp/documentation/vacant-hotel-search)
- [楽天ウェブサービス 規約](https://webservice.rakuten.co.jp/guide/rule)
- [楽天ウェブサービス ガイド](https://webservice.rakuten.co.jp/guide/)
- [楽天API 新ドメイン移行に関する記事（note）](https://note.com/appgroup/n/n674f8a098c9f)
- [楽天API 旧API廃止に関する記事（Qiita, 2026-07-15）](https://qiita.com/StreamSolty/items/2a2a203cbc37fefdc115)
- [楽天API エンドポイント変更（Zenn）](https://zenn.dev/milky/scraps/252296c031eb4b)
- [じゃらん Web サービス](https://www.jalan.net/jw/jwp0000/jww0001.do)
- [Booking.com Demand API Prerequisites](https://developers.booking.com/demand/docs/getting-started/prerequisites)
- [Booking.com のアフィリエイト Awin 移行（Net Influencer）](https://www.netinfluencer.com/booking-com-moves-all-affiliates-to-awin-what-to-know-about-termination-notices)
- [Agoda Demand API Getting Started](https://developer.agoda.com/demand/docs)
- [Agoda Affiliate Lite API v2.0（PDF）](https://partners.agoda.com/Content/Documents/AffiliateLiteApi/Affiliate_Lite_API_V2.0.pdf)
- [Expedia Rapid API の評価（Supergood）](https://supergood.ai/api-report-card/expedia-affiliate-network)
- [Google Hotel Prices API dev guide](https://developers.google.com/hotels/hotel-prices/dev-guide?hl=en)
- [Amadeus Self-Service 終了（Ignav）](https://ignav.com/docs/amadeus-self-service-shutdown)
- [Amadeus Self-Service ポータル終了（PhocusWire）](https://www.phocuswire.com/amadeus-shut-down-self-service-apis-portal-developers)
- [個人開発者向けホテルAPIまとめ（dev.to, 2025-05）](https://dev.to/kouta222/complete-guide-for-individual-developers-recommended-hotel-affiliate-apis-by-region-4c1e)
- [Travelpayouts API・データフィード提供ブランド](https://support.travelpayouts.com/hc/en-us/articles/20384016664594-Brands-that-provide-access-to-APIs-and-data-feeds-for-Travelpayouts-partners)

### 交通
- [NAVITIME API 製品ページ](https://api-sdk.navitime.co.jp/api/)
- [NAVITIME API RapidAPI での提供](https://api-sdk.navitime.co.jp/api/rakutenrapid/)
- [NAVITIME ルート検索の運賃の例（田町→名古屋）](https://api-sdk.navitime.co.jp/api/specs/tips/route_ex3.html)
- [NAVITIME 車ルート検索 API ガイド](https://api-sdk.navitime.co.jp/api/specs/api_guide/route_car.html)
- [NAVITIME Route(totalnavi) on RapidAPI](https://rapidapi.com/navitimejapan-navitimejapan/api/navitime-route-totalnavi)
- [駅すぱあと API プラン・料金体系](https://api-info.ekispert.com/plan/)
- [駅すぱあと API スタンダードと回数券型の違い（Zenn, 2026-06-17）](https://zenn.dev/ekispert_api/articles/3c6f3511f4f8b6)
- [駅すぱあと API ドキュメント](https://docs.ekispert.com/v1/)
- [駅すぱあと API への改名（BCN）](https://www.bcnretail.com/topics_detail9/20240226_404198.html)
- [Google Directions API が日本の電車に非対応という記事（Zenn, 2025-08）](https://zenn.dev/nnnwa/articles/6974e3799829ca)
- [Directions API transit が ZERO_RESULTS（Google Developer forum, 2026-07）](https://discuss.google.dev/t/directions-api-transit-mode-returns-zero-results/378267)
- [Google Maps Platform 対応国一覧](https://developers.google.com/maps/coverage?hl=en)
- [Routes API 公共交通ルート](https://developers.google.com/maps/documentation/routes/transit-route?hl=ja)
- [Routes API 通行料金の計算](https://developers.google.com/maps/documentation/routes/calculate_toll_fees?hl=en)
- [経路探索API比較（API図鑑, 2026-01）](https://api-zukan.com/blog/route-search-api)
- [公共交通オープンデータセンター 概要](https://www.odpt.org/overview/)
- [ODPT の GTFS データ利用記事（Zenn）](https://zenn.dev/takoyaki3/articles/25c036daaf0d75)
- [Duffel Pricing](https://duffel.com/pricing)
- [Skyscanner API Access（Ignav）](https://ignav.com/docs/skyscanner-api-access)

### 飲食・スポット
- [リクルート Webサービス トップ](https://webservice.recruit.co.jp/)
- [ホットペッパーグルメ API リファレンス](https://webservice.recruit.co.jp/doc/hotpepper/reference.html)
- [ホットペッパー API のクレジット表示に触れた記事（Zenn, 2023-06）](https://zenn.dev/moriatsu/articles/01376efeff30c0)
- [ぐるなび API 有料化に触れた記事（Zenn）](https://zenn.dev/okinanengineer/articles/8d2ef91c76b0a4)
- [Google Maps Platform 料金表](https://developers.google.com/maps/billing-and-pricing/pricing)
- [Google Maps Platform サービス別規約](https://cloud.google.com/maps-platform/terms/maps-service-terms)
- [Maps Grounding Lite](https://developers.google.com/maps/ai/grounding-lite?hl=en-GB)
- [Yahoo! YOLP Web API](https://developer.yahoo.co.jp/webapi/map/)

### イベント・検索
- [Tokyo Art Beat について](https://www.tokyoartbeat.com/aboutTAB)
- [NY Art Beat API ページ（休止）](https://nyartbeat.com/resources/doc/api)
- [Ticketmaster Discovery API v2](https://developer.ticketmaster.com/products-and-docs/apis/discovery-api/v2/)
- [Bandsintown API の利用条件](https://help.artists.bandsintown.com/en/articles/3372745-can-i-have-access-to-the-api-and-an-app-id-if-i-m-not-an-artist)
- [チケットぴあのアフィリエイト（Affilitizer）](https://www.affilitizer.com/programs/t.pia.jp)
- [Brave Search API](https://brave.com/search/api/)
- [SerpAPI Pricing](https://serpapi.com/pricing)

### 天気
- [気象庁ホームページの利用について](https://www.jma.go.jp/jma/kishou/info/coment.html)
- [Open-Meteo Pricing](https://open-meteo.com/en/pricing)

### LLM
- [Claude API 料金](https://platform.claude.com/docs/en/about-claude/pricing)
- [OpenAI API 料金](https://developers.openai.com/api/docs/pricing)
- [Gemini API 料金](https://ai.google.dev/gemini-api/docs/pricing)

### アフィリエイト
- [楽天アフィリエイトの料率の解説（エックスサーバー, 2025-07）](https://www.xserver.ne.jp/blog/rakuten-affiliate/)
- [バリューコマース 業界別アフィリエイト報酬相場（資料, 2026-05）](https://media-radar.jp/detail21583.html)

### 今回アクセスできなかったページ（要再確認）
- ぐるなび Web Service（https://api.gnavi.co.jp/api/）— アクセス許可がタイムアウト
- ホットペッパー 利用規約・ご利用案内 — 取得エラー
- NAVITIME API お知らせ・RapidAPI 料金ページ本体 — 取得エラー（料金は NAVITIME 公式の RapidAPI 案内ページで確認済み）
- Google Routes API 通行料金の対応国一覧 — 取得エラー
