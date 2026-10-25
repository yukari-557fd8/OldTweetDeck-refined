# 修正ロードマップ(upstream Issue 棚卸し: 2026-10-17 時点)

対象: [dimdenGD/OldTweetDeck](https://github.com/dimdenGD/OldTweetDeck) の open Issue 67 件(2026-10-17 に `gh issue list` で取得)。67 件すべてを下のいずれかの節に分類している。
本フォークは upstream `main`(8bcb4bb)+ 29 コミット(8d58466 時点)。

行番号は 92f0be5 時点の `src/interception.js`(Phase 1 の 1-a〜1-e だけは修正前の 97693c7 時点)。Phase 2〜8(f8dc681 / 31dc3bc / 582c857 / ce8b80e / 4d26629 / 017d2a7 / 6522d2c / a7c4cc5 / 8d58466)で変更したため、現在のファイルとは一致しない。`files/bundle.js`・`src/challenge.js`・`src/injection.js` の行番号はそのまま使える(`src/injection.js` は変更なし。`files/bundle.js` は Phase 5 で 3 行、Phase 8 で 20 行を同一行内で書き換えただけで行数は変わらず、`src/challenge.js` の変更は 92 行より後)。

分類の基準:

- **コードで直せる**: `src/interception.js` などこのリポジトリの変更で解決できる
- **X 側**: X の API 仕様・運用(凍結、レート制限、検索制限など)が原因で、拡張側では回避困難
- **upstream 依存**: Patreon 版の非公開スクリプトなど、このリポジトリに無いコードが原因
- **機能要望**: バグではない追加機能

---

## 0. すでにフォークで対応済み(upstream へ PR 候補)

| Issue | 内容 | フォークのコミット | 備考 |
|---|---|---|---|
| #554 | RTL 言語で `<html dir="rtl">` が残りレイアウト崩壊 | 01b1ed8 | 注入後に `dir=ltr lang=en-US` を固定。そのまま upstream PR にできる |
| #552 | Mentions が表示されない | 0eee9e5 | `mentions.json` の遅延を避け `all.json` から Mentions を組み立て。報告者の症状と一致するか要確認 |
| #509 / #530 / #531 / #536 ほか | Home の下端で追加取得が止まる、連携アカウントで cursor が引けない | 92f0be5 / bfcbdd3 | Phase 1。実機確認は問題なし(2026-10-17)。通知・Mentions は Phase 2 で対応済み。実機確認も問題なし |
| #550 / #547 / #511 系の一部 | 初回起動でスピナーのまま | 9e4b789 / e6d8e49 | limex 氏の upstream PR #562 を取り込んだもの。#562 は 2026-10-12 に作者自身が未マージで close している |
| #514(closed) | 通常ツイートが RT 表示になる | 6a8dad0 | `TweetWithVisibilityResults` の unwrap |
| #499 に近い症状 | 操作後にカラムが最新ポーリング分だけになる | 97693c7 | legacy poller のキャッシュを維持。#499(Hide this tweet で消える)にも効いているか要検証 |
| #488 / #487 の通知側 | 通知カラムの重複・欠落 | a46550b | poller 単位で「配信済み」判定。#488 の「自分や無関係な相手のいいねが出る」症状はこの修正の対象外で未検証。#487 の「更新されない」は Phase 2。実機確認は問題なし(2026-10-17) |
| #507 / #549 / #487 | 通知・Mentions に新着が届かない、「Loading…」のまま | f8dc681 | Phase 2。実機確認は問題なし(2026-10-17) |
| #520 / #435 / #563 / #497 / #427 / #387 / #131 / #496 | 広告ツール経由の投稿の欠落、動画カード、長文の see more、ミュート・ブロックの漏れ | 31dc3bc | Phase 3。実機確認は問題なし(2026-10-17)。#563 と #496 はコード変更なし |
| #545 / #428 / #197 / #533 / #548 / #505 | ブックマークの混在、アカウント別のデッキ保存、リストメンバー、ユーザー検索 | 582c857 | Phase 4。実機確認は問題なし(2026-10-17) |
| #550 / #547 / #511 / #518 / #512 / #498 / #501 / #381 / #338 / #106 | 起動・カラムの読み込みが終わらず理由も出ない、デスクトップ通知がすぐ消える、`x.com` のリンクが新規タブ | ce8b80e | Phase 5。実機確認は問題なし(2026-10-17) |
| (フォークで確認) | 通知カラムと Mentions カラムの更新がずれる、Home の更新間隔がばらつく、フォローのまとめ通知で古いフォロワーが上にあふれる | 4d26629 / 017d2a7 / 6522d2c | Phase 6。5 分間の HAR で間隔と 429 が出ないことは確認(2026-10-18)。2 カラムに同時に出ることの目視と、フォロー通知の実機確認は未了 |
| (フォークで確認) | Better TweetDeck を併用すると、Home などで認証済みのアカウントのバッジが消え、相互フォローバッジが通知・Mentions にしか出ない | a7c4cc5 | Phase 7。相互の行で認証バッジが隠れるのは BTD の仕様で、BTD のカスタム CSS で対処(2026-10-18 に確認) |
| (機能要望) | カラム設定「Tweet authors」に、相互フォローの相手だけを表示する選択肢が無い | 8d58466 | Phase 8。legacy が `followed_by` を捨てていたので `TwitterUser` に持たせ、「verified users」と同じ作りで「mutual follows」を追加。検索・イベントカラムには出さない。実機確認は問題なし(2026-10-19) |
| (フォークで確認) | X が GraphQL のクエリ ID を予告なく変える(`HomeLatestTimeline` は 2026-10-23 と 10-24 で別の ID)。features のキーが増えると要求が落ちる | e025999 | Phase 9。x.com 本体の JS から ID と features を実行時に拾い、送信直前に差し替える。ハードコードの値は退路。実機確認は問題なし(2026-10-24) |

---

## Phase 1: タイムライン取得の信頼性(完了)

**状態: 完了。実機確認も問題なし(2026-10-17)。** タイムライン取得は 92f0be5、会話モジュールの古いツイートを時系列の位置に残す変更は bfcbdd3。変更は `src/interception.js`、テストは `tests/home-scroll.test.cjs` と `tests/mentions-route.test.cjs`(send 時の cursor 選択に合わせて更新)。

実装の要点:

- Proxy に `beforeSend` フックを追加(`send()` 冒頭、ヘッダ確定後)。Home / notifications / mentions は `open()` を `beforeSend` まで保留し、`x-act-as-user-id` からユーザー ID を解決してから cursor 付き URL で開く(1-a)。
- Proxy の `get` トラップに `inspectResponse` を追加。legacy が `status` を読む瞬間に一度だけ応答を検査し、GraphQL エラーだけの 200 を 503 に変える(1-d)。
- ページ台帳 `timelinePages`(feed ごとに `{ids, bottom, top}`)を導入。ページ内の全 ID から cursor を引ける。会話モジュールは最新のツイート(返信)を残し、それより古いツイートはページの範囲内(新着取得では前回より新しいもの)だけを自身の ID の位置に残す(`threadTweetsInRange`、1-b)。Home / List / User に適用。92f0be5 では `receiveTime` で返信の直上に並べていたが、古いツイートが時系列を外れて表示されるため変更した。
- cursor が無い `max_id` 要求はネットワークに出さず 503 で即応答(1-c)。全件フィルタで空になったページは次の cursor に進める。
- `TD.controller.FeedPoller` をラップし `EXHAUSTED_API_THRESHOLD` を 1 に、refresh のたびに `intervalOfPossibility` を全域に戻す(1-d)。
- since ポーリングは 10 分に 1 回 cursor 無しで先頭を取り直す(`TOP_RESYNC_INTERVAL`)。`seenHomeTweets` は上限 2000 の Set(1-e)。List / User の `max_id` 要求が refresh throttle でキャンセルされていた問題も解消。
- 残課題は無い。`Math.random() > 0.6` の 40% キャンセル(1096 行)は意図的に残しており、実機で問題は出ていない。通知・Mentions の cursor-top は Phase 2 で外し、実機確認も問題なし(2026-10-17)。

対象 Issue: #509, #530, #531, #536, #487, #496, #495 / #517(無駄なリクエストによるレート制限悪化)。
upstream でも「Home の下端でスピナーが出続ける」「数時間前より古いツイートが出ない」という報告が複数ある(#509, #530)。
今回手元で起きた「下端での追加取得が重い」は X 側の一時的な負荷だったが、コードを追った結果、同じ症状を決定的に起こす経路が 3 つある。

以下 1-a〜1-e は修正前の分析(行番号は 97693c7 時点)。

### 1-a. 連携(Teams)アカウントの Home で cursor キーのユーザー ID が食い違う

- legacy TweetDeck は `x-act-as-user-id` ヘッダを `open()` の後、jQuery の `beforeSend` で付与する(`files/bundle.js` 4911-4917, 5037-5045)。
- OTD の Proxy は `open()` 時に `modReqHeaders = {}` をリセットしてすぐ `beforeRequest` を呼ぶ(`src/interception.js` 2920-2944)。そのため Home ルートの `beforeRequest`(848 行)ではヘッダが見えず `getCurrentUserId()`(デフォルトアカウント)に落ちる。
- 一方 `afterRequest` が cursor を保存するキーは `beforeSendHeaders`(897 行)で確定した実際のユーザー ID。
- 結果: 連携アカウントの Home では `home-<uid>-<id>` の cursor が**一度も引けない**。max_id 要求は毎回タイムライン先頭を取り直し(852-858 行)、legacy 側で interval 外として全部捨てられ、1 秒間隔で 5 回再試行(`bundle.js` 28503-28506, 29100-29115)した末に何も出ない。
- upstream は `user_timeline.json` だけ URL に `user_id` を足す bundle.js パッチで回避している(`bundle.js` 5269-5280)が、Home / notifications / mentions には無い。

対応:
- Proxy の `send`(2956 行)冒頭にルート用フック(例: `beforeSend(xhr)`)を追加し、ヘッダ確定後にユーザー ID を解決して `modUrl` を組み直す。
  `openHandler` は open を保留し、`beforeSend` で実際に `open()` する(その後の `readyState === 1` 判定と challenge ヘッダ付与はそのまま通る)。
- Home / notifications(1477 行付近)/ mentions(1668 行付近)の cursor 選択と throttle 判定を send 時に移す。

### 1-b. 会話モジュールの親ツイートが列の最下部に居座ると追加取得が止まる

- `home-conversation-*` の親ツイート(数時間〜数日前の古い ID)もそのまま返している。legacy は `sortIndex = receiveTime || id` で並べる(`bundle.js` 37566)ため、親が列の最下部になる。
- 無限スクロール時、legacy は最下部チャープの `id - 1` を `max_id` にし(`calculateUpperBound` / `getUpperBoundForChirp`、`bundle.js` 20180 付近)、取得結果を「最下部より古い」interval でフィルタする。次ページのツイートは親より新しいので**全部捨てられ、空ページとして 5 回再試行**(合計 6 リクエスト)、以後スクロールするたびに繰り返す。

対応:
- モジュール内のツイートに `receiveTime`(= 返信の ID から 1 ずつ引いた 19 桁文字列)を付け、スレッドを返信の直下にまとめる。
- ページ内の**全ツイート ID** に bottom cursor を記録する(現状は `tweets[tweets.length-1]` の 1 件だけ)。top cursor も同様。
- OTD 側のソートも `created_at`(秒精度)ではなく sort key で行う。

### 1-c. cursor 未解決の max_id 要求が「先頭ページの再取得」になる

- 1-a / 1-b を直せば通常は起きないが、起きたときに無駄なリクエスト(レート制限の消費)になる。
- 対応: cursor が無い max_id 要求はネットワークに出さず、`emulateResponse` に `_status` を立ててエラー応答にする(legacy は errback 経路なので再試行も exhausted 判定もしない)。

### 1-d. 10 件未満のページで無限スクロールが永久停止する

- legacy の `EXHAUSTED_API_THRESHOLD = 10`(`bundle.js` 31262, 31581-31584)。1 ページが 10 件未満だと `intervalOfPossibility` が切られ、リロードまでそのカラムの下方向取得が止まる。
- OTD は promoted / 広告 / ミュート / パース失敗を除外して返すので、X が短いページを返したときや GraphQL の 200 + `errors` で `[]` を返したときに該当する。
- 対応: `data.data.home` が無い応答で例外を投げない(今は `TypeError` でスピナーが残る)。エラーは `[]` ではなくエラーステータスで返す。短いページは bottom cursor を 1 回だけ追って補う、または home / list poller の閾値を下げる(`TD.controller.FeedPoller` をラップし、`keepLegacyPollerCache` と同じタイミングで適用)。

### 1-e. 新着ポーリング(since_id)の見直し

対象: #487, #496, #509, #530, #531, #536(Home / User カラムがリロードしないと更新されない)。

- `Math.random() > 0.6` で 35 秒以内のポーリングを 40% キャンセル(882 行)。
- cursor-top 使用時に X が新着を返さないケースの検証(upstream 報告ではデフォルトアカウントだけ更新されず、連携アカウントは更新される。1-a の食い違いで連携側は毎回先頭を取り直しているため、cursor-top 経路の方に問題がある可能性が高い)。
- `seenHomeTweets` が無限に伸びる(配列 `includes` で線形走査)。上限付きに変更。
- User カラム(#536)は `timings.user` と `xhr.storage.cursor` の条件を同じ観点で見直す。

### Phase 1 のテスト

- 自動テスト(済み): `tests/home-scroll.test.cjs` に 8 件。連携アカウントの cursor を send 時に解決すること、会話モジュールの古いツイートの扱い(ページ内と新着取得)と全 ID からの cursor 引き当て、全件フィルタで空のページは次へ進むこと、GraphQL エラーだけの 200 を失敗(503)として返すこと、since ポーリングの cursor と 10 分ごとの再同期、FeedPoller が短いページで止まらないこと、List の同等処理と未知の bound での即時失敗。`tests/mentions-route.test.cjs` は send 時の cursor 選択に合わせて更新。
- 実機(2026-10-17、問題なし): Home で古い元ツイートが時系列を外れないこと。連携アカウントの Home、会話モジュールを含むページの下端までの追加取得、同じ cursor の連続要求が無いこと、cursor-top の新着取得。

---

## Phase 2: 通知・Mentions の取得(完了)

**状態: 完了。実機確認も問題なし(2026-10-17)。** 対象 Issue: #507, #549, #487(通知側)。
Phase 1 の副作用を先に潰すために扱った。変更は f8dc681(`src/interception.js`)。自動テストは `tests/notifications-route.test.cjs` と `tests/mentions-route.test.cjs`。API エラーとレート制限の理由を画面に出すのは Phase 5 のまま。

### 2-a. cursor-top 付きの新着取得で、未読の通知が返らない疑い(#507, #487)

- 報告: #507「リプライなどの通知が数時間届かず、x.com を開いた瞬間にまとめて届く」。#487 のコメントに「モバイルで既読にするまで OTD に出ず、既読にした直後に出る」「一部の通知カラムは更新され、一部はされない」。
- 新着取得(since_id)は前回の応答の cursor-top を付けて `all.json` を取る(通知 1684-1689 行、Mentions 1893-1898 行)。Home の `TOP_RESYNC_INTERVAL`(752-764 行)に当たる cursor なしの取り直しは、通知・Mentions には無い。
- upstream(8bcb4bb)は open 時点で cursor を選ぶので、連携アカウントの要求にはログインアカウントの cursor が付いていた。X がそれを無効として先頭ページを返していたとすれば、「ログインアカウントの列だけ止まり、連携アカウントの列は更新される」という #487 の報告と合う。
- 見立て(報告どうしの一致による推定): `all.json` は cursor-top 付きだと未読の新着を返さず、公式クライアントで既読になると返すようになる。
- フォークへの影響: 92f0be5 で連携アカウントも自分の cursor-top を使うようになった。見立てが正しければ、連携アカウントの通知・Mentions も止まる。
- 実機(2026-10-17、問題なし): ログインアカウントと連携アカウントの両方で、通知と Mentions に新着が届く。

対応(実装済み):
- 通知・Mentions の since 取得は、保存済みの cursor-top を使わず、毎回 cursor なしで `all.json` の先頭を取り直す。Home の 10 分間隔では未読が届くまで待ちが残るため。1 ページ 20 件なので、ポーリングの間に 20 件を超えると取りこぼしうる。
- 重複は、通知は `notificationDeliveryFilter` が legacy の poller の `chirpIndex` で落とし、Mentions は legacy がツイート id で落とす。

### 2-b. 新着取得の応答で cursor-bottom を上書きしている

- 通知(1849-1856 行)・Mentions(1955-1962 行)とも、応答に cursor-bottom があればアカウントごとの 1 キーに無条件で保存する。
- 新着取得の応答にも cursor-bottom が含まれる場合、次の下スクロールは新着の直下から取り直しになる。全部重複で 0 件になり、legacy が exhausted と判定して下方向の取得が止まる(閾値を 1 にしても 0 件では止まる。interactions は `nonExhaustibleFeedTypes` に入っていない)。
- #507 のコメント「1 週間より古い通知が出ない」と関係している可能性がある。
- 対応(実装済み): cursor-bottom は初回と max_id 要求の応答からだけ保存する。since 取得の応答では上書きしない。ページ台帳は使っていない。

### 2-c. 通知カラムが「Loading…」のまま(#549)

- legacy は初回取得(backfill、`files/bundle.js` 28632)が成功すれば、0 件でも「No recent Tweets」に置き換える(`mergeAndRenderChirps`、29136)。「Loading…」が残るのは、要求がエラーで返ったときか、応答が返ってこないときだけ。パース失敗は `processActions`(43187)の try/catch で 0 件扱いになり、この症状にはならない。
- upstream の `interception.js` は 2026-03-18 から 09-16 まで変更が無い。8 月に出始めたのは、X 側の変化か、外部にホストされた solver / Patreon 版スクリプトの変化による。
- 原因の候補:
  1. 一部のアカウントで `all.json` 自体がエラーを返す(X 側の移行など)。未確認。
  2. 429(レート制限)。`all.json` の枠は x.com のタブと共有で、フォークでは Mentions も同じ枠を使う(0eee9e5)。
  3. challenge solver の失敗。`send()` の中で例外を投げ直す(3219-3227 行)ため XHR が送信も完了もされず、legacy の ajax にはタイムアウトが無いので永久に「Loading…」になる。ただしこの場合は全カラムに出るはず。
- 確定に必要な情報: 影響を受けた利用者の `all.json` のステータスと応答本文、コンソールのエラー。
- 対応: 3 は実装済み。`solveChallenge` が失敗したらリクエストを送らず、`failWithoutRequest` と同じく 503 で完了させる。1・2 の理由を画面に出すのは Phase 5。

### 2-d. 1 件の不正な通知でページ全体が空になる

- mention / reply / quote は、作者 `go.users[tweet.user_id_str]` があるか確かめずに渡している(通知 1776 行、Mentions 1934 行)。作者が `globalObjects.users` に無いと legacy の `TwitterActionMention.fromRESTData`(`bundle.js` 41613)が失敗し、`processActions` の try/catch がページ全体を 0 件にする。
- 対応(実装済み): `notificationTweet` で、作者または対象ツイートが無いエントリを飛ばす。引用先のツイートか作者が無いときは、その引用だけ外してエントリは残す。通知と Mentions の両方。いいね・RT の対象ツイートも同じ。

### Phase 2 のテスト

- 自動テスト(済み): since 取得が cursor を付けないこと、その応答で cursor-bottom を上書きしないこと、作者の無いエントリを飛ばし引用先が欠けてもページを空にしないこと、solver 失敗時に 503 で返しネットワークに送らないこと。`node --test tests/*.test.cjs` は 38 件通過。
- 実機(2026-10-17、問題なし): ログインアカウントと連携アカウントの両方で、通知カラムと Mentions カラムに新着が届くこと。下方向のスクロールが since 取得のあとでも続くこと。solver 失敗時に「Loading…」のまま止まらないこと。

---

## Phase 3: 表示・取りこぼし(完了)

**状態: 完了。実機確認も問題なし(2026-10-17)。** 変更は 31dc3bc(`src/interception.js`)。`node --test tests/*.test.cjs` は 45 件通過。

| Issue | 原因(確認済み / 推定) | 対応 |
|---|---|---|
| #520 "Twitter for Advertisers" 経由の投稿が Home から消える | `tweet.source` による除外。公式アカウントが広告ツールで投稿すると消える | 実装済み。source 判定は廃止。`entryId` に `promoted` を含むものか `promotedMetadata` があるものだけ除外 |
| #520 続き / #435 動画 unified card | 画像 unified card は summary card に変換済み。動画は TweetDeck が再生できない unified card のまま | 実装済み。動画と animated_gif は `extended_entities.media` のネイティブ動画にする。mp4 の variant が無いカードはそのまま |
| #563 動画が再生できない(2026-10-14) | 再生ウィンドウは `video_info.variants` の `video/mp4` のうち最高ビットレートを使う(`bundle.js` の `chooseVideoVariant`)。`bundle.js` は変えていない | 実機確認は問題なし(2026-10-17) |
| #497 長文の「see more」 | 長文は常に全文へ置き換えていた。TweetDeck は末尾が「…」のときだけ Expand tweet を出す | 実装済み。`OTDenableAutoExpand` が OFF のときは省略のまま。ON のときと、Expand が叩く `statuses/show` は全文 |
| #427 / #387 / #131 ミュート・ブロックが残る | Home と List だけが著者を落としていた | 実装済み。`tweetHidden` を Home / List / Search / 通知 / Mentions / 会話詳細に適用。RT の元著者も落とす。ミュートした人の引用は引用部分だけ外す。ユーザーカラムとブックマークは対象外 |
| #496 センシティブ設定のアカウントが Home に出ない | OTD に `possibly_sensitive` で落とす処理は無い。コメントの「Home が更新されない」は Phase 1 の症状と重なる | 実機確認は問題なし(2026-10-17) |

---

## Phase 4: マルチアカウント・状態保存(完了)

**状態: 完了。実機確認も問題なし(2026-10-17)。** 変更は 582c857(`src/interception.js`)。自動テストは `tests/bookmarks-route.test.cjs`、`tests/account-routes.test.cjs`、`tests/startup.test.cjs` に計 8 件追加。`node --test tests/*.test.cjs` は 53 件通過。

| Issue | 原因(確認済み / 推定) | 対応 |
|---|---|---|
| #545 Bookmarks が複数アカウントで混ざる | cursor と `bookmarkTimes` がツイート ID だけで、連携アカウントの `x-act-as-user-id` を見ていなかった | 実装済み。キーは `bookmarks-${userId}-${id}` と `${userId}:${id}`。下方向の cursor はヘッダが付いてから付ける |
| #428 アカウント切替でリスト・カラムが消える | `OTDcolumns` / `OTDfeeds` / `OTDsettings` / `OTDcolumnIds` がログインをまたいで一つ | 実装済み。ログインアカウント(`verifiedUser`)ごとに `OTDsettings:${id}` などへ保存する。Teams のカラムは分割しない。古いグローバルキーは、最初に開いたログインへ一度だけ移す |
| #197 ミュートリストが消える | 報告はキーワードミュート。設定の `global_filter` に入り、デッキと同じ保存先 | 実装済み。#428 のアカウント別設定に含まれる。アカウントのミュート ID(`mutes/users/ids.json`)は設定画面が x.com 側と案内しており、今回の対象外 |
| #533 / #548 リストメンバーの追加・表示 | `lists/members.json` と `lists/members/create.json` を GraphQL に変換していなかった | 実装済み。表示は `ListMembers`(`yQ_0-CTekcCY2oFRTskpSw`)。追加は `ListAddMember`、削除は `ListRemoveMember`、複数追加は `create_all.json`。query id は 2026-10 時点の x.com クライアント。メンバー画面は先頭 100 件だけ読む |
| #505 ユーザー検索で "does not exist" | `users/show.json` が廃止済み REST のまま | 実装済み。`screen_name` は `UserByScreenName`、`user_id` は `UserByRestId`。見つからないときは code 34 のエラーのまま |

### Phase 4 のテスト

- 自動テスト(済み): ブックマークの cursor と `receiveTime` がアカウントをまたがないこと。旧デッキが検証済みログインへ一度だけ移り、別ログインの保存がそれを上書きしないこと。`users/show` の変換と、いないユーザーが code 34 のままであること。リストメンバーの変換と、追加が user id を送ること。
- 実機(2026-10-17、問題なし): 二つのログインでカラムとキーワードミュートがそれぞれ残ること。ブックマークカラムがアカウントごとに並ぶこと。リストのメンバー表示と一人の追加。いるユーザーの検索が「does not exist」にならないこと。

---

## Phase 5: 起動・環境(完了)

**状態: 完了。実機確認も問題なし(2026-10-17)。** 変更は ce8b80e(`src/interception.js`・`src/challenge.js`・`files/bundle.js`)。`node --test tests/*.test.cjs` は 65 件通過。

| Issue | 原因(確認済み / 推定) | 対応 |
|---|---|---|
| #550 / #547 / #511 / #518 / #512 / #498 / #501 ロード中で止まる | 初回起動のハングの一つは 9e4b789(limex 氏の #562)で修正済み。残りの一つは、jQuery 2.1.4 の xhr transport がハンドラを外してから `responseText` を読むこと(`files/vendor.js` 2796 行)。ルートの `afterRequest` がそこで例外を投げると(429 の平文や HTML のエラーページを `JSON.parse` する verify_credentials など)、要求が完了しないまま残り、起動はスピナー、カラムは「Loading…」のままになる。失敗しても legacy は理由を出さない(401 / 403 は空のログイン画面、それ以外は "Error initializing TweetDeck") | 実装済み。`afterRequest` の例外は捕まえて JSON でない本文を返し、jQuery に parse error として失敗させる。起動とカラムの要求について失敗の理由(レート制限と解除時刻 / X のエラー / solver 失敗 / 読めない応答 / 401・403 / 通信)を記録し、起動前はログイン画面の文言に、起動後はトーストに出す(同じ理由とカラム種別で 5 分に 1 回、レート制限は解除時刻まで。401・403 と通信エラーはトーストにしない)。スピナーが 30 秒残ったら、失敗の理由か応答待ちの要求を Reload リンクと一緒にスピナーの下に出す。solver の iframe が読み込まれないときも 30 秒で失敗させる(`src/challenge.js`)。Phase 2-c の 1・2(#549 の「Loading…」)も同じトーストで扱う |
| #537 solver の "header not found" | ホスト版の `solver.html?4` は 2026-10-17 時点で header regex を使っておらず、このエラーは出ない(初期化の失敗は "Module ID not found" / "Default export not found") | 変更なし。solver が失敗したときは、上の仕組みでトーストかログイン画面に理由が出る |
| #381 / #338 Win11 でデスクトップ通知がすぐ消える | legacy が表示の 5 秒後に `close()` している(`TD.controller.notifications`、`files/bundle.js` 32239-32242 行)。Windows ではアクションセンターからも消える | 実装済み。`window.Notification` を差し替え、legacy の `onshow`(閉じるタイマーだけ)を無視する。表示時間は OS の設定に従う |
| #106 引用ツイートのリンクが新規タブ | `TD.util` の permalink 判定が `twitter.com` だけ(`files/bundle.js` 974 行)。いまの X は `x.com` の URL を返すので、ツイートへのリンクも外部リンク扱いになる。2023 年の報告と同じ原因かは未確認 | 実装済み。`x.com` と `www.` / `mobile.` も同じ扱いにする。`home` / `explore` / `i` など x.com のアプリのパスはユーザー名と見なさない。`/i/status/<id>` はツイートとして開く |
| #321 絵文字選択でフォーカス喪失(macOS Firefox) | UI。手元の環境で再現できない | 未対応(低優先度) |
| #528 Firefox Nightly / #493 署名 / #521 Win7 | パッケージング・配布 | 本フォークの範囲外 |

### Phase 5 のテスト

- 自動テスト(済み): `tests/failure-notices.test.cjs` に 7 件。読めない 429 でも要求が完了しログイン画面にレート制限と解除時刻が出ること、読めない 200 が parse error で失敗すること、起動後のトーストが理由とカラム種別ごとに 1 回であること、solver 失敗の理由がトーストに出ること、自前で返した失敗(cursor 無しなど)は理由に数えず GraphQL のエラーページは X のメッセージを出すこと、応答待ちの要求名と Reload がスピナーの下に出てログイン画面に替わったら止まること。`tests/desktop-notifications.test.cjs`(legacy の閉じるタイマーが付かない)、`tests/challenge.test.cjs`(iframe が読み込まれないときの失敗と、読み込まれたあとの 20 秒)、`tests/twitter-links.test.cjs`(`x.com` の permalink)。
- 実機(2026-10-17、問題なし): 通常の起動とカラムの読み込みに変化が無いこと(トーストが出ないこと)。デスクトップ通知が 5 秒で消えず OS の設定どおりに残ること。ツイート本文の `x.com/.../status/...` のリンクがカラム内で開き、`x.com/<ユーザー>` がプロフィールで開くこと。レート制限や X のエラーは狙って起こせないので、出たときに文言を確かめる。

---

## Phase 6: 通知・Mentions・Home の取得間隔とフォローのまとめ通知(実装済み)

**状態: 実装済み(4d26629 / 017d2a7 / 6522d2c)。** 2026-10-18 に 5 分間の HAR(4d26629 の時点)で、取得間隔と 429 が出ないことを確認した。通知カラムと Mentions カラムに同じ通知が同時に出ることの目視と、フォローのまとめ通知(6-d)の実機確認は未了。変更は `src/interception.js`。`node --test tests/*.test.cjs` は 81 件通過。

発端は、通知カラムと Mentions カラムを並べると片方が先に更新されること(2026-10-18)。あわせて、Home と通知を優先し、ブックマークは後回しにする方針で取得間隔を見直した。その後、フォローのまとめ通知の不具合(6-d)が見つかった。upstream の Issue には対応するものが無い。

### 6-a. 通知と Mentions の更新がずれる

- 両カラムとも `all.json` の先頭ページを読むが、legacy のタイマーが別々で、開始時刻も間隔も違っていた。
- 通知: legacy が `about_me.json` を feed type なしで要求する(`files/bundle.js` 43755 の `getInteractionsTimeline`)ため、レート制限ヘッダを読まない。既定の 45 秒を decider の `faster_notifications` が 15 秒に縮めた、固定の 15 秒だった。
- Mentions: ヘッダから間隔を計算する(下限 10 秒)。0eee9e5 で枠を 2 分の 1 に見せていたため、時間枠の後半ほど遅くなり、実際の残りが 22 回を切るとリセットまで止まった。
- 対応(4d26629): 同じアカウントの先頭ページの取得を 1 本にまとめる。取得中と取得後 5 秒以内の先頭ページ要求にはその応答を渡し、取得できたらもう一方の種別をすぐ更新してタイマーをリセットする。ヘッダの半減は削除した。

### 6-b. 取得間隔

| カラム | 変更前 | 変更後 | 15 分あたり(HAR の実測) |
|---|---|---|---|
| Home | legacy は約 5 秒ごと。35 秒以内の新着取得の 40% をランダムに捨てていた(upstream ed5432c) | 捨てない。下限 4 秒 | 約 225 回(枠 500) |
| 通知・Mentions | 固定 15 秒 / 下限 10 秒 | 通知もヘッダを読む。下限 7 秒 | 約 128 回(枠は all.json で 180、6-e の GraphQL で 1500) |
| ブックマーク | 下限 4 秒(枠を 5 分の 1 に見せる処理はそのまま) | 下限 60 秒 | — |

- 下限は localStorage で秒単位に上書きできる: `OTDhomeRefreshSeconds` / `OTDnotificationsRefreshSeconds`(通知と Mentions)/ `OTDbookmarksRefreshSeconds`。
- legacy のスケジューラは 1 秒ごとに判定するので、実際の間隔は下限〜下限 + 1 秒。
- `faster_notifications` は、通知がヘッダを読むようになった後は「枠を使い切っても 15 秒ごとに取りに行き 429 を受け続ける」効果しか残らないため、decider で無効にした(017d2a7)。

### 6-c. 調査結果(2026-10-18 の HAR)

- `NotificationsTimeline`(GraphQL、`EUX2EwvgT4f9F7sC4A59Eg`)の「All」は、`all.json` と同じ 20 件を返す(`entryId`・`sortIndex` まで一致)。「Mentions」(`timeline_type: "Mentions"`)は cursor なしの先頭ページが約 4 時間遅れ、cursor-top 付きの取得で追いついた(`mentions.json` と同じ症状)。
- レート制限は `NotificationsTimeline` が 1500 回 / 15 分で x.com と共有、`all.json` は 180 回 / 15 分で x.com は使っていない。新着の速さは変わらないので、移行は見送った。`all.json` が廃止されたときの切り替え先にはできる。通知の形(`TimelineNotification` の `template.from_users` / `target_objects`、`TimelineTweet` の `tweet_results`)は既存の `legacyUserFromGraph` / `safeParseTweet` で変換できる。引用通知の形は未確認。
- x.com のフォロー中タブは、放置中にホームを取得しない(3 分半で 0 回)。ピリオドキーでは約 1 秒間隔で取得し、すべて 200。通知は未読数(`ViewerBadgeCounts`)を 30 秒ごとに見るだけ。
- `HomeLatestTimeline` の枠は GET と POST で別。OTD(GET、当時 `cWF3cqWadLlIXA6KJWhcew`)と x.com の GET(`NmDBT3APtNxDpMqIEauu7A`)は同じ枠を使っているとみられる(推測)。
- Home のクエリ ID は 2026-10-23 の HAR(フォロー中タブ)に合わせて `hB-6CNtJdReMJny7IPMoQQ` に更新した(翌 10-24 には `KQPfcqQJJqF6M0D77p3JKw` に変わっていた。以後は Phase 9 で自動追従)。x.com は POST で `variables` に `enableRanking: false` と `seenTweetIds`、`fieldToggles` に `withPayments: false` を付け、`features` はリストメンバー取得と同じ 40 項目。枠は 500 回 / 15 分。OTD は GET のまま、`seenTweetIds` は送らない。ユーザーは `legacy` を持たず `core` / `avatar` / `relationship_perspectives` に分かれて返る(Phase 7 の変換で対応済み)。
- 同じ HAR で、x.com の計測ログは `/i/jot` ではなく `POST /i/api/1.1/flow/timeline.json`(`debug=true&log=[client_event...]`、応答は空の 200、枠 2000 回 / 15 分)に送られていた。タイムラインの取得とは無関係で、OTD は使わない。

### 6-e. 通知の取得元を GraphQL `NotificationsTimeline` に切り替えた(2026-10-23)

- 調査(x.com の通知ページと OTD の HAR を同じツイート・同じ時刻のまとめで突き合わせ): `all.json` は最新のいいねの通知に過去のいいねした人を詰め込んで返す(配列は 10 人まで、本文は「他 80 人」)。x.com 本体が読む GraphQL の `NotificationsTimeline`(`PV7uQNNsuQhCB2vjo4WJGA`、`timeline_type: "All"`、`count: 20`)は同じ通知を最新の人だけで返す。6-c の「同じ 20 件」はエントリの並びの話で、`from_users` の中身は違っていた。
- このため、通知カラムがまだ取得していないいいねのまとめが届くと、過去の全員が最新の時刻で一度に先頭へ並んでいた(いいね・RT は 6-d の絞り込みの対象外)。GraphQL に切り替えると、新着確認で届くのは本当に新しい人だけになる。
- 実装: `notificationsUrl` が GraphQL の URL を作り、`notificationsPage` が応答を `all.json` と同じ形(`entries` + `globalObjects`)に直してから既存の解析に渡す。ユーザーは `legacyUserFromGraph`、ツイートは `parseTweet` で v1.1 形に変換する。`all.json` の応答もそのまま読めるので、`localStorage.OTDnotificationsSource = "all.json"` で旧経路に戻せる。GraphQL のエラー本文だけの 200 は `inspectResponse` で失敗として扱う。
- 枠は 1500 回 / 15 分で x.com 本体と共有。カーソルの扱い(新着確認は cursor なしで先頭を読む、下スクロールは bottom)は変えていない。
- どちらの API も一人ひとりの時刻は返さない。`from_users` は 10 人まで、「○○さんが 7 件のあなたのポストをいいねしました」の `target_objects` は 1 件だけで、これらは変わらない。
- 実機確認(2026-10-23 15:55、OTD と x.com の HAR を同時刻に取得): OTD の `NotificationsTimeline` は 7 秒ごとに 16 回すべて 200、先頭ページは x.com 本体が同時に受けたものと `entryId`・`sortIndex` まで一致。枠の残数は両者で交互に減り、共有を確認。新着のいいねは既存のまとめ(5 人 → 6 人、時刻は最新に移動、ID は同じ)として届き、OTD は配信済み判定で新しい 1 人だけを列に渡した。
- x.com 本体は 30 秒ごとに cursor-top 付き(`count: 40`)で新着確認し、変化が無ければカーソル 2 件だけ(約 1KB)、変化があればそのまとめ 1 件だけが返る。OTD は cursor なしで先頭ページ(約 130KB)を 7 秒ごとに読み直している。all.json で疑われた cursor-top の取りこぼし(#507 / #487)が GraphQL でも起きるかは未確認。起きないなら cursor-top に変えて転送量を減らせる。
- 未確認: GraphQL の `users_followed_you` と `users_retweeted_your_tweet` は HAR で形を確認したが、`generic_*` 系と引用通知の実データは少ない。Mentions(`user_mentioned_you` / `user_replied_to_your_tweet` / `user_quoted_your_tweet`)は `TimelineTweet` で届き、`tweet_results` をそのまま変換する。

### 6-d. フォローのまとめ通知で古いフォロワーが上にあふれる

- 症状(2026-10-18): X で「○○さんと他9人にフォローされました」と出ているまとめに新しいフォロワーが加わると、OTD の通知カラムの一番上に、そのまとめの全員が並ぶ。いいね・RT など他の通知は一つずつ届いていた。
- 原因: X はまとめの ID を変えずに最新の人を先頭に入れ、まとめの時刻を最新の動作に移す。一人ひとりの時刻は返らない。HAR では、いいねのまとめ(ID の末尾 `6ihFJo`)が 16:50 の 2 人から、18:41:50 に 3 人目が先頭に入った形で戻ってきた。フォローのまとめは数時間分にわたり先頭ページから沈むので、次のフォローで先頭に戻ったとき、OTD はまだ渡していない全員を新しい時刻で渡していた。
- 対応(6522d2c): 新着取得(since_id)では、まとめに前回から加わった人だけを渡し、今回初めて見たまとめなら先頭の 1 人だけを渡す。起動時の読み込みと下スクロールでは今までどおり全員を渡し、並び順は X のリスト順(新しい順)に合わせた。判定はまとめの状態ごとに保存し、通知カラムが複数あっても同じ結果を渡す。
- いいね・RT は対象外: 投稿が反応を集めているあいだはまとめが先頭ページに残るので起きにくい。また、初めて見たまとめを先頭の 1 人に絞ると、同じ投稿に同時に来たいいねを取りこぼす。
- 残る制約: 初めて見たまとめに取得の間(7 秒)で 2 人以上加わると、2 人目以降は出ない。OTD を開く前からまとめにいた人は、そのまとめが起動時の先頭ページに無ければ OTD には出ない(X のまとめに残る)。

### Phase 6 のテスト

- 自動テスト(済み): `tests/shared-top-page.test.cjs` に 6 件。取得中と 5 秒以内の先頭ページ要求が応答を共有すること、取得後にもう一方の種別が更新されタイマーがリセットされること、失敗した応答は共有しないこと、スクロールと別アカウントは共有しないこと、XHR Proxy 経由でも共有した応答を legacy が読めること。`tests/polling-floors.test.cjs` に 5 件。下限の値と localStorage での上書き、通知の要求に feed type が付くこと、legacy の読み込み前に呼ばれても後で一度だけ適用されること、`faster_notifications` が無効なこと。`tests/home-scroll.test.cjs` に 1 件。Home の新着取得が 20 回続けて捨てられないこと(変更前のコードでは失敗する)。`tests/mentions-route.test.cjs` のヘッダ半減のテストは置き換えた。`tests/notifications-route.test.cjs` に 4 件(6-d)。先頭ページに戻ってきたフォローのまとめからは新しい 1 人だけが出ること、前に見たまとめからは増えた人が全員出ること、通知カラムが 2 つあっても両方に届くこと、いいねのまとめは今までどおり全員が出ること。フォローの 3 件は変更前のコードでは失敗し、いいねの 1 件は変更前でも通る。
- 実機(2026-10-18): 通知カラムと Mentions カラムを置いて 5 分。Home は 4.0 秒ごと、`all.json` は 7.0 秒ごとに 1 本で、Mentions からの要求は 0 本、すべて 200。ブックマークカラムが無かったため 60 秒の下限は未確認。両カラムに同時に出ることの目視も未了。6-d は、先頭ページから沈んだフォローのまとめに新しいフォロワーが加わったときにしか起きないため、次にその状況になったときに確かめる。

---

## Phase 7: Better TweetDeck との互換(実装済み)

**状態: 実装済み(a7c4cc5)。実機確認も済み(2026-10-18)。** 変更は `src/interception.js`。`node --test tests/*.test.cjs` は 89 件通過。

発端は、README で案内している dimdenGD 版 Better TweetDeck(4.11.3)を併用すると、相互フォローバッジが通知と Mentions にしか出ず、認証済みのアカウントのバッジが消えること(2026-10-18)。BTD のソース(dimdenGD/BetterTweetDeck)と BTD の設定、5 分間の HAR で調べた。upstream の Issue には対応するものが無い。

### 7-a. 調査結果

- フォークの変更で、BTD の読み込みや TweetDeck 内部への差し込みが壊れる箇所は無い。両方が手を入れる次の箇所は両立する: x.com リンクの判定(Phase 5)と BTD の t.co 除去、取得間隔の下限(Phase 6)と BTD のカスタム時刻(30 秒周期の時刻更新タスクを止める)、`window.Notification` の差し替え(Phase 5)、各ルートの URL の組み立てと BTD が `include_entities` 付きの要求に足す ext 系の引数、postMessage。
- 残課題(2026-10-25 に対応。下は当時の記述):
  - **Re-draft で長文の後半が消える**(対応済み: 自分のアカウント(ログインと、legacy が持つ全アカウント)の長文は常に全文にする。`ownAccountIds` / `parseTweet`、RT 先も同じ。`tests/parse-tweet.test.cjs` に 1 件): Phase 3(31dc3bc)から、長文は `OTDenableAutoExpand` が `"1"` でない限り省略のまま。「Expand tweet」も表示だけを書き換え、chirp の `text` は省略のまま(`files/bundle.js` 55 行)。BTD の Re-draft は `chirp.text` から作成欄を作り、すぐに元の投稿を削除するので、280 字を超える自分の投稿では後半が失われる。upstream は常に全文にしていたので、フォークで起きるようになった。回避策は `localStorage.OTDenableAutoExpand = '1'`。修正案は、自分のアカウントの投稿だけ常に全文にすること。
  - **返信制限(conversation control)が効いているか未確認**(2026-10-25 に実機で確認: 旧形式の要求に X は今も 200 "Done" を返し、投稿に制限が付く。10-g で x.com のパスを先に使うルートにした): BTD は投稿のあとに、旧形式の `POST https://api.x.com/graphql/` で ConversationControlChange(`hb1elGcj6769uT8qVYqtjw`)を送る。OTD にこれを扱うルートは無く、そのまま X に届く。失敗しても BTD は何も表示しないので、制限したつもりの投稿が全員返信可のまま公開されうる。
  - **BTD が起動しないことがある(コードからの推定)**(対応済み: `src/injection.js` の `keepOtherExtensions` が `data-btd-settings` / `data-btd-version` を持つ script 要素を差し替えの前に取り分け、新しい `<head>` に戻す。実行済みの script 要素は付け直しても再実行されない。`injection.js` は拡張機能本体なので 4.4.1 として入れ直しが必要。`tests/injection.test.cjs` に 1 件): BTD は document_idle に設定付きのスクリプトを `<head>` に入れる。OTD が文書を差し替える前に入ると要素ごと消え、BTD は何も出さずに起動しない(リロードで直る)。また BTD の対象は `https://x.com/i/tweetdeck` だけで、`?` 付きの URL では読み込まれない。
  - BTD の Advanced Mute Engine のフィルタは TweetDeck の設定に入るので、Phase 4 以降はキーワードミュートと同じくログインアカウントごとに保存される。

### 7-b. 相互フォローバッジが通知と Mentions にしか出ない

- 原因: BTD は `user.following` が true の人にだけ `friendships/show.json` を呼び、相互ならアイコンにバッジを付ける。X は GraphQL のユーザーで following / followed_by を `legacy` から `relationship_perspectives` に移した(HAR の Home に出てくる 129 人すべてがこの形で、`legacy.following` を持つ人は 0)。OTD は `legacy` をそのまま v1.1 のユーザーにしていたので、Home・リスト・検索などでは常に「フォローしていない」扱いだった。通知・Mentions の `all.json` のユーザーには `following` があり、そちらでは動いていた。同じ原因で、TweetDeck のツイートのメニューもフォロー中の相手に「Follow @…」と出していた。
- 対応(a7c4cc5): GraphQL のユーザーに `relationship_perspectives` から `following` / `followed_by` を付ける(`legacy` にすでにあればそのまま)。ツイートの作者、RT・引用の作者、`users/show`、ユーザー検索が対象。
- BTD の `friendships/show` は起動時に約 50 回増える(HAR の Home で 34 人分)。通知・Mentions の 19 回と合わせても、枠 800 回 / 15 分の 1 割程度。BTD は応答待ちの要求をまとめないので、同じ人の行が複数あると重複する。

### 7-c. 認証済みのアカウントのバッジが消える

- 原因: X は `verified` を立てず、チェックマークは `is_blue_verified` と `verification.verified_type`(Business / Government)で表す。OTD は GraphQL のユーザーで Blue を `verified` にしていた。BTD はこれを TweetDeck 標準のバッジとして扱い、「アイコンの上にバッジを表示」がオンだとカラム内では CSS で隠す。BTD 自身のバッジは `ext_is_blue_verified` / `ext_verified_type` から描くが、この欄は `all.json` のユーザーにしか無い。そのため BTD の「認証バッジ」(アイコン上の認証バッジ)がオフだと、Home などでは認証済みの人にバッジが一つも出なかった(HAR の Home で、ツイートの作者 116 人中 48 人)。
- Blue なしの Business アカウント(HAR で 1 人)は、`is_blue_verified` だけを見ていたため BTD が無くてもバッジが出ていなかった。
- 対応(a7c4cc5): GraphQL のユーザーに `ext_is_blue_verified` / `ext_verified_type` を付ける。`verified` は、BTD が動いているとき(`<body>` の `data-btd-ready`)は X の値のまま(現在は全員 false)にして BTD に描かせ、BTD が無いときは Blue・Business・Government のどれでも立てる。通知・Mentions のユーザーにも同じ規則を当てる(BTD が無いとき、通知でも Blue の人に標準のバッジが付く)。HAR の Home では、BTD があるときに BTD が描くバッジが 0 から 49(Blue 46、Business 3)になり、標準のバッジとの二重表示は無い。
- 副作用: BTD が動いているときは、カラムフィルタの「認証済みユーザーのみ」(`IS_FROM_VERIFIED`)が Blue の人を認証済みと見なさない(通知カラムでは以前から同じ)。
- 相互の行では、BTD の仕様で認証バッジが隠れる。BTD はアイコンの上にバッジを付けた行で、名前の横の自分のバッジを隠す。相互の判定は `friendships/show` の応答後なので、バッジは一度出てから消える。フォークでは扱わず、BTD の設定のカスタム CSS で残す(2026-10-18 に動作を確認):

```css
.btd-loaded[btd-badges-top-avatar='true'] .btd-badge.btd-mutual-badge .sprite.verified-badge {
    display: inline-block;
}
```

### 7-d. プロフィールの情報がほぼ空になる(2026-10-23)

- 症状: ユーザーをクリックして開くプロフィールに、自己紹介・フォロー数・ツイート数・バナー・サイトが出ない。
- 原因: X が GraphQL のユーザーから `legacy` を無くした(Home、通知、`UserByRestId`、`UsersByRestIds` のすべてで確認)。OTD は `legacy` を v1.1 のユーザーとして渡し、無いときは名前・ID・アイコン・登録日だけ補っていた。プロフィールは legacy の `TD.cache.twitterUsers` にあるツイート作者をそのまま使うので(`users/show` は呼ばれない)、作者の変換が空ならプロフィールも空になる。
- 対応: `fillUserFromGraph` が新しい形(`core` / `avatar` / `banner` / `profile_bio` / `website` / `relationship_counts` / `tweet_counts` / `action_counts` / `privacy` / `location`)から `TwitterUser.fromJSONObject` が読む v1.1 の項目を埋める。ツイート作者(本体・RT 元・引用元)、`users/show`、リストメンバー、通知のユーザー、ユーザー検索が同じ関数を通る。ユーザー検索は `legacy` が無いユーザーを捨てていたので、これも直した。
- X が返さないもの: リスト数(`listed_count`)。legacy の `prettyNumber` は未定義を空文字にして Listed が空欄になるので、`legacy` に無いときは 0 を入れる。サイトは `profile_bio.entities.url` があればその展開済み URL、無ければ `website.url`(t.co のことがある)をそのまま使う。

### Phase 7 のテスト

- 自動テスト(済み): `tests/user-state.test.cjs` に 8 件。following / followed_by が付くこと(RT と引用の作者も)、BTD が無いとき Blue・Business・Government が `verified` になること、BTD があるとき BTD が各チェックマークを一度だけ描くこと、X 自身の `verified` は BTD の有無にかかわらず残ること、`users/show` とユーザー検索も同じであること、`legacy` にすでにある following は残ること、通知・Mentions のユーザーが同じ規則に従うこと。8 件中 6 件は変更前のコードでは失敗する。
- 実機(2026-10-18): 認証バッジと相互フォローバッジが出ること、カスタム CSS で相互の行にも認証バッジが残ることを確認。

---

## Phase 8: カラムフィルタ「相互フォロー」(完了)

**状態: 完了。実機確認も問題なし(2026-10-19)。** 変更は 8d58466。`files/bundle.js`(20 行を同一行内で書き換え。行数は 76373 のまま)と `tests/mutual-follows.test.cjs`(新規)、`tests/user-state.test.cjs`(1 件追加)。`node --test tests/*.test.cjs` は 97 件通過。

発端は、Home カラムを相互フォローの相手だけに絞りたいという要望(フォーク独自。upstream の Issue には対応するものが無い)。カラム設定「Tweet authors」(`TD.vo.UserFilter`、`files/bundle.js` 30314-30426)でクライアント側に効くのは「specific user」(`TD.vo.Filter.SENDER`)と「verified users」(`TD.vo.Filter.IS_FROM_VERIFIED`)だけで、「users I follow」は通知・Mentions・Followers 限定のサーバ側フラグ(`filters=following`)のため、フォークのルートでは何もしない。Phase 7(a7c4cc5)で GraphQL のユーザーに `following` / `followed_by` を付けたのでデータは Home にも届いていたが、legacy の `TwitterUser.fromJSONObject`(40667-40726)は `following` しか読まず(40699)、`followed_by` を捨てていた。

### 8-a. 仕組み

- `TwitterUser` に `followedBy`(40699。GraphQL 形式の 40764 も)と `isMutualFollow()`(40801)を足した。`Boolean(following && followedBy)` で常に boolean。
- `TD.vo.UserFilter.FROM_MUTUAL = "mutual"`(30321)。`setFrom` の from_name クリア(30326)、`getSummaryText` の「by mutual follows」(30387)、`getFilters` での `IS_FROM_MUTUAL` 生成(30423)。`getQueryString`(30345-30358)は変えない: 検索演算子が無い。
- `TD.vo.Filter.IS_FROM_MUTUAL = "mutual"`(29744)。コンストラクタでは verified と同じ `exact = !0, filterTarget = "parent"`(29722): 通知の「いいね」などでは対象のツイートではなく行動した人を見る(`_getFilterTarget` 29829)。`pass` は `e.isFromMutualUser()` を `_testBoolean` に渡す(29789)。
- チャープ側: `ChirpBase.isFromMutualUser` は false(37465)。`TwitterStatus.isFromMutualUser`(38410)は RT した人(`this.user`)か元の作者(`getMainTweet().user`)のどちらかが相互、または自分(`isMe()`。カラムのアカウント基準)。`TwitterAction.isFromMutualUser`(41422)は `getCreator()` を見る。
- `_testBoolean`(29846-29852)は boolean 以外を渡すとフィルタを素通りさせる(lodash `isBoolean`)。そのため判定は厳密な boolean を返し、`relationship_perspectives` の無いユーザー(`followed_by` が undefined)は「相互でない」として隠れる。
- 引用ツイート: `TwitterStatus.passFilters`(38217-38222)はカラムのフィルタを引用先にも当てるため、verified と同じままだと相互の人が非相互の人を引用した投稿が隠れる。引用先には `IS_FROM_MUTUAL` だけ当てない(38220)。ミュートと他のカラムフィルタは従来どおり引用先にも効く。「specific user」「verified users」の挙動は変えていない。
- ヘッダの「Filtering by」アイコンは `hasActiveUserFilters`(29626)に `"mutual"` を足して出す(`getQueryString()` が空のため)。
- 選択肢は `getTweetsFromOptions`(60424-60456)に第 3 引数 `withMutualFollows` で足し(60420 / 60424 / 60454 / 60566)、`attachColumnFilters`(14691)で `withMutualFollows: !t`(`t` = 検索またはイベントカラム)として渡す。検索・イベントカラムでは `updateSearchFeedFilter`(29568-29580)がクエリ文字列の変化しか保存せず、`loadFilters`(29522-29526)が読む `model.getFilters()` も設定されないので、出しても選択が戻るだけになる。Home だけにするなら、2826 に `canFilterByUsersIFollow` と同じ形で `col_timeline` / `col_home` を見る関数を足し、14691 をそれに差し替える。
- 選択を変えると `loadFilters` がフィルタ id の違いを検知して `reloadTweets()`(カラムを空にして再取得)するので、表示中のカラムにも即反映される。保存は `filters.user.from_type` としてそのまま `OTDcolumns:<loginId>` に入る(`src/interception.js` の emulate ルートは変更なし)。
- Better TweetDeck の Advanced Mute Engine は `TD.vo.Filter.prototype.pass` を包んで元を `_pass` に退避し、AME 以外の種類は元に任せるので併用できる。BTD の相互判定(`friendships/show`)とは独立。

### 8-b. 判定の選び方(代替案)

- RT: RT した人か元の作者のどちらか(「specific user」の `getSenders` と同じ考え方)。verified と同じく元の作者だけにするなら 38410 の `e.isMe()` と `e.isMutualFollow()` の項を外す。RT した人だけにするなら `t` 側の項を外す。
- 自分の投稿: `isMe()` で通す(X は自分に `following: false` を返す)。隠すなら `isMe()` の項を外す。
- follow 状態が不明な人: 隠す。通すと `_testBoolean` の素通りと区別が付かなくなる。

### 8-c. 残課題(2026-10-25 に対応)

- 「users I follow」(`FROM_FOLLOWING`)を、相互と同じ作りの `following` を見るクライアント側フィルタにした(`TD.vo.Filter.IS_FROM_FOLLOWING`、`TwitterUser.isFollowedByMe`、`TwitterStatus` / `TwitterAction` / `ChirpBase` の `isFromFollowedUser`、`getFilters` の生成、引用先の除外)。選択肢は相互と同じく検索・イベント以外のカラムに出す(`withUsersIFollow: !t || canFilterByUsersIFollow`)。通知・Mentions では従来どおり feed の `usersIFollowFilter` も立つが、フォークのルートは無視するので、効くのはクライアント側のフィルタだけ。`files/bundle.js` の行数は 76373 のまま。`tests/mutual-follows.test.cjs` に 3 件追加。
- `followedBy` はアプリ内のフォロー・解除では更新されない(`follow()` / `unfollow()` は `following` だけ変える)。相手側の変化は再取得まで反映されない。相互判定は `following` の変化で追従するので実害は小さい(対応しない)。

### Phase 8 のテスト

- 自動テスト(済み): `tests/mutual-follows.test.cjs` に 7 件。定数・`pass` の分岐・要約文・ヘッダ判定・`followedBy` の読み込み・フォームの配線が bundle.js にあること、`isMutualFollow()` が両方 true のときだけ true で常に boolean であること、ツイートは作者か RT した人が相互なら通り自分の投稿も通ること、通知は行動した人で判定し他のチャープは通らないこと、`pass` が true を通し false を落とし boolean 以外を素通りさせること(厳密な boolean が必要な理由)、引用先には `IS_FROM_MUTUAL` だけ当てないこと、bundle.js の行数が 76373 のままであること。`tests/user-state.test.cjs` に 1 件: `relationship_perspectives` の無いユーザーは `following` / `followed_by` が undefined のまま(= 隠れる側)。
- 実機(2026-10-19): `localStorage.OTDalwaysUseLocalFiles = '1'` で、Home の Tweet authors に「mutual follows」が出ること(verified users の次)、選ぶと相互の人・自分・相互が絡む RT だけになり、要約が「by mutual follows」になりヘッダに Filtering by のアイコンが出ること、相互の人が非相互の人を引用した投稿が残ること、リロード後も残ること(`OTDcolumns` の `filters.user.from_type`)、通知・Mentions・リストでも効き検索カラムには出ないこと、BTD 併用時に相互バッジと結果が一致することを確認。

---

## Phase 9: GraphQL のクエリ ID と features を x.com 本体の JS から実行時に取る(実装済み)

**状態: 完了。実機確認も問題なし(2026-10-24)。** 変更は e025999。`src/interception.js`(レジストリと Proxy の送信経路)、`src/challenge.js`(x.com の HTML 取得を共有)、`tests/graphql-registry.test.cjs`(新規 9 件)。`node --test tests/*.test.cjs` は 114 件通過。

発端: 2026-10-23 に HAR から更新した `HomeLatestTimeline` の ID(`hB-6CNtJdReMJny7IPMoQQ`)が、翌 10-24 には x.com 本体で `KQPfcqQJJqF6M0D77p3JKw` になっていた。ID の更新を人手と GitHub 配信(`injection.js` が main の `interception.js` を読む)に頼ると、X の変更に気づいて push するまで止まる。X は旧 ID をしばらく生かすので(2026-10-24 時点で OTD の 20 操作中 12 の ID が最新と違い、すべて動いていた)、いつ切られるかが読めないのが問題。

### 9-a. 確認した事実(2026-10-23 の HAR と、2026-10-24 の直接取得)

- ログイン済みの `https://x.com/` の HTML(約 320 KB)に、`main.<hash>.js` の script タグ、webpack のチャンク番号→名前と番号→16 桁 hash の 2 つの表(`challenge.js` が `ondemand.s` の hash を取るのに使っているもの)、`window.__INITIAL_STATE__`(`featureSwitch.user.config` に設定 1490 件)が入っている。チャンクの URL は `https://abs.twimg.com/responsive-web/client-web/<名前>.<hash>a.js`。
- 各操作は JS 内で `{queryId:"…",operationName:"…",operationType:"query|mutation",metadata:{featureSwitches:[…],fieldToggles:[…]}}` と宣言される。HAR にあった 13 操作すべてで `featureSwitches` の鍵集合は x.com が実際に送った `features` と一致。値は `config[鍵].value` と一致(40 個中 39 個。残り 1 個は設定に無く、x.com は false を送っていた)。`fieldToggles` は宣言(9 個)と送信(Home は `withPayments:false` だけ)が一致しないので、呼び出し側の固定値のまま。
- OTD が使う 20 操作のうち 13 は `main.js`(1.2 MB)にある。`HomeLatestTimeline` は `shared~bundle.Compose~bundle.HomeTimeline~bundle.LoggedInMain`(29 KB)ほか、`NotificationsTimeline` は `bundle.Notifications`(137 KB)、List 系 4 つは `shared~JetfuelWrapper~bundle.AudioSpaceDetail~…`(179 KB。名前に List を含まない)、`Bookmarks` は `shared~bundle.Birdwatch~bundle.Compose~bundle.Display~…`(755 KB)。
- ログインしていない x.com は別のログアウト用アプリ(`x-web`)を返し、GraphQL の ID を含まない。取得は拡張機能の中(cookie 付き)で行う必要がある。
- manifest v3 で動いているのは `background3.js` と `ruleset.json` で、abs.twimg.com への fetch を遮断する規則は無い(`background.js` の遮断は v2 の名残で使われていない)。

### 9-b. 仕組み(`src/interception.js` の "GraphQL operations" の節)

- 起動時に `https://x.com/` を取り(`window.OTDhomepage` に Promise を置き、`challenge.js` と 1 回の取得を共有)、`main.js` の URL を保存済みの表(`localStorage.OTDgraphqlOperations`)と比べる。同じなら表をそのまま使い、features の値だけ HTML から更新する。
- 違えば `main.js` を取り、宣言を正規表現で抜く。無い操作は `GRAPHQL_OPERATIONS` の名前の手がかり(`HomeTimeline`、`bundle.Notifications`、`JetfuelWrapper~bundle.AudioSpaceDetail`、`bundle.Birdwatch~bundle.Compose~bundle.Display` など)に合うチャンクを名前の短い順に取り、見つかるまで続ける。前回見つかったチャンク名を最初に試す。上限はチャンク 12 個・4 MB・1 操作につき 4 個。見つからなかった操作は前回の表の値を残す。
- 表の形は `{ main, fetchedAt, ops: { <操作>: { id, features: [鍵…], chunk } }, values: { 鍵: 値 } }`。`values` は操作が使う鍵だけ(実データで 45 個、全体 24 KB)。
- 差し替えは Proxy の `send` の 1 か所で行う。URL の `/i/api/graphql/<id>/<操作>` を表の ID に、クエリの `features` を宣言された鍵と `values` の値(無い鍵は false)で作り直し、変わっていれば生の XHR を新しい URL で `open()` し直す(ヘッダはその後に付くので失われない)。`x-client-transaction-id` は差し替え後のパスで計算する。POST 本文(`queryId` と `features` を持つ JSON)も同様。`fieldToggles` と `variables` は触らない。
- 表に無い操作、`features` を宣言しない操作(いいね・RT・削除の mutation)は、ルートが組んだまま出る。ハードコードの ID と features はそのまま退路。
- 起動直後 15 秒以内の GraphQL 要求は、初回の読み取りが終わるのを最大 4 秒待つ(保存済みの表があれば HTML の比較だけなので短い)。
- 表の操作への応答が 400 か 404 のときは、HTML から取り直して強制的に再読込(10 分に 1 回まで)。応答本文の先頭 300 文字を console に残す。
- ルートの値と違う ID・鍵の差分は操作ごとに 1 回 console に出す。ハードコードの値を更新する目安になる。
- `localStorage.OTDgraphqlRegistry = "off"` で何もしない(従来どおり)、`"ids"` で ID だけ差し替える。
- 計画からの変更点 2 つ。(1) 新規ファイルではなく `interception.js` に入れた: `injection.js` は拡張機能本体にあり GitHub からは更新されないので、新規ファイルを足すと拡張機能を入れ直したユーザーにしか届かない。`interception.js` 内なら push で全員に届く。(2) 呼び出し側 20 か所を書き換えず、送信直前の 1 か所で差し替える: ルートは変更なし、`off` で元の挙動に厳密に戻り、今後ルートが増えても自動で対象になる。

### 9-c. 残課題

- 廃止された ID に X が何を返すか(404 か 400 か、本文の形)は未確認。今は 400 / 404 の両方で再読込を起こし、本文を console に残して形を見る。再試行は付けていない。
- チャンク名は X の都合で変わる。手がかりに合うチャンクが無ければ、その操作は前回の表の値か既定値に残る。List 系と Bookmarks は共有チャンクの名前に依存していて、変わりやすい。
- デプロイが変わった起動では約 2.3 MB(`main.js` 1.2 MB とチャンク 4 つ)を取る。同じデプロイなら HTML だけ。
- `features` の値はログイン中のアカウントの設定で、Teams の act-as 先でも同じ。x.com 本体と同じ挙動。
- Phase 6 の残課題「Home のクエリ ID」はこれで自動追従になる。ハードコードの既定値は、差分ログを見て時々更新する。2026-10-24 の HAR に合わせて Home を `KQPfcqQJJqF6M0D77p3JKw`、通知を `MSIb-PAcnu9OBUe56f_DHQ`、features を 41 鍵(`responsive_web_made_on_x_label_enabled: false` が増えた)に更新した。同じデプロイの `main.js` は `CreateTweet` を `5CVj-J0FZWyGgJpcjeBJEA` と宣言していたが、要求で確認していないので既定値はそのまま(表が差し替える)。

### Phase 9 のテスト

- 自動テスト(済み): `tests/graphql-registry.test.cjs` に 9 件。宣言の抽出とチャンクの試行順(短い名前から、取れないチャンクは飛ばす、同じチャンクは二度取らない)と保存、同じ `main.js` なら HTML だけ読んで値を更新すること、新しい `main.js` では前回のチャンクから試すこと、Home の要求が新しい ID と features(無い鍵は false)で出て `variables` / `fieldToggles` は残り、transaction id が新しいパスで計算されること、mutation の本文の `queryId` / `features` も差し替わること、`"ids"` と `"off"`、表に無い操作は触らないこと、404 で再読込が 1 回だけ起きること、HTML が取れないときは保存済みの表を使い、表が無ければ何も変えないこと。
- オフライン確認(2026-10-24、HAR から取り出した実物の HTML と JS 151 本を fetch の代わりに読ませて実行): 20 操作すべてが見つかり(取得は HTML、`main.js`、チャンク 6 本)、`HomeLatestTimeline` の features 40 個は x.com が送った要求と値まで一致、表は 24 KB。
- 実機(2026-10-24、`OTDalwaysUseLocalFiles` で起動): 初回起動の console に Home の ID が `hB-6…` から `KQPfcqQJJqF6M0D77p3JKw` へ、通知の ID が `PV7u…` から `MSIb-PAcnu9OBUe56f_DHQ` へ差し替わった行と、両方で `responsive_web_made_on_x_label_enabled` が増えた行が出た(通知の ID 変更は人手では気づいていなかった)。2 回目の起動の HAR(35 秒)では、x.com からは HTML だけを取り(`main.js` とチャンクは取り直していない)、Home 9 回・通知 5 回がすべて新しい ID と 41 鍵の features で 200。400 / 404 は無し。`OTDgraphqlRegistry = "off"` の確認は未了。

---

## Phase 10: x.com の仕様変更への追従(2026-10-25 の監査、優先度 A の 3 件)(実装済み)

**状態: 実装済み(未コミット)。実機確認 2026-10-25(Edge、`OTDalwaysUseLocalFiles` で起動)。** 変更は `src/interception.js`、`tools/graphql-builtin.mjs`(新規)。テストは `tests/graphql-registry.test.cjs`(3 件追加、2 件更新)、`tests/failure-notices.test.cjs`(3 件追加)、`tests/notifications-graphql.test.cjs`(2 件追加)、`tests/account-routes.test.cjs`(ID の更新)。`node --test tests/*.test.cjs` は 121 件通過。

発端: 2026-10-25 の監査(10-23 と 10-24 の HAR、両デプロイの x.com バンドル、Edge の実セッション)で次が分かった。(1) GraphQL の退路(ルートのハードコード値)は 20 操作中 13 で ID が古く features も欠けていて、レジストリが読めない初回起動や読み取り失敗のときにほぼ全カラムが落ちる構造だった。(2) `account/verify_credentials.json` は起動の単一障害点で(`updateAccountFromVerifySuccess` が例外を投げて起動が止まる)、x.com 本体はもう呼んでおらず、同じ分類の `help/configuration.json` は既に 410 だった。(3) 通知の `users_accepted_your_follow_request` が switch に無く、`Unknown notification type` の警告とともに捨てられていた。

### 10-a. GraphQL の退路を「ファイルに写した表」に置き換えた

- `GRAPHQL_BUILTIN_KEYS` / `GRAPHQL_BUILTIN`(`src/interception.js`): x.com の宣言(20 操作の ID、features の鍵、値、見つかったチャンク名、`main.js` の URL)をファイルに写した表。保存済みの表が無いとき(初回起動)と、読み取りが一度も成功しないときに `builtinGraphqlTable()` が同じ形の表を作って使う。送信直前の差し替えが従来どおり効くので、ルートのハードコード値が実際に出るのは `OTDgraphqlRegistry = "off"` のときだけになった。ルートの ID も同じデプロイの値に更新し、表と一致することをテストで固定した(features の定数は触っていない)。
- 更新手順: ログイン済みの TweetDeck の console で `copy(localStorage.OTDgraphqlOperations)`、ファイルに保存、`node tools/graphql-builtin.mjs <file>` の出力で 2 つの定数を置き換える。実機の読み取りが表と違う ID を返した操作があれば、console に `the built-in GraphQL table (日付) is behind x.com for …` が 1 回出る。
- 初回起動(保存済みの表が無い)の GraphQL 要求は読み取りを最大 10 秒待つ(`GRAPHQL_STARTUP_WAIT.firstRun`)。保存済みなら従来の 4 秒。
- 読み取りの失敗を画面に出す。表が無い状態で HTML やバンドルが読めなかったとき、新しいデプロイで 20 操作の半分未満しか宣言が見つからなかったとき(正規表現やチャンク名のずれ)は、legacy が立ち上がってからトースト 1 回(`noteRegistryProblem` → `toastWhenReady`)。既知の操作への 400 / 404 は `query-id` という失敗種別になり、トーストが「X rejected the query for Home (404; …)」と理由(表の出所、読み取り失敗の内容)を添える。`failureFromStatus` は 4xx 全般を x-error に数えるようにした(410 が理由無しで落ちていた)。
- 読み取りのログに、そのデプロイが宣言していた操作数を足した(`20 of 20 known, 20 declared by this deploy`)。見つからなかった操作は前回の表の値を引き継ぐので、`known` だけでは読めていないことが分からなかった。

### 10-b. verify_credentials の代替

- 起動時に取る x.com の HTML(レジストリと `challenge.js` が共有している)の `window.__INITIAL_STATE__.entities.users.entities[session.user_id]` が、legacy が読む v1.1 の user そのものだった(id_str、screen_name、name、profile_image_url_https、protected、verified。`require_some_consent` は無いが未定義で問題ない)。`readPageLoginUser()` が起動時に読んでおき、verify_credentials が 404 / 410 / 5xx のときに `inspectResponse` で 200 とその user に差し替える(`standInLoginUser()`)。ページから取れなければ前回 X が返した `localStorage.OTDverifiedUser`。どちらも twid cookie のユーザー ID と一致するときだけ使う。401 / 403(セッション切れ)と 429 は従来どおりログイン画面に理由を出す。act-as(Teams)アカウントの確認には代替しない。
- 差し替えたときは 1 日 1 回トーストで知らせる(`OTDverifyStandInNoticedAt`)。
- legacy 側の GraphQL ログイン経路(`tweetdeck_graphql_login`)は退役済みの `api.x.com/graphql` を叩くので代替にならない。

### 10-c. 通知 `users_accepted_your_follow_request`

- legacy にはこの action が無い(`TwitterAction._getActionConstructor` が null を返し `processRESTAction` が捨てる)。通知ルートが初めて必要としたときに、`TwitterActionFollow` を継承した `TD.services.TwitterActionFollowRequestAccepted`(action 名 `follow_request_accepted`、文言 "{{user}} accepted your follow request"、`isAboutYou` は常に true、`isOwnChirp` は false)を登録し、`_getActionConstructor` を差し替える(`ensureFollowRequestAction`)。カードは follow と同じ `status/follow_activity_in_stream`。通知の ID は `follow_request_accepted_<user>_<user>` で、フォローのまとめ通知と同じ新着判定(6-d)を通る。
- 未知の種別は種別ごとに 1 回だけ console に出す(`noteUnknownNotification`)。7 秒ごとの警告の連打をやめた。

### Phase 10 のテストと実機確認

- 自動テスト: 表の無い起動が写した表で要求を組み、読み取り失敗を 1 回トーストすること。新しいデプロイで宣言が 4 / 20 しか見つからないときに報告し、見つからなかった操作は保存済みの値を引き継ぐこと(同じ `main.js` の 2 回目は何も言わない)。写した表が 20 操作すべてを持ち、鍵の値がそろい、ルートの ID と一致すること。既知の操作の 404 が「query id の問題」としてトーストに出ること。verify_credentials の 410 にページの user が立ち、`OTDverifiedUser` に保存され、1 日 1 回だけ知らせること。cookie と違うユーザーや act-as アカウントには立たないこと。`users_accepted_your_follow_request` が `follow_request_accepted` の action になり、legacy の `_getActionConstructor` が新しい名前に答え古い名前は元のままであること。legacy の follow action が無いときはその項目だけ落として残りを届けること。
- 実機(2026-10-25、Edge): 再読込後の console に `GraphQL operations read at startup: 20 of 20 known`、`Unknown notification type` は消え、通知カラムに "accepted your follow request" のカードが 2 枚出た。Home と通知は 200。`standInLoginUser()` はページの user を返し、twid cookie の ID と一致した。

### 10-e. DM 送信: jQuery の配列エンコードを v1.1 のカンマ区切りに直す

- legacy は `handleSendDm` → `makeTwitterCall` → `TD.net.ajax` で `recipient_ids` を配列のまま渡し、jQuery の `$.param` が `recipient_ids[]=<id>` にする。X の v1.1 はこれを 2026-10 時点で拒否する(10-d)。`flattenArrayParams`(`src/interception.js`、Proxy の `send` で `beforeSendBody` の直後)が、`/1.1/` へのフォーム本文に `key[]=` があればカンマ区切りの `key=a,b` に書き換える。JSON 本文(先頭が `{` / `[`)、`/1.1/` 以外(GraphQL)、該当する鍵の無い本文は触らない。`dm/conversation/{id}/add_participants.json` の `participant_ids` も同じ形なので同時に直るはずだが未確認。
- テスト: `tests/form-arrays.test.cjs` に 3 件(1 人宛て、複数 ID の結合順、触らない本文)。`node --test tests/*.test.cjs` は 124 件通過。
- 実機: ユーザーが console から他アカウント宛てに `recipient_ids` を文字列で送って 200 を確認。2026-10-25 に DM 作成画面(宛先は typeahead で選択)から 1 通送り、OTD の書き換え後の本文が `recipient_ids=<ID>` になって 200 で届くことを Edge のネットワーク記録で確認(10-d)。
- 制約: X の DM は E2E 暗号化のある X Chat(`x.com/i/chat`)に移行していて、legacy の `dm/new.json` で送ったメッセージは相手側の X Chat に「暗号化されていないメッセージ」として表示される(2026-10-25 にユーザーが確認)。暗号化された会話の読み書きは legacy の API では扱えない(upstream #506 の「修正不可能」はこの部分)。OTD からの DM は暗号化なしの旧 DM として送受信される、と README などで明示する必要がある。
- 明示(ユーザーの選択は「送信機能は残して明記する」): README と README_JA の FAQ に項目を足し、作成画面の DM モードでは宛先の下に 1 行("Sent as a classic direct message without end-to-end encryption. Encrypted X Chat conversations are not available in TweetDeck.")を出す。`noteUnencryptedDm`(`src/interception.js`)が legacy の state 読み込み時に `TD.mustaches["compose/docked_compose.mustache"]` の宛先コンテナ末尾へ差し込み、既に描画済みの作成画面にも同じ行を足す。テストは `tests/dm-notice.test.cjs` に 2 件。README_KO は触っていない。

### 10-f. C 群: x.com 本体が呼ばなくなった v1.1 の退役に備える(2026-10-25)

- 対象と代替(`src/interception.js` の "v1.1 endpoints x.com itself no longer calls" の節)。`lists/ownerships.json` と `lists/subscriptions.json` は `CombinedLists`(x.com のプロフィールの Lists タブが使う操作。所有とフォロー中のリストが一緒に返るので、所有者の ID で分ける)から。`blocks/ids.json` と `mutes/users/ids.json` は `BlockedAccountsAll` / `MutedAccounts`(x.com の設定ページが使う操作)から、legacy の cursor ループに合わせて 1 呼び出し 1 ページ(100 人)で `ids` と `next_cursor_str` を返す。`users/contributees.json`、`users/contributees/pending.json`、`saved_searches/list.json` は代替が無いので空配列(contributees は legacy の起動が待つ要求なので、失敗をそのまま返すと起動が止まる)。
- 切り替えの方針: REST が答えるうちは REST(1 回で 1000 リスト、5000 ID を返す。GraphQL は 1 ページ 100 人分のプロフィール付き)。404 / 410 を `localStorage.OTDretiredRest` に 1 日覚えて、その間は代替で答える(`restOrGraphqlRoute` / `emptyWhenRetiredRoute`)。翌日 REST をもう一度試す。`localStorage.OTDpreferGraphql = "1"` で代替を先に使う(テスト用)。空配列の 3 本は 5xx のその場でも空配列で答える(覚えない)。
- 3 操作をレジストリ(`GRAPHQL_OPERATIONS`、計 23)と写した表に足した。保存済みの表に無い操作は、全文の読み直しをせずに写した表の値で埋める(以前は 24 時間後の再読込まで無かった)。`graphqlGet` が Proxy 経由で署名と ID / features の差し替えを受けつつ GET する共通経路。
- テスト: `tests/retired-rest.test.cjs` に 6 件(REST 生存時は素通し、CombinedLists の 2 ページ分割と所有 / フォローの振り分けと legacy の形、ブロック / ミュートの 1 ページずつと空ページでの終端、410 の記憶と翌日の再試行、contributees / saved_searches の空配列と 5xx、GraphQL 側の失敗は 503)。`tests/graphql-registry.test.cjs` に 1 件(表の穴埋め)。`node --test tests/*.test.cjs` は 133 件通過。
- 実機(2026-10-25、Edge、`OTDpreferGraphql = "1"` で起動): `CombinedLists` 2 回、`MutedAccounts` 2 ページ、`BlockedAccountsAll` 1 回がすべて 200、REST の 4 本は呼ばれない。ミュートは REST と同じ 23 件。ブロックは REST の 18 件に対して GraphQL は 0 件だったが、18 件すべてが `UsersByRestIds` で `UserUnavailable`(凍結・削除済み)で、x.com 本体のブロック設定ページも空だった。つまり GraphQL は生きているアカウントだけを返し、投稿できない相手なのでフィルタに影響は無い。このアカウントにはリストが無く、リストの中身の一致は未確認(テストのみ)。確認後にフラグは外し、REST 優先に戻した。
- 残り: `friendships/show.json`(BTD の相互フォロー判定。OTD が持つ GraphQL のユーザー状態から emulate できる)、`friendships/no_retweets/ids.json`(GraphQL に相当が無い。失敗しても空リストで害は小さい)、`/2/timeline/conversation/{id}.json`(詳細ビュー。`TweetDetail` からの組み立てが必要で、別フェーズの規模)。

### 10-g. D 群: 細かな差分(2026-10-25)

- `help/configuration.json`(410)を emulate する。legacy は失敗時に 2016 年の既定値へ落ちていたので壊れてはいなかったが、起動時のエラーと、DM の文字数上限などが既定値のままだった。X が最後に公開していた値(`HELP_CONFIGURATION`: dm_text_character_limit 10000、characters_reserved_per_media 24、photo_size_limit 5 MB、短縮 URL 23)を返す。`photo_size_limit` は legacy が参照していない(アップロード上限の判定には使われない)。
- Better TweetDeck の返信制限: 実機(2026-10-25、「@メンションだけ」で投稿)で見ると、BTD の要求は `POST https://api.x.com/graphql/`(パスに ID も操作名も無い旧形式)で、本文が `{"variables": "<JSON 文字列>", "queryId": "hb1elGcj6769uT8qVYqtjw"}`。X はこれに 200 `{"data":{"tweet_conversation_control_put":"Done"}}` を返し、投稿には `conversation_control.policy: "ByInvitation"` が付いていた(旧エンドポイントと 2023 年の ID がまだ生きている)。最初に書いた `/graphql/<ID>/ConversationControlChange` を見るルートは一致せず素通ししていたので、`/graphql/` も対象にし、本文から tweet_id と mode を読んで `x.com/i/api/graphql/<現行 ID>/ConversationControlChange` に JSON(`variables` はオブジェクト)で送り、応答をそのまま BTD の要求に返す。x.com 側が "Done" を返さなければ BTD の要求を元のまま送る(`conversationControlChangeOf` / `sendConversationControlChange`)。`ConversationControlChange` はレジストリ(計 24)と写した表にある。
- 通知のポーリングを cursor-top に変えた(`notificationsPollCursor`)。新着の問い合わせは直前のページの top cursor を付けて送り(x.com 本体と同じ)、10 分ごと(`TOP_RESYNC_INTERVAL`)に先頭ページ全体を読み直す。Phase 2-a の「cursor-top で未読が返らない疑い」は all.json の話で、GraphQL は x.com 本体がこの方式で動いている。`localStorage.OTDnotificationsTopCursor = "0"` で従来の全ページ取得に戻る。all.json ソースは従来どおり。通知と Mentions の共有ページ(6-a)はそのまま効く(両カラムとも同じ cursor-top 応答を受け取る)。
- カード: X の記事(`article.article_results.result`)に `summary_large_image` カード(題名・冒頭・カバー画像、`https://x.com/i/article/<id>` へのリンク。カバーが無ければ `summary`)を付ける(`presentArticle`。本文・RT 先・RT 内の引用)。スペースのカード(`3691233323:audiospace`)は `https://x.com/i/spaces/<id>` への `summary` カードにする。共通の `summaryCard` を足した。2026-10-25 に実機で両方の表示を確認(10-d)。
- Home の取得回数は Phase 6 の設計どおり(4 秒の下限、cursor-top で 1 回約 0.8 KB)で、重複は無かった。cursor の選び方だけ 10-j で変えた(新しい投稿が 1 件入ると、次の 1 件が来るまで毎回それを取り直していた)。
- テスト: `tests/spec-followups.test.cjs` に 5 件(help/configuration の emulate、BTD のルートと署名、記事カードと RT、スペースのカード、通知の cursor-top と 10 分の再同期とスイッチ)。`tests/notifications-graphql.test.cjs`、`tests/notifications-route.test.cjs`、`tests/mentions-route.test.cjs` の since poll の期待値を cursor-top に更新。`node --test tests/*.test.cjs` は 138 件通過。
- 実機(2026-10-25、Edge): 再読込後、`help/configuration.json` の要求は出ず 410 も消えた。通知は初回 11.3 KB(全ページ)、以後 7 秒ごとに 698 バイト(cursor-top)。`topFetches` を 11 分前に書き換えると次の 1 回だけ全ページ(11.3 KB)になり、その後 cursor-top に戻った。ブロック 18 / ミュート 23、カラム 3 本は従来どおり。

### 10-h. 詳細ビュー: `/2/timeline/conversation/{id}.json` の `TweetDetail` からの組み立て(2026-10-25)

- legacy の `TwitterClient.getConversation` が読むのは、`globalObjects.tweets` / `users` と、最初の instruction のエントリのうち `tweet-<id>`(祖先と本人。displayType は Tweet か SelfThread)、`conversationThread-<id>`(返信とそのスレッドの `conversationComponents`、`showMoreCursor` の actionText)、`cursor-top-` だけ。cursor を辿る要求は無い(返信を開くと返信を起点に取り直す)。REST は 2026-10-25 時点で 200 だが、小さい会話では `timelineModule` 形式(OTD の既存の掃除で `conversationThread` に直している)、大きい会話では `conversationThread` 形式で返ってくる。
- `TweetDetail`(x.com 本体の詳細ページ)は同じものを `tweet-<id>` アイテム、`conversationthread-<id>` モジュール(`TimelineTweet` のアイテム。"show more" は `TimelineTimelineCursor` のアイテム)、cursor エントリで持つ。`conversationFromTweetDetail` がこれを legacy の形に組み立てる(`parseTweet` で v1.1 のツイートにし、著者を `users` に入れ、ミュート・ブロック中の著者の返信は REST の掃除と同じく落とす。引用先と RT 先もプールに入れる)。
- 切り替えは 10-f と同じ: REST が答えるうちは REST、404 / 410 を `OTDretiredRest`(鍵は `/2/timeline/conversation/{id}.json` で 1 つ)に 1 日覚えて `TweetDetail` へ、`OTDpreferGraphql = "1"` で先に `TweetDetail`。
- テスト: `tests/retired-rest.test.cjs` に 2 件(祖先の SelfThread・本人・2 本のスレッド・show more・ミュート著者の除外・終端、REST 素通しの URL 掃除と 410 の記憶が別の会話にも効くこと)。`node --test tests/*.test.cjs` は 140 件通過。
- 実機(2026-10-25、Edge): 同じツイートの詳細ビューを REST で開くと 4 項目(返信 2)、`OTDpreferGraphql = "1"` で再読込して開くと 5 項目(返信 3、`TweetDetail` 1 回、REST の要求なし、console に警告なし)。差の 1 件はその間に増えた返信とみられる。確認後にフラグは外した。

### 10-i. `friendships/show.json` をタイムラインが運んできた関係から答える(2026-10-25)

- Better TweetDeck は描画する投稿者ごとに `friendships/show.json` を呼ぶ(起動直後に約 47 回、バッジ 1 つにつき 1 回)。x.com 本体は呼んでいない。OTD を通る GraphQL のユーザーはすべて `relationship_perspectives`(following / followed_by / blocking / muting)を持っているので、`applyGraphUserState` で `rememberRelationship` がユーザーごとに覚え、ログインアカウントが source の質問には `friendshipShowBody` で v1.1 の `relationship`(`source` / `target` の following と followed_by、blocking、muting。X がもう教えない can_dm などは false)を返す。
- 切り替え: 覚えた関係が 10 分以内ならその場で答える。それ以外は REST が答えるうちは REST。REST が 404 / 410 を返したら(`OTDretiredRest`)、または `OTDpreferGraphql = "1"` なら、古い記憶でも答え、知らないアカウントは `UserByScreenName` / `UserByRestId` で引く(引いた結果も覚える。X に無いアカウントは code 50 の 404)。source が別アカウント(Teams)の質問は REST のまま。
- TweetDeck からのフォロー・解除(`friendships/create.json` / `destroy.json`)の応答(v1.1 の user)で記憶を更新する。
- テスト: `tests/retired-rest.test.cjs` に 4 件(記憶からの応答と source / target の向き、未知・古い記憶・別 source は REST、退役後の古い記憶と `UserByScreenName` の引き直しと 404、フォロー応答での更新)。`node --test tests/*.test.cjs` は 144 件通過。
- 実機(2026-10-25、Edge): 再読込前は記事 50 件に BTD の相互バッジ 47 個、`friendships/show` の REST 47 回。再読込後は記事 49 件にバッジ 46 個、REST 0 回、覚えた関係 96 件、console に警告なし。

### 10-j. 自分の投稿を Home に即時に出す。新着取得の cursor をフィードの最新の Top cursor にする(2026-10-25)

発端: 「投稿直後に自分の投稿が Home に出ない」を、投稿中の HAR(`x.com-tweetdeck-tweeting.har`、07:13 UTC)で確かめた。CreateTweet は 07:13:24.9 に 200(レジストリの ID `5CVj…`、features 38 鍵)。3 秒後の Home 新着取得は 0 件、7 秒後の取得でその投稿が返り、以後の取得でも同じ投稿が毎回返っていた(legacy が ID で差し替えるので表示は正しい)。つまり出ないのではなく、X の Home インデックスに載るまで 3〜7 秒かかる。legacy は送った投稿をどのカラムにも入れない(`makeTwitterApiCall` は呼び出し側が渡す `processAsStreamData` を読まず、`FeedPoller.acceptStreamChirps` は空関数、`dataTweetSent` の受け手は統計と作成欄だけ)。x.com 本体は投稿した側で自分の投稿をタイムラインに差し込んでいる。

- 即時表示(`showOwnTweetInHome`): `statuses/update.json` ルートが CreateTweet の応答を `parseTweet` で変換したあと、投稿者アカウント(`tweet.user.id_str`。Teams の act-as でもその口座)の Home フィードの poller(`feedPollers(user_id, "home")`。通知の `notificationPollers` を一般化)に、legacy 自身の変換(`TD.controller.clients.getClient("twitter:<id>").processTweet`)で作った chirp を `acceptContentedChirps` で渡す。これは legacy が要求の外から届く chirp を受け取る入口で、Home では素通し(`usertweets` / `search` だけ条件付き)。数秒後の新着取得で X が返した同じ投稿は従来どおり legacy に渡り、legacy が ID で差し替える(重なりのある取得と同じ)。渡した ID は Home ルートと同じく `rememberHomeTweet` で既読にし、あとで会話モジュールに入って戻ってきても既存の投稿と同じ扱いで落とす。初回ページを待っている poller(`isInitialLoad`)、返信(Home が返信を載せるかは X の判断なので polling に任せる)、TD が無い・内部が変わったときは何もせず、従来どおり polling で届く。`responseText` は複数回読まれることがあるので変換と表示は `xhr.storage.tweet` で 1 回だけ。差し込んだ ID は最新のページに加え(`fileWithLatestPage`)、そこから下へスクロールしても bottom cursor が見つかる。
- cursor の選び方(`rememberTopCursor` / `latestTopCursor`): X の Top cursor は thrift の構造体で、応答時刻の snowflake と「そのタイムラインの最新エントリの ID」を持つ(HAR で復号)。x.com 本体は毎回「直前の応答の Top cursor」で問い合わせ、X はその最新 ID より新しいものを返す。x.com.har(10-23)と 10-24 の HAR には、要求 cursor の時刻より古い ID の投稿が返っている例があり(14:56:34.4 の cursor に 14:56:33.2 の投稿、14:09:05.9 の cursor に 14:09:03.8 の投稿)、境界は時刻ではなく最新 ID だと分かる。legacy の since_id は 2 番目に新しい chirp(`calculateLowerBound` の添字 1)なので、その chirp を含むページの Top cursor を使う従来の方式では、新しい投稿が 1 件入るたびに次の 1 件が来るまで毎回その投稿を取り直していた(約 1 KB が約 4 KB)。Home / List / User の各ルートで、先頭取得と新着取得の応答(0 件でも)が運んだ Top cursor をフィードごとに覚え、新着取得はそれを使う。max_id のスクロールのページは対象外。10 分ごとの全文再同期(`TOP_RESYNC_INTERVAL`)と、ページごとの bottom cursor の記録は従来どおり。ページ記録の `top` は読む側が無くなったので外した。
- テスト: `tests/home-scroll.test.cjs` に 3 件(最新の Top cursor を使うこと・0 件の応答でも進むこと・スクロールのページは数えないこと。投稿の即時表示と 1 回だけの変換、新着取得での再送は legacy に渡し会話モジュールでの再送は落とすこと、bottom cursor。返信・別アカウント・初回ページ待ち・TD 無しでは polling に任せること)。既存 2 件の期待値を更新。`node --test tests/*.test.cjs` は 153 件通過。
- 実機確認: 2026-10-25 に d79cd19 で投稿し、Home に即時に出ることを確認。数秒後の新着取得で二重に出ないこと、新着取得が直前の応答の Top cursor で出て 1 回約 1 KB に戻ることは HAR では未確認(テストでは確認済み)。

### 10-d. 残課題(2026-10-25 時点の整理。他 Phase の残りもここにまとめる)

実機で確認すれば閉じられるもの(ユーザー操作が要る):

- ~~10-e の DM 送信を OTD の書き換え経由で確認する~~ → 2026-10-25 にユーザーが DM 作成画面から 1 通送って確認。Edge のネットワーク記録では `POST api.x.com/1.1/dm/new.json` の本文(書き換え後にブラウザが実際に送ったもの)が `recipient_ids=<ID>` のカンマ区切り形式(`recipient_ids[]=` は無し)で 200、応答は `entries[0].message` と `users`。本文の文面は見ていない。これで監査由来の実機確認はすべて済み。
- ~~10-g の BTD の返信制限~~ → 2026-10-25 に確認。旧形式の要求が X に通って制限が付いていた(10-g 参照)。向け直しのルートは要求の形に合わせて直し、テストで固定。直したルートは、同じ投稿に同じ mode を BTD と同じ形で送り直して確認: `x.com/i/api/graphql/JWeo7tCAhI_HwcuPcL4JrQ/ConversationControlChange` に 1 回出て 200 "Done"、`api.x.com/graphql/` には出ない。
- ~~10-g の記事カードとスペースのカード~~ → 2026-10-25 にユーザーが記事とスペースを作って確認。Home カラムで、記事の投稿には題名と x.com のリンクカード(`https://x.com/i/article/<id>` へのリンク 3 か所、カバー画像の無い記事なので `summary`)、スペースの投稿には「X Space / x.com」のカード(リンクは投稿の t.co 経由でスペースへ)が legacy のカード描画(`hw-card-container`)で出た。カバー画像(2560×1024)を付けた記事は `summary_large_image` になり、カードの上に画像(pbs の 1200×480 版)、下に題名と x.com が出た。
- ~~10-a の初回起動の 10 秒待ち~~ → 2026-10-25 に `OTDgraphqlOperations` を消して起動して確認。写した表の `main.js` が現行デプロイと同じだったので読み取りは HTML だけで済み(全文の読み直しは起きない設計どおり)、最初の GraphQL 要求は読み取り完了後(起動 2.4 秒)に出た。保存された表は 24 操作。別デプロイでの全文読み直しと 10 秒の上限は未確認のまま。
- 8-c の「users I follow」: 2026-10-25 に Home カラムの設定を開き、Tweet authors の選択肢が all users / users I follow / specific user… / me… / verified users / mutual follows の順で出ることを確認。
- ~~10-j の即時表示~~ → 2026-10-25 に確認。残りは HAR で見るもの: 数秒後の新着取得で二重に出ないこと、新着取得が直前の応答の Top cursor で出て 1 回約 1 KB に戻ること。
- 10-b の verify_credentials の代替経路: X が拒否するまで発火しない。応答を差し替えて試すか、死んだときに確認する。
- Phase 6 の目視: 通知カラムと Mentions カラムに同じ通知が同時に出ること、ブックマーク、フォローのまとめ通知(6-d)。GraphQL の `generic_*` 系と引用通知の実データの形(6-e)。
- Phase 9 の `OTDgraphqlRegistry = "off"` の実機確認。廃止 ID への X の応答の形は、ID が現行に揃った今は再現機会待ち。

実装が残っているもの(影響の大きい順):

1. ~~詳細ビュー `/2/timeline/conversation/{id}.json` の `TweetDetail` への移行~~ → 10-h で対応(REST 優先、退役時に `TweetDetail`)。
2. ~~`friendships/show.json` の emulate~~ → 10-i で対応(覚えた関係から答え、退役時は GraphQL で引く)。
3. ~~Phase 8-c: 「users I follow」フィルタのクライアント側置き換え~~ → 8-c に対応を記録。
4. ~~Phase 7: Re-draft で長文の後半が消える。BTD が起動しないことがある~~ → 7-a に対応を記録(自分の長文は常に全文、BTD の設定 script を差し替え後も残す。後者は 4.4.1 の入れ直しが必要)。
5. 写した表 `GRAPHQL_BUILTIN` の定期更新。console に `the built-in GraphQL table (日付) is behind x.com for …` が出たら、`copy(localStorage.OTDgraphqlOperations)` を保存して `node tools/graphql-builtin.mjs <file>` の出力で置き換える。
6. 軽微: `friendships/no_retweets/ids.json` は GraphQL に相当が無く失敗しても空リスト(放置)。x.com 本体が付ける `x-twitter-polling` / `x-web-auth-multi-user-id` ヘッダと Home の POST 化は実害なし(対応不要)。レジストリの `UsersByRestIds` はどのルートも使っていない(整理対象)。Phase 5 の #321(macOS Firefox の絵文字フォーカス)は再現できず低優先。

upstream への PR は「進め方」のとおり(#554、#552、Phase 1、起動ハングは #562 のクレジット付き再提出)。

---

## 対応しない / できないもの

- **X 側の仕様・運用**: #551(Teams からの投稿で凍結)、#529(X Pro が Premium+ 限定)、#522(検索演算子の制限。upstream 作者も X 側と判断)、#506(DM は新 Chat に移行。upstream 作者が「修正不可能」と明言)、#492(アカウント制限。同系統の #469 は close 済み)、#462 / #510 / #259(Teams 招待。X の delegate 挙動)、#517 / #495(レート制限。Phase 1 で無駄なリクエストを減らして緩和はできる。Phase 6 で通知カラムも残り回数に合わせて減速するようにした)
- **upstream 依存(Patreon 版)**: #515(Patreon 連携後に List がほとんど読み込まれない。報告者・コメント者とも連携ユーザーで、連携前は読み込めていた)
  - `src/injection.js` 168-188 が、Patreon のトークンを付けて `oldtd.org/api/scripts` から追加スクリプトを読み込む。トークンなしで返るのは `auth.js`(連携 UI)だけで、支援者向けの修正はこのリポジトリに無いため、検証も修正もできない。
  - 回避策: 設定の Patreon「Logout」で連携を外すと公開版の List ルートに戻る(レート制限回避は失われる)。
  - フォークでも連携ユーザーにはこのスクリプトが読み込まれ、Phase 1 で直した List ルートを上書きしている可能性がある(相性は不明)。必要なら「追加スクリプトを読み込まない」設定を検討する。#530 の報告者も Patreon 版を使っている。
- **議論・質問**: #519, #503, #516, #508
- **機能要望(後回し)**: #542 自動翻訳(外部実装あり: kik0220/OldTweetDeck-fork の auto-translation ブランチ)、#535 ブックマークオプション、#534 アップロード上限、#233 検索カラム手動リロード、#231 For you カラム、#221 通知音、#212 fxtwitter、#211 スマートリプライ、#204 ショートカット、#148 Firefox 署名、#102 スタンドアロンアプリ、#18 Safari

---

## 進め方

- Phase ごとに PR を分け、`tests/` に `node:test` のケースを足す。実行は `node --test tests/*.test.cjs`。
- Phase 1 から Phase 5 までの実機確認は 2026-10-17 に問題なし。Phase 6 は 2026-10-18 に取得間隔だけ確認し、目視とブックマーク、フォローのまとめ通知(6-d)の確認が残っている。Phase 7 は 2026-10-18 に確認済み。Phase 8 は 2026-10-19 に確認済み。Phase 9 は 2026-10-24 に確認済み。Phase 10 は 2026-10-25 に確認済み(verify_credentials の代替経路は X が拒否するまで実機では発火しない)。
- 残りは upstream への PR、Phase 5 で未対応の #321、Phase 7 の残課題(返信制限の実機確認のみ。長文の Re-draft と BTD の起動は 2026-10-25 に対応)、Phase 8 の残課題(2026-10-25 に対応)、Phase 9 の残課題(廃止 ID への応答の形、`off` の実機確認)、Phase 10 の残課題(代替経路の実発火、初回起動の待ち、10-j の新着取得の HAR 確認。BTD の返信制限と記事・スペースのカードと 10-j の即時表示は 2026-10-25 に確認。詳細ビューは 10-h、`friendships/show` は 10-i で代替を用意した)。Phase 6 の残課題だった Home のクエリ ID は Phase 9 で自動追従になり、Phase 9 の退路は Phase 10 でファイルに写した表になった。
- upstream へは #554(RTL)、#552(Mentions)、Phase 1(92f0be5 / bfcbdd3)の順で PR を出す。起動ハングの修正は limex 氏の #562 が未マージで close されているので、出すならクレジット付きで出し直す。
