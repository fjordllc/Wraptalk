# Refactor Progress: web/app.js の分割

> **このファイルは凍結アーカイブです。** 2026-05 セッションで web/app.js (当時 1516 行) を 7 ファイルに分割した時の作業ログを保存しています。今後新しいリファクタを記録する場合は本ファイルではなく、git log と [DEVELOPMENT_NOTES.md](./DEVELOPMENT_NOTES.md) の Recently Done に集約してください。
>
> 現在のコード状態は [DEVELOPMENT_NOTES.md](./DEVELOPMENT_NOTES.md) を参照してください。当時のフェーズごとの差分・設計判断・線量の推移はスナップショットとしてここに残しています。

開始時点: `web/app.js` 1516行 / `web/mix.js` 33行

## 目標構成

- `web/app.js`: 起動と DOM 取得・コントローラ配線のみ（< 400行目安）
- `web/utils.js`: 純粋関数（数値パース、時刻フォーマット、拡張子取り出しなど）
- `web/waveform.js`: 波形描画、ズーム、ハンドル系（fade / target / trim）、カーソル
- `web/preview.js`: プレビュー再生、再生UI、コントローラ生成、プレビュー由来のグローバル状態
- `web/mix.js`: ffmpeg のロード・実行・補助、デフォルト URL 定数、buildFilter

## 着手順

1. utils.js（依存が少なく安全 = ベースライン作りに最適）
2. waveform.js（controller を引数で受ける純粋関数群で抽出しやすい）
3. preview.js（モジュール内グローバル状態の閉じ込めが要設計）
4. mix.js 拡張（ffmpeg 関連の集約）

各フェーズの最後で:
- `node --check` で構文 OK
- ブラウザを headless で起動して 200 + コンソールエラー無しを確認
- このファイルを更新

## 設計メモ

### updatePreviewUI への循環依存

`drawWaveform` は今は同じファイル内なので問題ないが、waveform.js に出すと preview.js の `updatePreviewUI` を呼ぶ箇所で循環依存が起きる可能性。

回避策:
- A) `updatePreviewUI` 内で `drawWaveform` を呼ぶ流れを変える（callback パターン）
- B) waveform.js が更新後に外部から提供された `onChange` を呼ぶ
- C) `drawWaveform` だけは waveform.js、`updatePreviewUI` は preview.js、preview.js が waveform.js を import するだけの一方向

→ **C を採用予定**。`drawWaveform` は副作用が描画だけなので、preview.js から呼べばよく、waveform.js は preview.js を import しない。

### controller オブジェクト

現状の `createPreviewController` が controller を作り、後段で `controller.canvas` 等を上書きする方式。プレビューと波形の境界では同じ controller を共有する。

`controller` は preview.js から export して、waveform.js は型として認識するだけ（JS なので実体は走る側で）。

### モジュール内グローバル状態

`activePreview` 系は preview.js 内に閉じ込めた後、外には `togglePreview / stopPreview / getActiveController()` だけ export する。

## 進捗ログ

### Phase 1: utils.js ✅
- 抽出: parseOptionalNumber / parseRequiredNumber / parseNumberInput / clamp01 / formatTime / extFromName
- app.js: 1516 → 1488 行
- 構文チェック OK、HTTP 200
- DOM 依存の appendLog / resetLog / setStatus / setProgress は app.js に残置（次の波形/プレビュー抽出後にまとめて検討）

### Phase 2: waveform.js ✅
- 抽出: MIN/MAX/STEP zoom 定数、extractPeaks、getWaveformZoom、refreshWaveformZoomUI、updateWaveformZoom、resizeWaveformCanvas、drawWaveform、setWaveformStatus、getFadeHandlePositions/Hit、getTargetHandlePosition/Hit、getTrimHandlePositions/Hit、updateCanvasCursor
- update*FromPointer 3関数は updatePreviewUI を呼ぶため、app.js に残置（次フェーズで preview.js に移動するか検討）
- app.js: 1488 → 1131 行 / waveform.js: 374 行
- 構文チェック OK、HTTP 200、ブラウザで描画確認 OK

### Phase 3: preview.js ✅
- 抽出: state (activePreview / activePreviewButton / activePreviewController / previewToken)、createPreviewController、setupPreviewController、updatePreviewUI、getFadeMultiplier、applyPreviewVolume、resolvePreviewSource、stopPreview、preparePreview、ensurePreviewReady、seekPreviewFromPointer、togglePreview、updateFadeFromPointer、updateTargetFromPointer、updateTrimFromPointer、refreshPreviewButtonAvailability
- preview.js は internal state を閉じ込め、外部からは getActivePreviewController() でのみ読み取れる
- ロガー注入は setPreviewLogger(appendLog) のセットアップ呼び出しで実現（preview.js は DOM 知らず）
- app.js: 1131 → 796 行 / preview.js: 372 行
- 構文 OK、HTTP 200、ブラウザ描画 OK

