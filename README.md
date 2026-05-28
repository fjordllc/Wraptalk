# Wraptalk

ポッドキャスト録音をブラウザだけで仕上げるツール。トーク音源にイントロ・アウトロの BGM を重ね、トーク中は BGM の音量を自動で下げます。音量や音質の補正も内蔵なので、書き出した mp3 をそのまま配信できます。

🚀 **公開デモ**: https://wraptalk.pages.dev/

すべての処理はブラウザ内の `ffmpeg.wasm` で完結し、ファイルはサーバーに送信されません。

開発の経緯・設計メモは [DEVELOPMENT_NOTES.md](./DEVELOPMENT_NOTES.md) を参照してください。

## 特徴

- **音質補正**: ハイパス / ローカット EQ → ラウドネス正規化 (LUFS ターゲット) → ダイナミック de-esser で歯擦音抑制
- **擬似ステレオ**: モノラル音源の左右に微妙な EQ 差を入れて自然な広がりを演出
- **時刻ベース Ducking**: トークの開始・終了タイミングを envelope で表現し、トークが入ると BGM を自動で下げ、終わると元に戻す
- **最終リミッター**: ミックス後のクリップを `alimiter` で防止
- **波形 UI**: トーク / イントロ / アウトロそれぞれの波形にハンドルを表示、ドラッグで直感的に調整

## 使い方（ブラウザ版）

1. **トーク音源**（mp4 / 音声）、**イントロ**、**アウトロ** をアップロード
   - `opening.wav` / `ending.wav` がリポジトリ直下にあれば、イントロ/アウトロ未選択時のデフォルトとして使われます
2. 各波形のハンドルをドラッグで位置調整 or 数値入力で直接編集
3. `▶ 試聴` で個別の音源を試聴。`⏮ 黄 赤 緑` のジャンプボタンで重要位置にシーク
4. **「設定完了」** ボタン → モーダルが開いてプレビュー/書き出しへ
5. モーダル内: `オープニングを試聴` / `エンディングを試聴` で先頭・末尾 30s をプレビュー、`書き出す` で mp3 ダウンロード
6. 各設定項目の **ⓘ** をクリックすると説明モーダルが開きます

### 波形上の操作

| 場所 | ハンドル | 色 | 役割 |
|------|---------|----|------|
| トーク 波形 上端 | 開始位置 | 🟡 黄 | この時刻より前をカット |
| トーク 波形 上端 | 終了位置 | 🔴 赤 | この時刻より後をカット（`0` のままなら末尾まで使用） |
| イントロ 波形 上端 | トーク開始位置 | 🟡 黄 | イントロ内でトークがかぶり始める時刻 |
| アウトロ 波形 上端 | トーク終了位置 | 🔴 赤 | アウトロ内でトーク終わりが揃う時刻 |
| イントロ / アウトロ 波形 下端 | フェード開始 / 終了 | 🟢 緑 | BGM のフェードアウト区間 |
| 波形本体 | – | – | クリック / ドラッグで再生位置シーク |

波形上では `全体 / 中 / 詳細` プリセットと `+/-` で 1〜48 倍ズーム可能。

### 設定項目

- **目標 LUFS** — 話し声のラウドネス目標値（初期値 `-16`、Podcast 配信標準）
- **基本音量** — トークが乗っていない区間での BGM 音量。`%` 表記で、`100%` = アップロードした音源そのままの振幅（初期値 `100%`）
- **トーク中音量** — 基本音量に対する Ducking 後の割合（初期値 `30%`）
- **MP3 ビットレート** — 128 / 160 / 192 kbps から選択

### キーボードショートカット（試聴中）

- <kbd>Space</kbd> 再生・停止トグル（最後に再生していたもの、なければトーク試聴）
- <kbd>,</kbd> 5 秒戻る / <kbd>.</kbd> 5 秒進む
- 入力欄・ボタンに focus があるとき、モーダル表示中は無効

### 前提

- `file://` 直開きではなく、HTTP で配信してください（後述）
- 推奨ブラウザ・ファイルサイズ目安・初回読み込みの所要時間・キーボードショートカット等の詳細は、サイト内の **「動作環境について」モーダル** を一次情報源として参照してください

## ローカル開発

