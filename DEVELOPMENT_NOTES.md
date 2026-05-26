# Development Notes

## Current State

- ブラウザ版がメイン。`index.html` を HTTP で配信すれば動作する静的サイト
- 依存ランタイムは `ffmpeg.wasm` のみ（`node_modules/@ffmpeg/*` をローカルから配信）
- スタイル: `web/styles.css` 単一ファイル + ITCSS 風プリフィックス命名 + 12 セクションの TOC
- JS: ES Module で 7 ファイルに分割（`web/{app,dom,utils,waveform,preview,mix,filter}.js`）+ `web/*.test.js` × 3
- デフォルト音源は `opening.wav` / `ending.wav` をリポジトリ直下に配置
- 旧来のシェル版 `podcast_auto.sh` と `Wraptalk.app` は長尺フォールバックとして残置

## Module Layout (web/)

| File | Lines | 役割 |
|------|-------|------|
| `app.js` | 359 | エントリ。配線、ファイル選択、processAudio (DOM → spec → runMix → download)、handleLoadFFmpeg |
| `preview.js` | 588 | `PreviewController` / `PreviewSession` クラス。controller の `start()` でイベント配線も自己完結 |
| `waveform.js` | 400 | 波形描画、ズーム、各種ハンドルの位置計算 / hit-test、カーソル切替 |
| `mix.js` | 281 | `FfmpegRuntime` クラス、`runMix` (spec → mp3 blob) と分割されたステップ関数群 |
| `waveform-loader.js` | 84 | `loadAudioBuffer` (AudioContext + ffmpeg fallback デコード) |
| `dom.js` | 83 | 全 `getElementById` を集約、ラジオは `getMp3Bitrate()` 経由 |
| `utils.js` | 71 | 純粋関数 + JSDoc 型注釈付き |
| `filter.js` | 56 | `buildFilter` のみ。Node からテスト可能 |

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

`web/*.test.js` は `node:test` ベース。`npm test` で一括実行。

- `web/filter.test.js` (10 ケース) — buildFilter のロジック + スナップショット
- `web/utils.test.js` (19 ケース) — parse / clamp / formatTime / extFromName
- `web/waveform.test.js` (16 ケース) — handle positions / hit-tests (canvas mock)

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

- **進捗メッセージの細分化** — `ffmpeg コア読込` / `波形解析` / `プレビュー準備` / `ミックスレンダリング` / `mp3 書き出し` を別ステータスで表示
- **アクセシビリティ** — `form` / `fieldset` / `legend` でフォームグルーピング。波形ドラッグ操作のキーボード代替手段
- **preview 音源のクリーンアップ** — オブジェクト URL のライフサイクルをファイル切替時 / 反復再生時の観点で再点検

### P3

- D&D アップロード
- 波形に時刻ティック / マーカー表示
- 直近の設定値を `localStorage` に保存

## 検討して見送った変更

- **HTML の 3 media-section 重複の dedup**: input / intro / outro の `<section>` 構造は表面的に似ているが、`setting-card` 群の中身（トーク使用範囲 vs トーク開始位置 vs トーク終了位置 など）が section ごとに違うため、共通化の利得が少ない。`<template>` + JS clone や Web Components を入れると現在の「素の HTML/CSS/JS で完結する」シンプルさを損なう。差分は ~100 行で許容範囲。3 → 30 に増えるなら再検討する。

## UI 構成

- **ヒーロー**: タイトル + 概要 + `<details>`「動作環境について」（折りたたみで初期表示は省スペース）
- **3つの media-section**（トーク / イントロ / アウトロ）: 各 section に波形 + プレビュー/ズーム ツールバー + 設定カード群
- **音質 section（軽量）**: 見出しを `1.4rem / weight 700` に控えめにして他セクションと階層差を出している
- **ファイルメタ表示**: 各 section の `<p class="c--media-meta">` に、選択中のファイル名（`xxx を使用中`）またはデフォルト音源の案内を表示
- **設定完了ボタン**: 主画面の `.l--actions--sticky` で `position: sticky` 配置、画面下に常時アクセス可能
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
