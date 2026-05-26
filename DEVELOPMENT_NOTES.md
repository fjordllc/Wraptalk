# Development Notes

直近のレビュー指摘と作業チェックリストは [CODE_REVIEW.md](./CODE_REVIEW.md) を参照。

## Current State

- 公開デモ: https://wraptalk.pages.dev/ (Cloudflare Pages)
- ブラウザ版がメイン。`index.html` を HTTP で配信すれば動作する静的サイト
- 依存ランタイム:
  - `@ffmpeg/ffmpeg` + `@ffmpeg/util` は `vendor/` にコミット
  - `@ffmpeg/core` (32MB の wasm) は jsDelivr CDN から読み込み（Cloudflare Pages の 1 ファイル 25MiB 制限回避）
- スタイル: `web/styles.css` 単一ファイル + ITCSS 風プリフィックス命名
- JS: ES Module で分割（`web/{app,dom,utils,waveform,waveform-loader,preview,mix,filter}.js`）+ `web/*.test.js` × 3
- デフォルト音源は `opening.wav` / `ending.wav` をリポジトリ直下に配置
- ライセンス: MIT
- 旧来のシェル版 `podcast_auto.sh` と `Wraptalk.app` は長尺フォールバックとして残置

## Module Layout (web/)

| File | Lines | 役割 |
|------|-------|------|
| `app.js` | 916 | エントリ。配線、ファイル選択、processAudio (DOM → spec → runMix → download)、handleLoadFFmpeg、info modal 群、modal focus trap、localStorage 永続化、設定リセット、D&D (accept 検証 + 拡張子 fallback)、ステッパー注入、入力 assertInRange |
| `preview.js` | 686 | `PreviewController` / `PreviewSession` クラス。controller の `start()` でイベント配線も自己完結。jumps[] config で任意位置へジャンプ、ハンドル focus highlight 連動、`prepareToken` で per-controller の race 対策 |
| `waveform.js` | 513 | 波形描画、ズーム、ズームプリセット、各種ハンドルの位置計算 / hit-test、カーソル切替、時刻軸 (cache 付き)、focus halo。`MAX_CANVAS_WIDTH=30000` でブラウザ canvas 上限を回避 |
| `mix.js` | 457 | `FfmpegRuntime` クラス (load promise + `withLock(fn)` で session を渡す排他制御)、`runMix` (spec → mp3 blob)、`renderMixPreview(spec, kind)` (opening/ending 別)、`buildPreviewFilter` |
| `filter.js` | 205 | `buildFilter` / `buildOpeningPreviewFilter` / `buildEndingPreviewFilter` + envelope ヘルパー。Node からテスト可能 |
| `dom.js` | 132 | 全 `getElementById` を集約、ラジオは `getMp3Bitrate()` 経由 |
| `utils.js` | 98 | 純粋関数 + JSDoc 型注釈付き (parse 系 / clamp / assertInRange / formatTime / extFromName / isNetworkLikeError) |
| `waveform-loader.js` | 86 | `loadAudioBuffer` (AudioContext + ffmpeg fallback デコード、`withLock` 内で atomic 化) |

すべての JS ファイル冒頭に `// @ts-check` を付けて、JSDoc 型注釈で TS-aware エディタ上で型補完 + エラー検知が効くようになっている。

依存関係（一方向）:
```
dom.js ────────────────────────────→ app.js
filter.js ── mix.js ──┬─────────────→ app.js
utils.js ──┬──────────┤
           ↓          ↓
        waveform.js → preview.js ── waveform-loader.js
                             ↘
                              app.js
```

## Classes

- `PreviewController` (preview.js) — 波形 + プレビューを統合するコントローラ。1つのメディア要素単位
- `PreviewSession` (preview.js, singleton) — 現在再生中の preview を追跡。private field でアクセス制御
- `FfmpegRuntime` (mix.js, singleton) — FFmpeg のライフサイクル管理。`configure / isLoaded / ensureLoaded / writeFile / exec / readFile / deleteFile / cleanupFiles`

## Tests