### サーバー起動

バックエンドや専用フレームワークは無く、素の HTML / CSS / JS + `ffmpeg.wasm` だけで動く静的サイト。リポジトリ直下を HTTP 配信できれば何でも構いません。

```bash
# Python (macOS 標準で OK)
python3 -m http.server 8000

# Node.js
npx serve .

# Ruby
ruby -run -e httpd . -p 8000
```

http://localhost:8000/ を開いてください。

### テスト

純粋関数（フィルタ式、ユーティリティ、波形ヒット判定など）にユニットテストがあります。

```bash
npm test    # node --test web/*.test.js (76 ケース)
```

ソースの構成・命名規則・依存関係は [DEVELOPMENT_NOTES.md](./DEVELOPMENT_NOTES.md) を参照。

## インフラ・デプロイ

Cloudflare Pages にデプロイしています。GitHub の main ブランチに push すると自動ビルド・自動デプロイされます。

### 構成

| | |
|---|---|
| **ホスティング** | Cloudflare Pages (無料枠、帯域無制限) |
| **ビルド** | `npm run build`（リポジトリのスタティック資産を `dist/` にコピー） |
| **配信 URL** | https://wraptalk.pages.dev/ |
| **ffmpeg-core wasm** | jsDelivr CDN から読み込み（32MB を CDN 任せにして Pages の 1 ファイル 25MiB 制限を回避） |

### COOP / COEP ヘッダー

`ffmpeg.wasm` のマルチスレッド動作には `SharedArrayBuffer` が必要で、そのためには以下の HTTP ヘッダーが必須:

```
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp
```

`_headers` ファイルに記述すると Cloudflare Pages が全レスポンスに自動付与してくれます。

### ビルド設定（Cloudflare Pages）

- **Framework preset**: None
- **Build command**: `npm run build`
- **Build output directory**: `dist`
- **Root directory**: `/`

### 依存

| 依存 | バージョン | 配信方法 |
|---|---|---|
| `@ffmpeg/ffmpeg` | 0.12.10 | `vendor/` にコミット |
| `@ffmpeg/util` | 0.12.1 | `vendor/` にコミット |
| `@ffmpeg/core` | 0.12.10 | jsDelivr CDN |

`vendor/` は `node_modules/@ffmpeg/{ffmpeg,util}` を手動コピーしたもの（runtime に必要な ESM ファイルだけ）。`node_modules` は gitignore 済み。

## 前提と非機能要件

- トークの細かいカット編集は対象外（トーク使用範囲の前後カットのみ）
- イントロ / アウトロは毎回同じ素材を使う想定
- しゃべり出しは録画ファイルの先頭からそのまま使う前提

## レガシー: シェル版 / Mac アプリ版

長尺（60 分超）の mp4 をローカルの ffmpeg で確実に処理したい場合のフォールバック。`podcast_auto.sh` を直接、または `Wraptalk.app` をダブルクリックで起動。

音声処理チェーンはブラウザ版に揃えてあります（時刻ベース Ducking・de-esser・擬似ステレオ・BGM フェードアウト・最終リミッター）。意図的な差分は、intro/outro 共通の `--duck-level` 1 つと、トーク使用範囲トリム無しの 2 点です。

- 必要: `ffmpeg`, `ffprobe`(`/opt/homebrew/bin/` などにインストール済み)
- 直接実行: `./podcast_auto.sh --input ... --intro ... --outro ... --output ...`
- 主要オプション: `--intro-pad`, `--outro-overlap`, `--voice-lufs`, `--music-volume`（基本音量 0-1、既定 1.0）, `--duck-level`（トーク中音量 0-1、既定 0.3）, `--mp3-bitrate`
- BGM フェードアウト（任意）: `--intro-fade-start/end`, `--outro-fade-start/end`（BGM ソース秒。start と end の両方を指定したとき有効。未指定なら BGM は全長）
- `Wraptalk.app` はダイアログ操作だけで完結

## 次にやると良いこと

- 進捗メッセージの細分化、アクセシビリティ整備
- 直近設定の `localStorage` 保存
- シェル版: 入力フォルダ監視で録画ファイルを置いたら自動処理

## ライセンス

[MIT License](./LICENSE) © FjordBootCamp