### Phase 4: mix.js 拡張 ✅
- 抽出: DEFAULT_INTRO_URL / DEFAULT_OUTRO_URL / DEFAULT_INTRO_NAME / DEFAULT_OUTRO_NAME、outputNameFromInput、cleanupFfmpegFiles (ffmpeg を引数化)、getMediaDurationSeconds
- 保留: loadFFmpeg と processAudio は DOM 依存 (setStatus / appendLog / processButton / 入力欄読み取り) が重いため app.js に残置。次のステップで「processAudio を spec 化 → app.js は spec を作って mix.js に渡す」設計を検討する
- decodeWaveformWithFFmpeg、fetchAudioArrayBuffer、getAudioContext も app.js に残置 (renderWaveform から呼ばれるため)
- app.js: 796 → 747 行 / mix.js: 33 → 91 行
- 構文 OK、HTTP 200、ブラウザ描画 OK

### Phase 5: loadFFmpeg を mix.js へ ✅
- 抽出: FFmpeg singleton、isLoaded、listenerバインド (configureFFmpeg with onLog/onProgress callbacks)
- ensureFFmpegLoaded / getFFmpeg / isFFmpegLoaded を公開
- app.js: 747 → 733 行 / mix.js: 91 → 139 行
- 設計: ffmpeg.on("log"/"progress") は mix.js モジュール init で一度だけバインド、callback は configureFFmpeg で差し替え。複数回 loadFFmpeg しても重複登録されない

### Phase 6: renderWaveform を preview.js へ ✅
- 当初は waveform.js に置く予定だったが、updatePreviewUI への依存で循環依存になるため preview.js に配置
- 抽出: renderWaveform、getAudioContext、fetchAudioArrayBuffer、decodeWaveformWithFFmpeg、waveformAudioContext singleton
- preview.js は mix.js (getFFmpeg, ensureFFmpegLoaded) を import するように（依存方向は preview → mix で一方向のまま）
- app.js: 733 → 621 行 / preview.js: 372 → 488 行

### Phase 7: processAudio を spec 化して mix.js へ ✅
- 抽出: runMix({ input, intro, outro, ...params, onStatus })
- mix.js 側で:
  - cross-field 検証 (fadeEnd >= fadeStart、talkTrimEnd > talkTrimStart など)
  - ffmpeg.writeFile / exec / readFile
  - cleanupFfmpegFiles
  - blob 生成 (`{ blob, filename }` を返す)
- app.js 側は DOM 値の parse、resolveAudioInput、blob のダウンロードトリガだけに
- app.js: 621 → 542 行 / mix.js: 139 → 239 行

### Phase 9: dom.js ✅
- `web/dom.js` を新設し、全 getElementById を集約
- app.js の上部 ~60行が import 1ブロックに置き換わり、DOM 配線が一覧化された
- 純粋に取得・export だけのモジュールなので変更履歴が追いやすい
- app.js: 542 → 543 行 (微増だが import が整理されたぶん可読性向上)

### Phase 10: utils.js + waveform.js のテスト追加 ✅
- `web/utils.test.js`: parseOptionalNumber / parseRequiredNumber / parseNumberInput / clamp01 / formatTime / extFromName。19 ケース
- `web/waveform.test.js`: getFadeHandlePositions/Hit / getTargetHandlePosition/Hit / getTrimHandlePositions/Hit。canvas と event を mock。16 ケース
- 全体: filter (10) + utils (19) + waveform (16) = **45 ケース全 pass**
- `npm test` で一括実行可能

### Phase 8: filter.js + テスト ✅
- buildFilter を `web/filter.js` に分離（mix.js は `export { buildFilter } from "./filter.js"` で再エクスポート）
- mix.js が `new FFmpeg()` を含むので Node から直接 import するとブラウザ依存で失敗する。filter.js は純粋関数のみ
- `web/filter.test.js` を追加 (node:test + node:assert/strict、依存無し)
- 10 ケース全部 pass: 通常ケース、トリム3パターン、loudnorm/fade 式の数値検証、zero-length fade のクランプ、outroStartMs の adelay 伝搬、デフォルトスペックのスナップショット
- 実行: `node --test web/filter.test.js`

## 最終状態

| File             | Lines |
|------------------|-------|
| app.js           | 517   |
| preview.js       | 488   |
| waveform.js      | 374   |
| mix.js           | 225   |
| dom.js           | 69    |
| filter.js        | 33    |
| utils.js         | 35    |
| **Total (src)**  | 1741  |
| filter.test.js   | 96    |
| utils.test.js    | 110   |
| waveform.test.js | 137   |
| **Total (test)** | 343   |

app.js は元の **1516 → 517** (66% 削減)。