`web/*.test.js` は `node:test` ベース。`npm test` で一括実行 (63 ケース)。

- `web/filter.test.js` — buildFilter / buildOpeningPreviewFilter / buildEndingPreviewFilter のロジック + 構造アサーション
- `web/utils.test.js` — parse / clamp / assertInRange / formatTime / extFromName / isNetworkLikeError
- `web/waveform.test.js` — handle positions / hit-tests / trim handles (canvas mock)

## 音声処理チェーン

### トーク (speech)
```
aformat (mono, 44.1kHz)
→ highpass=100Hz       低域ゴロ・空調ノイズカット
→ lowpass=14000Hz      高域シャカつきカット
→ equalizer(170, -3dB, w=2)  もこもこ帯域カット
→ loudnorm(I=voiceLufs, TP=-2, LRA=11)  LUFS ターゲット
→ adynamicequalizer(6500Hz, threshold=3, mode=cut, ratio=4)  歯擦音 de-ess (loudnorm 後に局所圧縮)
→ asplit + 各ch EQ (擬似ステレオ: L=3500+2dB+325-1dB, R=逆相)
→ join (stereo)
→ adelay(speechDelayMs)
```

### BGM (intro / outro)
```
aformat (stereo, 44.1kHz)
→ volume = ${baseVolume}                    UI の「基本音量」
→ volume = ${envelope}                      時刻ベース Ducking (詳細は filter.js)
→ (outro のみ) adelay(outroStartMs)
```

### ミックス
```
[speech][intro_music][outro_music] amix=inputs=3:duration=longest:normalize=0
→ alimiter(limit=0.89, attack=5, release=50)  最終ピーク保護 (-1dB)
```

### Ducking envelope
- 時刻ベース。トーク開始/終了タイミングを基準に、BGM の音量を `1.0 → DUCK_LEVEL` に滑らかに切替
- `DUCK_FADE_DUR = 0.4s` で短いフェード
- `DUCK_LEVEL` は UI 入力 (intro/outro 別、% 表記)。デフォルト `0.3` (=30%)
- リアルタイムサイドチェイン圧縮ではなく envelope なので、トークの切れ目で BGM が瞬間的に上がる「パンピング」が起きない

## デプロイ

### Cloudflare Pages
- main ブランチ push で自動デプロイ
- Build command: `npm run build` (リポジトリ資産を `dist/` にコピー)
- Build output: `dist`
- 配信 URL: https://wraptalk.pages.dev/

### Headers (`_headers`)
`SharedArrayBuffer` (ffmpeg.wasm マルチスレッド) 用に COOP/COEP を必須。Cloudflare Pages は `_headers` ファイルを自動解釈してレスポンスに付与:
```
/*
  Cross-Origin-Opener-Policy: same-origin
  Cross-Origin-Embedder-Policy: require-corp
```

### デフォルト音源と Cloudflare の 25 MiB 上限

`opening.wav` (6 MB) と `ending.wav` (22.37 MB / 23,454,760 bytes) がリポジトリ直下に置かれ、`npm run build` 経由でそのまま `dist/` へコピーされる。Cloudflare Pages の **1 ファイル 25 MiB 上限** に対して `ending.wav` は残り 2.6 MiB しか余裕がない。再エンコードや差し替えで肥大化すると、デプロイが死ぬので注意:

- 上限到達時の選択肢:
  - 24-bit/96kHz など過剰スペックなら 16-bit/44.1kHz に再エンコードして縮める
  - Cloudflare R2 等の外部 CDN に逃す（COEP 環境下の CORP ヘッダーに注意）

### 依存ファイルの配信戦略
| 依存 | 配信方法 | 理由 |
|---|---|---|
| `@ffmpeg/ffmpeg` (~128KB) | `vendor/` にコミット | サイズ小、外部依存を減らしたい |
| `@ffmpeg/util` (~80KB) | `vendor/` にコミット | 同上 |
| `@ffmpeg/core` (32MB) | jsDelivr CDN | Cloudflare Pages の 1 ファイル 25MiB 制限を超えるため |

