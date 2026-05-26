# コードレビュー (2026-05-27)

シニアエンジニア視点での全体レビュー。各項目は本文に解説アンカーがあるので、作業時はチェックボックスを潰しながら本文を参照してください。

## 作業用チェックリスト

### P0 (即時)
- [x] [1.1 フッターの GitHub リンクが `href="#"`](#11-フッターの-github-リンクが-href)
- [x] [1.2 `renderMixPreview` が `deriveMixFileNames` を再利用していない](#12-rendermixpreview-のファイル名生成が-derivemixfilenames-を再利用していない)

### P1
- [x] [1.3 `mixPreviewBlock` のクリップ表示が片寄せ時に不整合](#13-mixpreviewblock-の-エンディング側だけ-表示しても両方の-audio-が露出する) — CSS で `.c--mix-preview-clip { display: none }` + `.is--visible { display: block }` の対で既に正しく制御されていることを確認。コード変更不要
- [x] [1.4 数値入力に `min`/`max` が無い](#14-loudnorm-系の-dynaudnorm-撤去で-voicelufs-の最小値が広がりすぎ)
- [x] [2.9 `ending.wav` が Cloudflare 25MiB 上限ぎりぎり](#29-endingwav-が-cloudflare-pages-の-25-mib-上限ぎりぎり) — DEVELOPMENT_NOTES に上限到達時の選択肢を明記
- [x] [3. `computeMixTimings` / preview filter にテストを追加](#3-テストカバレッジのギャップ) — `web/mix.test.js` で 13 ケース追加 (outputNameFromInput / computeMixTimings / buildPreviewFilter)

### P2
- [x] [1.5 `package.json` の `@ffmpeg/core` の扱い](#15-packagejson-の-dependencies-に-ffmpegcore-を残しているが実行時は-cdn) — devDependencies に移動
- [x] [2.1 `preview.js` の Audio リスナーが GC まで残る](#21-previewjs-で旧来のリスナーが-audio-オブジェクトと一緒に放置される) — `AbortController` + `#releaseAudio()` で一括解除
- [x] [2.3 `clampRange` を `assertInRange` にリネーム](#23-utilsjs-の-clamprange-は-clamp-しない)
- [x] [2.4 `BuildFilterSpec` JSDoc に `introDuckLevel` / `outroDuckLevel` 追記](#24-buildfilterspec-の-jsdoc-に-introducklevel--outroducklevel-が-無い)
- [ ] [§5 info modal を `<template>` 化](#5-小さな改善一行レベル)

### P3
- [x] [2.2 `dom.js` の orphan JSDoc を直す](#22-domjs-の-orphan-jsdoc-コメント)
- [x] [2.5 keydown ハンドラ 2 本を統合](#25-keydown-ハンドラが-2-つに分かれている)
- [x] [2.6 `attachStepperButtons` をマークアップ側に寄せる検討](#26-attachstepperbuttons-の動的-dom-改変) — コードコメントで JS 注入である意図を明記（HTML 寄せは現状コスト > ベネフィットで見送り）
- [x] [2.7 設定値の HTML `min`/`max` と JS clamp を schema 化](#27-設定値の-html-minmax-と-js-clamp-の二重管理) — `rangedInputs` テーブルで一元化
- [x] [2.8 `_headers` の末尾改行](#28-_headers-の警告) — 確認したところ既に POSIX 適合 (各行 `\n` 終端)
- [x] [4.1 シェル版 / Mac アプリ版のメンテ方針を明記](#41-シェル版と-mac-アプリ版の関係)
- [x] [4.2 `styles.css` に章区切りコメント](#42-webstylescss-の構造) — Modal セクションを TOC に追加、番号を実順序に整列
- [x] [4.3 `withLock` 設計の動機を文書化](#43-session__invalidate-で外部からの呼び出しを防ぐ設計の意図)
- [x] [4.4 AudioContext と AutoplayPolicy のメモを追加](#44-waveform-loaderjs-の-audiocontext-シングルトンと-autoplaypolicy)
- [x] [4.5 `REFACTOR_PROGRESS.md` の住み分けを決める](#45-refactor_progressmd-と-development_notesmd-の住み分け) — REFACTOR_PROGRESS は凍結アーカイブと明記、4 ドキュメントの住み分けを DEVELOPMENT_NOTES に記載
- [x] [4.6 README と「動作環境について」モーダルの単一情報源化](#46-動作環境についてモーダルとリポジトリ直下-readme-の重複) — DEVELOPMENT_NOTES に「モーダルが一次情報源、README はそれを参照」のガイドラインを記載 (実コンテンツ反映は随時)
- [x] [4.7 シェル版のメンテナンスポリシー明記](#47-シェル版のメンテナンスポリシー) — DEVELOPMENT_NOTES に「永久 legacy / freeze」と明記

---

## 総評

サイズ (~5,500 行) に対して構造の整頓度が非常に高い小〜中規模 SPA。`web/*.js` のモジュール分割、`// @ts-check` + JSDoc、純関数の積極的テスト化、CSS の ITCSS 風プリフィックス、ドキュメンテーション (`DEVELOPMENT_NOTES.md` / `REFACTOR_PROGRESS.md`) の充実、いずれも個人/小規模 OSS の水準を超えています。テスト 63 ケース pass。`FfmpegRuntime.withLock(fn)` で worker への並行アクセスを直列化し、`session.__invalidate()` で寿命外の呼び出しを reject する設計などはセンスがあります。

一方、機能追加が活発な分、**残骸 / 重複 / 矛盾**がいくつか残っています。以下、優先度順に。

---

## 1. 即時に直すべき不具合 (Bugs)

### 1.1 フッターの GitHub リンクが `href="#"`
`index.html:528`

```html
<a class="c--footer-link" href="#" target="_blank" rel="noopener noreferrer">
  <span aria-hidden="true">⌥</span>
  View on GitHub
</a>
```

`README.md` 上は GitHub での閲覧を強調しているのに、UI 上のリンクは現在のページ末尾に飛ぶだけ。`target="_blank"` 付きなので新タブで `about:blank#` 相当が開く。公開デモ (https://wraptalk.pages.dev/) の永続的な不具合。

### 1.2 `renderMixPreview` のファイル名生成が `deriveMixFileNames` を再利用していない
`web/mix.js:168` で定義した `deriveMixFileNames` が、`web/mix.js:245-249` で再実装されています:

```js
// mix.js:168
function deriveMixFileNames({ input, intro, outro }) { ... }

// mix.js:245
const names = {
  inputName: `input.${extFromName(spec.input.name, "mp4")}`,
  introName: `intro.${extFromName(spec.intro.name, "wav")}`,
  outroName: `outro.${extFromName(spec.outro.name, "wav")}`,
};
```

`outputName` が要らないだけで残りは完全に同じ。命名ルールがズレた瞬間にバグになる。`renderMixPreview` 側を `deriveMixFileNames(spec)` に置換するのが妥当。

### 1.3 `mixPreviewBlock` の **エンディング側だけ** 表示しても両方の `<audio>` が露出する
`web/app.js:337-345`

```js
const target = previewClipTargets[kind];
if (target?.audio) {
  if (target.audio.src) URL.revokeObjectURL(target.audio.src);
  target.audio.src = URL.createObjectURL(blob);
  target.wrapper?.classList.add("is--visible");
}
mixPreviewBlock.classList.add("is--visible");
```

最初に「エンディングを試聴」だけを押すと、`mixPreviewEndingClip` には `is--visible` が付くが、`mixPreviewOpeningClip` は CSS デフォルト次第。`styles.css` で `.c--mix-preview-clip` の初期 display を確認するか、明示的に `is--visible` の有無で表示制御する設計に統一すべき (現状の `index.html` には初期状態の class が無いので、ユーザーが先に「オープニング→エンディング」と押すと、後で押した方しか sync しない可能性が残ります)。

### 1.4 `loudnorm` 系の `dynaudnorm` 撤去で `voiceLufs` の最小値が広がりすぎ
`utils.js` 経由で `voiceLufs` を `[-40, -8]` に clamp していますが、HTML 入力欄 (`index.html:61`) には `min` / `max` 属性が無い:
```html
<input id="voiceLufs" type="number" step="0.5" value="-16" />
```
他の数値入力 (`outroOverlap`, `introMusicVolume` 等) も同様に、HTML 側の `min`/`max` がバラバラで「`clampRange` で submit 時に弾く」仕様になっている。**UI が早期に弾けない**ので、ユーザーは「設定完了」を押すまで誤りに気付けない。`min="-40" max="-8"` を素直に入れた方が UX / アクセシビリティの双方で得。

### 1.5 `package.json` の `dependencies` に `@ffmpeg/core` を残しているが、実行時は CDN
`DEVELOPMENT_NOTES.md` には「`@ffmpeg/core` は CDN」と明記されているのに `package.json:12` で:
```json
"@ffmpeg/core": "^0.12.10",
```
`npm install` で 32MB を毎回引いてくる + Cloudflare のビルドコンテナで無駄。本来は `devDependencies` か削除。あるいは「ピン留めしておきたいから残す」なら **コメントで意図を README に書くべき**（現在の DEVELOPMENT_NOTES は依存配信表だけ）。

---

## 2. 設計上の指摘

### 2.1 `preview.js` で旧来のリスナーが Audio オブジェクトと一緒に放置される
`PreviewController.prepare()` 内 (`preview.js:271-281`):
```js
audio.addEventListener("timeupdate", () => {
  if (this.audio === audio) { this.updateUI(); }
});
audio.addEventListener("loadedmetadata", () => {
  if (this.audio === audio) { this.updateUI(); }
});
```

これらは `removeEventListener` されません。`this.audio === audio` ガードがあるので「動作上は」問題ありませんが、`handleSourceChange()` 後に古い Audio が GC される前は **裏で `timeupdate` が走り続ける** (Audio が pause/release されるまで)。`handleSourceChange()` で `audio.pause(); audio.src = ""; audio.load();` を呼ぶか、リスナーを一括 removeEventListener できるよう `AbortController` 渡しに統一する方がクリーン。

### 2.2 `dom.js` の orphan JSDoc コメント
`web/dom.js:6-9`:
```js
/**
 * Read the value of the currently selected MP3 bitrate radio.
 * @returns {string}
 */

export const loadButton = $("loadButton");
```

`getMp3Bitrate` の説明なのに `loadButton` の上にある（実体は `dom.js:60`）。型補完上は無害ですが、読み手は混乱します。

### 2.3 `utils.js` の `clampRange` は「clamp しない」
`utils.js:82` の関数は実際には **範囲外で throw** するだけで、値を範囲内に丸めません:
```js
export function clampRange(value, min, max, label) {
  if (value < min || value > max) {
    throw new Error(...);
  }
  return value;
}
```
名前から `Math.min(max, Math.max(min, value))` を連想する読者を裏切る。`assertInRange` / `validateRange` の方が正確。`clamp01` と並んでいる以上、命名のミスリードはなおさら。

### 2.4 `BuildFilterSpec` の JSDoc に `introDuckLevel` / `outroDuckLevel` が無い
`filter.js:71-86` の `@typedef`:
```
* @property {number} introFadeStart
* @property {number} introFadeEnd
* @property {number} outroFadeStart
* @property {number} outroFadeEnd
* @property {number} talkTrimStart
* @property {number} talkTrimEnd
```
ところが関数本体 `buildFilter({ ..., introDuckLevel, outroDuckLevel, ... })` ではこの 2 つを destructure している。preview filter の JSDoc も同様 (`voiceLufs` も抜けている)。`@ts-check` は noisy 警告は出さない設定なので素通りしていますが、せっかく JSDoc を書いている以上、ここはズレを直すべき。

### 2.5 keydown ハンドラが 2 つに分かれている
`app.js:413` (Tab トラップ) と `app.js:475` (Esc クローズ) — どちらも `document` の `keydown` で、別々の `find` を走らせている。マイクロ最適化レベルだが、同じ「開いている modal」を 2 回探すのは可読性を落とす。`switch(event.key)` で 1 本化できる。

### 2.6 `attachStepperButtons` の動的 DOM 改変
`app.js:873` — 全 `input[type=number]` を `.l--stepper` でラップして、`±` ボタンを JS で注入している。

- DEVELOPMENT_NOTES に「ネイティブスピンを非表示にして JS でステッパー注入」と書いてある通り意図的だが、**マークアップが JS 前提**になっている (= JS off / 失敗時にレイアウトが微妙に崩れる)。
- 代替手段: HTML 側で `.l--stepper` を予め用意し、JS はイベント配線だけにする。今後 SSR / 静的レンダリング以外の経路を増やす予定が無いなら現状でも実害は無い。

### 2.7 設定値の HTML `min`/`max` と JS clamp の二重管理
`introPad` / `outroOverlap` 等で `min="0"` だけ書いてあるもの、何も無いものが混在。`clampRange` の `[min, max]` と HTML 属性を 1 か所で定義したくなる。`dom.js` か独立の `settings.js` に **schema** を置いて、HTML/JS 双方で参照するのが将来安全。今のサイズなら必須ではないが、設定項目が増えるなら早めに。

### 2.8 `_headers` の警告
ファイル末尾改行が欠落している (Read で `1` 行目から表示が始まっているが 4 行目に内容がない)。Cloudflare Pages のパーサは寛容ですが、ツールによっては最終行を無視することがある。POSIX 的に末尾 `\n` を入れておくのが安牌。

### 2.9 `ending.wav` が Cloudflare Pages の 25 MiB 上限ぎりぎり
`ending.wav` = 22.37 MiB (`ls -la` で 23,454,760 bytes)。残り 2.6 MiB しか余裕が無く、編集や再エンコードでうっかり 25 MiB を超えると **Cloudflare Pages のデプロイが死ぬ**。`README.md` で「`@ffmpeg/core` を CDN に逃した理由」は説明されていますが、デフォルト音源側の余裕の無さは誰も気にしていない。

選択肢:
- ending.wav を再エンコードして圧縮 (現在 24-bit/96kHz など過剰スペックなら 16-bit/44.1kHz に)
- これも CDN / Cloudflare R2 に逃す
- せめて `DEVELOPMENT_NOTES` に「`ending.wav` は 25MiB 上限を意識して肥大化させない」と明記

---

## 3. テストカバレッジのギャップ

純関数の `filter.js` / `utils.js` / `waveform.js` ハンドル系には十分なテストがありますが、以下は未テスト:

- **`computeMixTimings`** (`mix.js:183`) — export されており Node から実行可能なのに、テストが 1 件もありません。`talkTrimEndRaw === 0` / `talkTrimEndRaw < talkTrimStart` / `outroOverlap > trimmedSpeechDuration` のような境界条件はバグの温床。
- **`outputNameFromInput`** (`mix.js:148`) — 拡張子のない入力 (`"recording"` のみ) や複数ドット (`"my.audio.mp4"`) で挙動が変わる。
- **`buildPreviewFilter` (private)** の「アウトロが既にプレビュー窓内で始まっている / 始まっていない」分岐 (`mix.js:330-341`) — `outroSourceStart` がここで決まるので、間違うと末尾 30s プレビューが頭から outro になる事故が起こる。ここを切り出して export → test 可能化するのが次の P1 だと思います。

---

## 4. ドキュメント不足 / 不整合

ドキュメントは充実していますが、コードと突き合わせると以下が曖昧:

### 4.1 シェル版と Mac アプリ版の関係
`README.md` には「`Wraptalk.app` をダブルクリックで起動」とあり、`Wraptalk.app/` ディレクトリも存在しますが、**中身の構成（Automator? Platypus? どのスクリプトが呼ばれるか）が一切記載されていない**。誰がメンテするのか、どうビルドし直すのかが追えない。

### 4.2 `web/styles.css` の構造
`DEVELOPMENT_NOTES.md` に ITCSS 風プリフィックスのルールはあるが、1418 行ある単一 CSS の **内部の章立て** が不明（リセット → レイアウト → コンポーネント → ステート という ITCSS の順序になっているのか）。ファイルが伸びるほど「どこに新しいルールを書けばいいか」が判断しづらくなる。せめて `/* === Layout === */` のような区切りコメントを置いてくれるとレビュアーが助かる。

### 4.3 `session.__invalidate()` で外部からの呼び出しを防ぐ設計の意図
`mix.js:110-138` の `#createSession()` は秀逸ですが、**何故そこまで厳格にしたのか**が DEVELOPMENT_NOTES の Recently Done 1 行 (`session-based API に変更...callback 終了時に invalidate されて外部から呼べない`) しか書かれていない。`Open Questions` ではなく `Architectural Decisions` 的な小章を立て、「同時に複数 spec を渡したときに固定ファイル名が衝突した過去のバグ」のような **動機** を残すのが望ましい。半年後の自分が「withLock 邪魔だな」と外す事故を防ぐため。

### 4.4 `waveform-loader.js` の AudioContext シングルトンと AutoplayPolicy
`getAudioContext()` は最初の呼び出しで `new AudioContext()` を作る。ブラウザによっては user gesture 前の AudioContext は `suspended` 状態で開始される。`decodeAudioData` 自体は suspended でも動くが、将来 `audioContext.resume()` を加えるなら user gesture チェーンが必要 — この事情がドキュメント化されていない。

### 4.5 `REFACTOR_PROGRESS.md` と `DEVELOPMENT_NOTES.md` の住み分け
両ファイルに似たような時系列ログが入っている。`README` には「リファクタ履歴は REFACTOR_PROGRESS.md」と書いてあるが、`DEVELOPMENT_NOTES.md` の `Recently Done` セクションも事実上のリファクタ履歴になっており重複。`DEVELOPMENT_NOTES` を「常に最新の設計スナップショット」、`REFACTOR_PROGRESS` を「コミットに紐付かないナラティブ」に分けるなら、後者がもうほとんど更新されていない (最終追記時期が分からない) ことを明記するか、廃止して `git log` に任せた方が衛生的。

### 4.6 「動作環境について」モーダルとリポジトリ直下 README の重複
動作環境モーダル (`index.html:465-501`) と README の「前提」セクションは内容がほぼ同じ。片方を更新したらもう片方も触る、というルール（あるいは生成元）が無いので、いずれ乖離する。例えば README は「Chrome / Edge のデスクトップ推奨」、モーダルは更にモバイル/Firefox の挙動も書いてあり、すでに微妙にズレている。

### 4.7 シェル版のメンテナンスポリシー
`podcast_auto.sh` の冒頭注記で「ブラウザ版とは音声処理が違う」とあるが、**今後シェル版のフィルタチェーンをブラウザ版に揃える計画があるのか、永久放置か** が `Open Questions` でも触れられているだけ。OSS としては「不一致を承知の上で legacy として残し、変更しない」と明示してしまった方が PR の判断基準ができる。

---

## 5. 小さな改善（一行レベル）

- `app.js:351` `FOCUSABLE_SELECTOR` を `dom.js` か別 `constants.js` に。同一 selector が将来別 modal でも要る。
- `app.js:493-514` `fileCardConfigs` の `[input, meta, config]` タプル。`meta` は既に config に持たせた方が API が均一。
- `preview.js:23` `let logger = (message) => console.warn(message);` のグローバル mutable は最低限のシングルトン化なので OK ですが、 `setPreviewLogger` の存在意義は `app.js` 経由で `appendLog` を渡すためだけ。素直に `PreviewController` の config に `onLog` を入れる方がモジュール境界がクリーン。
- `mix.js:421-457` `getMediaDurationSeconds` の `media.load()` 呼び出しは `removeAttribute("src")` の直後で、ブラウザによっては不要なネットワーク fetch を 1 回トリガするとの報告がある。`media.src = ""; media.load();` の方が安全という JS 系ベストプラクティスがある。要計測。
- `index.html` 内の info modal が同じ構造で 6 個並んでいる (`environmentInfoModal` / `voiceLufsInfoModal` ...)。DEVELOPMENT_NOTES で「media-section の dedup は見送り」と判断したロジックは正しいが、**info modal は文字以外完全に同一**なので、テンプレ化のコスパが違う。`<template id="infoModal">` + `infoModalEntries` から description / title を渡して clone、で 80 行 × 6 が消える。
- `app.js:914-916` `runExclusiveAction` のエラーログで `error.message` のみ表示し stack を捨てている。開発者向けには `error.stack` ぐらいログに残しても良い (ユーザーには status message で十分)。

---

## 6. セキュリティ・プライバシ観点

特筆すべき問題はなし。
- ファイル送信なし (README 通り `ffmpeg.wasm` 完結)
- `data-modal-close` クリック判定は `event.target.dataset.modalClose === "true"` で型厳密
- `localStorage` の tampered value 対策 (DEVELOPMENT_NOTES 既出) も OK
- jsDelivr / Cloudflare 経由の CDN なので Subresource Integrity (SRI) は付けていないが、wasm の SRI は普及度的に許容