OO Phase 後のクラス構成:
- `PreviewController` (preview.js) — コントローラとそのライフサイクル全体
- `PreviewSession` (preview.js) — アクティブな再生状態のシングルトン
- `FfmpegRuntime` (mix.js) — FFmpeg インスタンスのライフサイクル管理シングルトン

依存関係 (一方向):
```
dom.js ────────────────→ app.js
filter.js ── mix.js ──┐
utils.js ──┬──────────┤
           ↓          ↓
        waveform.js → preview.js → app.js
```

**テスト: 45 ケース全 pass**
- `web/filter.test.js`: 10 ケース (buildFilter のロジック + スナップショット)
- `web/utils.test.js`: 19 ケース (parse / clamp / formatTime / extFromName)
- `web/waveform.test.js`: 16 ケース (handle positions / hit-tests)

実行: `npm test`

### Phase A: PreviewController クラス化 ✅
- `controller` の plain object を `class PreviewController` に変更
- メソッド化: updateUI / applyVolume / refreshAvailability / seekFromPointer / prepare / ensureReady / toggle / updateFadeFromPointer / updateTargetFromPointer / updateTrimFromPointer / renderWaveform / handleSourceChange
- 旧 standalone 関数 (`updatePreviewUI`, `ensurePreviewReady`, etc.) を削除し、すべて `controller.method()` 呼び出しに
- 副次効果: file change handler の散発的な `controller.audio = null` 系を `handleSourceChange()` メソッドにまとめてカプセル化
- app.js: 521 行 / preview.js: 469 行

### Phase B: FfmpegRuntime クラス化 ✅
- `new FFmpeg()` インスタンスと isLoaded / log/progress リスナを `class FfmpegRuntime` に閉じ込め
- delegator メソッド (writeFile / exec / readFile / deleteFile / cleanupFiles) で raw な ffmpeg.method() 呼び出しを置き換え
- `export const ffmpegRuntime = new FfmpegRuntime()` のシングルトンとして提供
- `getFFmpeg() / configureFFmpeg() / isFFmpegLoaded() / ensureFFmpegLoaded()` を削除
- mix.js: 208 → 225 行 (Class 化のオーバーヘッドあり)

### Phase C: PreviewSession クラス化 ✅
- preview.js のモジュール状態 (activePreview / activePreviewButton / activePreviewController / previewToken) を `class PreviewSession` に閉じ込め、プライベートフィールドに
- 外部公開メソッド: `activeController` getter / `nextToken` / `currentToken` / `isPlayingOn(button)` / `isActiveAudio(audio)` / `activate(controller, audio)` / `stop()`
- `previewSession` シングルトンを export
- `stopPreview` / `getActivePreviewController` を削除（PreviewController 内部で `previewSession.stop()` / `previewSession.activeController` を呼ぶ）
- app.js: 521 → 517 行 / preview.js: 469 → 488 行

## 残りの作業（参考）

主要な分割・テストは全て完了。次にあれば便利だが必須ではないもの:

1. **preview.js のさらなる分解**: 488行で2番目に大きい。`renderWaveform` 群 (デコード) と `togglePreview`/`stopPreview`/etc (再生制御) を別モジュールにすれば各 ~250 行になる。
2. **mix.js の runMix を更に分解**: 現在 100 行強。ファイル書込/長さ計算/フィルタ実行/blob 生成のステップを別関数にすれば、それぞれ単体テスト可能になる。
3. **lint/format**: 現状 ESLint や Prettier 設定無し。整備すれば import の並び順などが自動化できる。

## 動作確認サマリ

各フェーズ完了後に以下で検証:
- `node --check web/<file>.js` で構文 OK
- `python3 -m http.server 8000` の上で `curl` で 200 確認
- Chrome headless でスクリーンショット取得して UI 崩れなしを目視

実ファイル選択→ミックス→mp3 書き出しのフル E2E は本ブラウザ環境では未テスト。ローカルで手動確認すること（特に Phase 3 のプレビュー周りは状態管理が変わったので、再生→停止→再生で位置が保持されるか、ファイル切替時にちゃんとリセットされるかは確認推奨）。

## このリファクタの最終状態（セッション完了時点）

すべてのフェーズ完了後、追加で行った関連改修も含めた最終形:

- **JS 分割完了**: `web/{app,dom,utils,waveform,preview,mix,filter}.js` の 7 ファイル + 3 テスト
- **OO 化完了**: `PreviewController` / `PreviewSession` / `FfmpegRuntime` クラス導入
- **クラス命名規則**: ITCSS 風プリフィックス (`l--` / `c--` / `u--` / `is--` / `js--` / `spec--`)
- **CSS 色変数化**: スタイル本体にハードコードカラー無し
- **その他**: `.c--setting-card-body` 導入、MP3 ビットレートのラジオ化、`.c--status` の初期非表示など

これ以降の改修は [DEVELOPMENT_NOTES.md](./DEVELOPMENT_NOTES.md) の `Recently Done` セクションを追って参照。