jsDelivr は `Access-Control-Allow-Origin: *` + `Cross-Origin-Resource-Policy: cross-origin` を返すので COEP 下でも問題なく読める。

### build スクリプト
```bash
npm run build
# = rm -rf dist && mkdir -p dist && cp -R index.html web vendor opening.wav ending.wav _headers dist/
```

`node_modules` は gitignore 済み。Cloudflare 側で `npm install` が走るが、`dist/` には含まれない。

## Waveform Interaction Model

3つの波形 canvas（トーク / イントロ / アウトロ）に複数のハンドルが配置される。

- **上端 22px**
  - イントロ: トーク開始位置（オレンジ `138, 50, 16`）
  - アウトロ: トーク終了位置（インディゴ `74, 92, 167`）
  - トーク: 使用範囲 開始/終了 ペア（オレンジ + インディゴ）。範囲外はグレーで網掛け
- **下端 22px**
  - イントロ / アウトロ: フェード開始 / 終了（ティール）
- **本体**: クリック / ドラッグで再生位置シーク

カーソルは動的に切替: ハンドル上 = `ew-resize`、それ以外 = `pointer`。
ハンドル位置は数値入力欄からのタイプにもリアルタイムで追従（input event でコントローラの updateUI を発火）。

## クラス命名規則

| プリフィックス | 用途 | 例 |
|----------------|------|------|
| `l--`   | レイアウト（structural container） | `.l--shell`, `.l--panel`, `.l--media-toolbar` |
| `c--`   | コンポーネント（UI 部品） | `.c--button`, `.c--preview-button`, `.c--setting-card-body` |
| `u--`   | ユーティリティ | `.u--sr-only` |
| `is--`  | ステート（CSS と JS で共有） | `.is--playing`, `.is--empty`, `.is--visible` |
| `js--`  | **JS 専用セレクタフック**（スタイル無し） | `.js--waveform-scroll` |
| `spec--` | **テスト専用セレクタフック**（スタイル無し）| (現状未使用) |

ルール:
- JS が `querySelector` / `closest` で class を使う場合は `js--` プリフィックスを付け、CSS 側にはこの class のスタイル定義を書かない
- テストから DOM を辿るときは `spec--` を付ける（CSS / JS から独立）
- 1要素に `class="c--… js--… spec--…"` のように複数プリフィックスを並べて、責務ごとに使い分ける
- `is--*` は CSS と JS の両方が触る正当な共有ステート（例外的）

## CSS の色変数

すべての色は `web/styles.css` の `:root` で定義。スタイル本体に色リテラルは無い。

- RGB トリプル（alpha 共有用）: `--ink-rgb`, `--accent-rgb`, `--accent-deep-rgb`, `--white-rgb`, `--status-overlay-rgb`, `--bg-peach-rgb`, `--bg-glow-rgb`, `--shadow-rgb`
- alpha 固定の色トークン: `--accent`, `--accent-deep`, `--accent-soft`, `--muted`, `--surface-warm`, `--surface-warm-alt`, `--surface-peach`, `--surface-peach-hover`, `--surface-cream`, `--surface-cream-soft`, `--surface-ring`, `--surface-dark`, `--text-light`, `--text-on-dark`, `--bg-grad-start`, `--bg-grad-end`, `--panel`, `--line`, `--shadow`

alpha 違いは `rgba(var(--ink-rgb), 0.12)` のように RGB トリプルから生成。

## Setting Card 構造

```html
<section class="c--setting-card">
  <header class="c--setting-card-header">
    <h3 class="c--setting-card-title">タイトル</h3>
  </header>
  <div class="c--setting-card-body">
    <!-- 本文。子要素間は gap: 14px、外側は padding: 18px -->
  </div>
</section>
```

カード / ヘッダー / ボディがそれぞれ自分の padding を持つ。負マージンや子セレクタごとの `margin-top` 集約は使わない。

## Priority Tasks

### P1

- ~~**ミックス済みプレビュー**~~ ✅ 完了 (2026-05)。 「ミックスをプレビュー」ボタンで先頭 30s + 末尾 30s のクイックサンプルを生成して試聴できる。短い mix（< 65s）は全長を再生

### P2

- ~~**進捗メッセージの細分化**~~ ✅ 完了 (2026-05)。ステージごとに setStatus + ffmpeg の onProgress を読んで `音声処理中... 35%` のように表示
- **アクセシビリティ** — `form` / `fieldset` / `legend` でフォームグルーピング (一部対応: modal focus trap、ハンドル focus halo、jump ボタン aria-label)
- **preview 音源のクリーンアップ** — オブジェクト URL のライフサイクルをファイル切替時 / 反復再生時の観点で再点検

### P3

- ~~D&D アップロード~~ ✅ 完了 (2026-05)。各 file card に drop/dragover で受け入れ
- ~~波形に時刻ティック / マーカー表示~~ ✅ 完了 (2026-05)。canvas 下にスクロール連動の時刻軸 (1s〜600s の interval を自動選択)
- ~~直近の設定値を `localStorage` に保存~~ ✅ 完了 (2026-05)。`wraptalk:settings:v1` キーで保存・復元

## 検討して見送った変更

- **HTML の 3 media-section 重複の dedup**: input / intro / outro の `<section>` 構造は表面的に似ているが、`setting-card` 群の中身（トーク使用範囲 vs トーク開始位置 vs トーク終了位置 など）が section ごとに違うため、共通化の利得が少ない。`<template>` + JS clone や Web Components を入れると現在の「素の HTML/CSS/JS で完結する」シンプルさを損なう。差分は ~100 行で許容範囲。3 → 30 に増えるなら再検討する。

## UI 構成

- **ヒーロー**: タイトル + 概要 + 「ⓘ 動作環境について」ボタン（クリックでモーダル表示。ページレイアウトを動かさない）
- **3つの media-section**（トーク / イントロ / アウトロ）: 各 section に波形 + プレビュー/ズーム ツールバー + 設定カード群
- **音質 section（軽量）**: 見出しを `1.4rem / weight 700` に控えめにして他セクションと階層差を出している
- **ファイルメタ表示**: 各 section の `<p class="c--media-meta">` に、選択中のファイル名（`xxx を使用中`）またはデフォルト音源の案内を表示
- **設定完了 / 初期値に戻すボタン**: 主画面の `.l--actions--sticky` で `position: sticky` 配置、画面下に常時アクセス可能。初期値ボタンは secondary スタイルで confirm dialog を挟む
- **モーダル (`.c--modal`)**: 設定完了クリックで開く。プレビュー/書き出しボタン + mix preview audio + status block (meter + log) を内包。閉じる手段: × / 背景クリック / Esc
- **色チップ**: 設定カードの見出し横の swatch が、波形上のハンドル色とリンク
  - 🟢 緑 (rgb 34,197,94) = フェードアウト
  - 🟡 黄 (rgb 251,191,36) = トーク開始位置 / 使用範囲開始
  - 🔴 赤 (rgb 244,63,94) = トーク終了位置 / 使用範囲終了
- **数値入力**: `.l--inline-setting input[type=number]` は `text-align: right` + `tabular-nums` で値が揃って読める

## Recently Done

直近作業の履歴。古いセッションログは [REFACTOR_PROGRESS.md](./REFACTOR_PROGRESS.md) を参照。

- 2026-05: ディレクトリ名を `Wraptone` → `Wraptalk` にリネーム
- 2026-05: 波形にドラッグハンドル群を実装（トーク開始 / 終了位置、トーク使用範囲 = atrim、フェード開始 / 終了）。範囲外網掛け、カーソル動的切替
- 2026-05: アウトロのフェード終了後の無音を ffmpeg の `-t` で自動カット
- 2026-05: プレビュー一時停止位置の保持 + ファイル切替時のリセット
- 2026-05: トークの Preview ボタンをファイル未選択時に disabled
- 2026-05: `web/app.js` を 7 ファイルに分割 + 45 ケースのユニットテスト
- 2026-05: 局所的 OO 化（PreviewController / PreviewSession / FfmpegRuntime）
- 2026-05: ITCSS 風クラスプリフィックス導入（`l--` / `c--` / `u--` / `is--` / `js--` / `spec--`）
- 2026-05: CSS の色をすべて `:root` 変数に集約
- 2026-05: MP3 ビットレートを `<select>` から縦積みラジオボタンに
- 2026-05: `.c--setting-card-body` ブロック導入で card / header / body の padding 責務を整理
- 2026-05: `.c--status` を初期非表示にし、`ffmpeg.wasm 読込` または `処理して mp3 を作る` 開始時に `is--visible` を付与して現れる挙動に
- 2026-05: `update*FromPointer` 3 関数を `#applyHandleDrag` ヘルパーに集約、`setupPreviewController` config を nested に、app.js のイベント配線を `controller.start()` に集約 (app.js: 517 → 359 行)
- 2026-05: `runMix` をステップ関数に分解（`validateMixSpec` / `deriveMixFileNames` / `writeMixInputs` / `computeMixTimings` / `executeMixFilter` / `readMixOutput`）。`computeMixTimings` を export してテスト可能に
- 2026-05: `waveform-loader.js` を新設し、`loadAudioBuffer` で AudioContext + ffmpeg fallback デコードを集約
- 2026-05: 全 JS ファイルに `// @ts-check` + 主要な JSDoc 型注釈を追加
- 2026-05: ミックスプレビュー機能を実装。`renderMixPreview()` でフィルタの `[out]` を `[full]` にリネーム → `atrim` + `concat` でヘッド30s + テール30s をサンプル化（短い mix は全長）。ファード接続部に 0.5s のクロスフェード。UI: 「ミックスをプレビュー」ボタン + `<audio controls>` 表示
- 2026-05: ミックスプレビューをオープニング / エンディング 2 ボタンに分割。`renderMixPreview(spec, kind)` で kind 別レンダ
- 2026-05: プレビューレンダを最適化。オープニング用 / エンディング用の専用フィルタ (`buildOpeningPreviewFilter` / `buildEndingPreviewFilter`) を追加し、kind 別に必要な BGM 入力のみ書き込み + 該当時間範囲だけトーク音源を atrim。長尺podcast でエンディングが体感数十倍早くなる
- 2026-05: ダークモードに切り替え。slate-900 + slate-800 panels。アクセントを **violet-700**（紫）に。フェードハンドル色を **green-500/400** に変更（彩度高い緑）。ターゲットハンドル色を amber/rose に
- 2026-05: アクセントボタンを solid color + ホバーで色だけ変える方式に（グラデ撤去で右端の白い線を解消）
- 2026-05: 「ffmpeg.wasm を読み込む」→「設定完了」にリネーム。トーク未アップロード時は disabled
- 2026-05: 「処理して mp3 を作る」→「書き出す」にリネーム
- 2026-05: プレビュー/書き出し/ステータスログをモーダル化。設定完了クリックで開く（× / 背景 / Esc で閉じる）
- 2026-05: 設定完了ボタンを `position: sticky` で常時表示
- 2026-05: 各設定カードの見出し横に色チップを追加（フェード=緑 / トーク開始=黄 / トーク終了=赤）+ 使用範囲のサブラベルにも黄/赤チップ
- 2026-05: 音質セクションの見出しを `1.4rem` に軽量化（他セクションと階層差）
- 2026-05: lede の動作環境注意書きを `<details>` に変換して初期は折りたたみ
- 2026-05: ファイル選択中のメタ情報（ファイル名 / デフォルト音源案内）を waveform 上部に表示
- 2026-05: プレビューボタンを `▶ Preview` → `▶ 試聴`、`■ Stop` → `■ 停止` に日本語化
- 2026-05: `.l--inline-setting` の数値入力欄を `text-align: right` + `tabular-nums` で値を揃えて表示
- 2026-05: 時刻ベース Ducking envelope に置き換え (sidechaincompress 撤去)。`DUCK_LEVEL` / `DUCK_FADE_DUR` 定数
- 2026-05: トーク中音量を UI 入力化 (% 表記、デフォルト 30%)。intro/outro 別 → `introDuckLevel` / `outroDuckLevel`
- 2026-05: 擬似ステレオ (EQ split 方式)。L=3500/+2dB+325/-1dB, R=逆相
- 2026-05: 最終 `alimiter=limit=0.89` を全フィルタに追加 (mix 後のクリップ防止)
- 2026-05: speech チェーンを `acompressor + dynaudnorm + loudnorm` → `loudnorm` のみに簡素化。3 段ダイナミック処理の重複を解消
- 2026-05: 歯擦音 de-esser を `adynamicequalizer` で実装、loudnorm の後ろに配置 (再増幅されないように)
- 2026-05: ズームプリセット (全体/中/詳細) を 3 波形に追加。MAX_WAVEFORM_ZOOM = 48
- 2026-05: トーク/イントロ/アウトロにジャンプボタン (⏮ 先頭 + 黄/赤/緑 ハンドル位置) を追加。preview.js の jumps[] config で柔軟に
- 2026-05: 6 個の用語に ⓘ 説明モーダルを追加 (LUFS / 基本音量 + トーク中音量 / トーク開始位置 / トーク終了位置 / 使用範囲 / MP3 ビットレート)。`infoModalEntries` 配列で配線を集約
- 2026-05: モーダル下部のログを折りたたみ式に (ログを見る ▼ / ログを隠す ▲)
- 2026-05: ステータスメッセージ末尾の `...` をアニメーション化 (loading 表現)
- 2026-05: アクション排他化 (試聴/書き出しを同時実行できないように)。`runExclusiveAction` ヘルパー
- 2026-05: プレビュー速度最適化 (kind 別フィルタ + 必要 BGM のみ書き込み)
- 2026-05: フッター追加 (© FjordBootCamp + View on GitHub リンク)
- 2026-05: MIT ライセンス追加 → OSS 化
- 2026-05: Cloudflare Pages デプロイ。`_headers` で COOP/COEP、`@ffmpeg/core` を jsDelivr CDN、`vendor/` で `@ffmpeg/ffmpeg`+`util` をコミット。`npm run build` で `dist/` 生成
- 2026-05: トーク試聴に末尾ジャンプボタン (⏭) 追加。jumps config に `target: "end"` の特別値を追加
- 2026-05: モーダル focus trap 実装。開く前の active 要素を保存、Tab を内部循環、閉じたら戻す
- 2026-05: CDN/ネットワーク障害時のエラー文言改善 (`isNetworkLikeError` で判別)
- 2026-05: 設定値の localStorage 永続化 (`wraptalk:settings:v1`)。trim と file 選択を除く全数値入力 + MP3 bitrate radio を保存・復元
- 2026-05: D&D ファイル受け取り。各 c--media-panel に drop/dragover 配線
- 2026-05: 進捗 % をステータスに表示 (`音声処理中... 35%`)。`renderStatus(base, percent)` ヘルパー
- 2026-05: 波形に時刻軸 (`.c--waveform-time-axis`)。canvas のスクロール領域にスクロール連動、interval は zoom に応じて自動選択
- 2026-05: 入力フォーカス時のハンドル halo 強調。focusedHandle を controller に持たせ、`drawFocusHalo` で発光
- 2026-05: 波形の再生位置縦線を黒 → 白に変更 (ダークモード視認性)
- 2026-05: クランプ範囲入力検証 (`assertInRange`) + ネットワークエラー判定 (`isNetworkLikeError`) を utils に移動、テスト 7 件追加
- 2026-05: preview の renderWaveform に token 機能を追加 (file 切替時の race condition 対策)
- 2026-05: waveform-loader の ffmpeg cleanup を try/finally に
- 2026-05: 数値入力のネイティブスピンを非表示、JS で attached なステッパー (`±`) を全数値 input にラッピング
- 2026-05: .l--inline-setting をラベル上 / 入力 + ◉ ボタン下の構造に明示化 (`.l--inline-setting-controls` 追加)。flex-wrap の暗黙挙動依存を解消
- 2026-05: 使用範囲・フェードに `〜` セパレータ (flex:1 で中央寄せ)
- 2026-05: 設定カード幅 360 → 400px、MP3 ビットレートラジオを横並びに
- 2026-05: package.json に "type": "module" を追加 (node --test の警告抑制)
- 2026-05: FfmpegRuntime を直列化。`#loadPromise` で並行 load を共有、`#queue` で write/exec/read を順次実行 (波形 decode と export の競合を防止)
- 2026-05: renderTimeAxis をキャッシュ (duration/width/interval キー)、timeupdate での DOM 再構築をスキップ
- 2026-05: podcast_auto.sh の冒頭にレガシー注記を追加 (ブラウザ版とは音声処理が違う旨)
- 2026-05: ObjectURL revoke を click() 直後即時 → 1秒遅延に (ブラウザによってはダウンロード開始前の revoke で失敗するため)
- 2026-05: D&D に accept 検証 (`isAcceptableFile`) を追加。`audio/*` / `video/*` は file.type が空のとき拡張子 fallback (AUDIO_EXTENSIONS / VIDEO_EXTENSIONS) で受け付け
- 2026-05: D&D 不正ファイル時のエラーをカード meta に `.is--error` で表示 (status block 非表示時にもユーザーに気付かせる)
- 2026-05: dragleave 判定を `event.target === card` → `event.relatedTarget` ベースに (子要素経由でカード外へ抜けるケースの取りこぼし対策)
- 2026-05: build script から `dist/web/*.test.js` を除外 (公開成果物に test が混入しないように)
- 2026-05: localStorage の mp3Bitrate 復元を querySelector への value 埋め込み → ループ + `.value` 比較に。改ざんされた値で SyntaxError にならないように
- 2026-05: 「初期値に戻す」ボタンを 設定完了 の右に追加。`persistedInputs` 全てを `defaultValue` に戻し、ラジオを `defaultChecked` に、localStorage クリア。confirm dialog で誤操作防止
- 2026-05: FfmpegRuntime を session-based API に変更。`withLock(fn)` が `fn(session)` を呼ぶ形に。session には writeFile/exec/readFile/cleanupFiles が含まれ、callback 終了時に invalidate されて外部から呼べない
- 2026-05: `decodeWaveformWithFFmpeg` / `runMix` / `renderMixPreview` を withLock 内で atomic に。固定ファイル名 (`waveform_input.*` 等) を共有するため、write/exec の interleave を mutex で防止
- 2026-05: `renderMixPreview` のフィルタ生成ロジックを `buildPreviewFilter()` 純関数に分離。withLock 内のインデント崩れも修正
- 2026-05: preview の prepare token を **per-controller** に。`previewSession` シングルトンの global token を撤去し、`PreviewController.prepareToken` に。別コントローラのファイル変更で他コントローラの prepare がキャンセルされる問題を解消
- 2026-05: prepare の abort sentinel を `ABORT_ERROR_MESSAGE` / `isAbortError()` で共通化。seek / setButton ハンドラも `ensureReady()` 経由に統一して abort ログ漏れを防止
- 2026-05: 「動作環境について」を `<details>` accordion から **モーダル** に変更。infoModalEntries に組み込み Esc / focus trap も活用。内容を 5 セクション (ブラウザ内処理 / 推奨ブラウザ / ファイルサイズ / 初回読み込み / データ保存) に拡充

## Open Questions

- ミックス済みプレビューを足す場合の設計:
  - 低品質クイックレンダ vs 本番と同一のフルレンダ（書き出し兼用キャッシュ）
- ブラウザ版を本体に据えるか、シェル版を長尺の常用フォールバックとして残し続けるか

## 起動 / 開発の早見表

```bash
# ローカルで動かす
python3 -m http.server 8000   # → http://localhost:8000/

# テスト
npm test
```
