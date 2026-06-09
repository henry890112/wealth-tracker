# WealthTracker - 個人資產管理系統

React Native (Expo) + Supabase 的個人資產管理 App，支援多幣別、即時報價、趨勢分析。

## 功能特色

### 已實現功能

- **使用者認證**: Email/密碼註冊登入，Session 自動管理
- **深色/淺色/系統主題**: 全 App 一致的 ThemeContext，設定頁可切換
- **液態玻璃導覽列**: BlurView 毛玻璃效果底部 Tab Bar
- **資產總覽 (Dashboard)**:
  - 流動資產、投資資產、固定資產、應收款項、負債 五大分類
  - 無篩選時按類別分組；選投資資產時按台股/美股/虛幣分組
  - 本月變化金額顯示
  - 多幣別統一換算為基準貨幣
- **搜尋資產 (Search)**:
  - 即時熱門標的（CoinGecko 前 10 虛幣、Yahoo Finance 趨勢美股、FinMind 台股成交量前 10）
  - 支援漲跌幅/交易量/市值排序，漲跌幅可切換方向
  - 顯示市值、24h 振幅
  - TradingView K 線圖 Modal
  - 新增資產 Modal：持有股數 × 成本 × 槓桿倍數自動計算現值
- **新增資產 (AddAsset)**:
  - 投資資產：股數 × 成本 × 槓桿（預設 1x）自動計算
  - 其他類別：直接輸入金額
- **趨勢分析 (Charts)**:
  - 多時段折線圖（7d / 30d / 90d / 180d / 自定義）
  - 互動式甜甜圈圖：點擊類別鑽取至台股/美股/虛幣細分
  - 圖例含百分比進度條
- **交易紀錄 (Records)**:
  - 支援類型篩選（買入/賣出/調整）× 市場篩選（台股/美股/虛幣）
- **資產詳情 (AssetDetail)**: 個別資產交易歷史，買入/賣出/調整操作
- **AI 助理 (AIAnalysis)**:
  - 智能分析您的資產組合並提供專業理財建議
  - 支援語音輸入與文字輸入兩種模式
  - 可執行自然語言交易操作（買入、賣出、調整）
  - 提供單一資產的技術指標（RSI, MA）與新聞摘要分析
- **系統設定 (Settings)**: 基準貨幣切換、主題偏好、登出

### API 整合

- **Google Gemini API**: AI 聊天與語音轉文字
- **FinMind API**: 台股即時報價、搜尋、新聞與歷史數據
- **Yahoo Finance**: 美股即時報價、趨勢標的、新聞與歷史數據
- **Binance API**: 虛擬貨幣歷史數據
- **CoinGecko API**: 虛擬貨幣價格、成交量排名（附 Supabase 快取 fallback）
- **ExchangeRate API**: 匯率換算

所有 API 結果快取於 Supabase（5 分鐘 TTL）。

## 技術棧

- **Frontend**: React Native (Expo 54)
- **Backend**: Supabase (PostgreSQL + Auth)
- **UI**: Lucide React Native icons、expo-blur、react-native-svg
- **Charts**: React Native Chart Kit（折線圖）、自製 SVG 甜甜圈圖
- **Navigation**: React Navigation（底部 Tab + Stack）
- **Theme**: 自製 ThemeContext + AsyncStorage 持久化

## 安裝步驟

### 前置需求

- Node.js 18+
- Docker Desktop（本地 Supabase）
- Supabase CLI

### 1. 安裝依賴

```bash
cd WealthTracker
npm install --legacy-peer-deps
```

### 2. 設定 Supabase 本地環境

```bash
supabase start
supabase db reset
```

### 3. 設定環境變數

複製 `.env.example` 並重新命名為 `.env`：
```bash
cp .env.example .env
```

然後編輯 `.env` 檔案，填入以下變數：
- `EXPO_PUBLIC_SUPABASE_ANON_KEY`: 執行 `supabase start` 後輸出的 `anon key`。
- `EXPO_PUBLIC_GEMINI_API_KEY`: 您的 Google Gemini API Key（可從 [Google AI Studio](https://aistudio.google.com/app/apikey) 獲取）。

```env
EXPO_PUBLIC_SUPABASE_URL=http://localhost:54321
EXPO_PUBLIC_SUPABASE_ANON_KEY=<from supabase start output>
EXPO_PUBLIC_GEMINI_API_KEY=<your_gemini_api_key>
```

### 4. 啟動

```bash
# 推薦：若想要 App 運行速度更快 (生產模式/壓縮/穿透)，請使用此指令：
npx expo start --no-dev --minify --tunnel
```

```bash
# 標準開發模式 (支援熱重載、除錯資訊)
npm start        # Expo dev server
npm run ios      # iOS simulator
npm run android  # Android emulator
```

## 資料庫結構

| 表 | 用途 |
|---|---|
| `profiles` | 基準貨幣、主題偏好 |
| `assets` | 資產（含 category、market_type、shares、cost） |
| `transactions` | BUY / SELL / ADJUST 記錄 |
| `daily_snapshots` | 每日淨資產快照（驅動趨勢圖） |
| `price_cache` | 股票/虛幣價格快取 |
| `exchange_rates` | 匯率快取 |

**觸發器:**
- `handle_new_user` — 新用戶自動建立 profile
- `update_asset_after_transaction` — BUY/SELL 後更新股數與均價（ADJUST 略過）

## 專案結構

```
WealthTracker/
├── App.js                        # 入口：ThemeProvider + GlassTabBar + Navigation
├── src/
│   ├── lib/
│   │   ├── supabase.js           # Supabase 客戶端
│   │   └── ThemeContext.js       # 深色/淺色/系統主題 Context
│   ├── services/
│   │   └── api.js                # FinMind / Yahoo / CoinGecko / ExchangeRate
│   └── screens/
│       ├── AuthScreen.js
│       ├── DashboardScreen.js
│       ├── SearchScreen.js
│       ├── TrendsScreen.js
│       ├── RecordsScreen.js
│       ├── SettingsScreen.js
│       ├── AssetDetailScreen.js
│       └── AddAssetScreen.js
└── supabase/
    └── migrations/               # 資料庫 Schema
```

## 部署到 Supabase Cloud

```bash
supabase login
supabase link --project-ref <ref>
supabase db push
```

更新 `.env` 為雲端 URL 和 anon key 後重啟。

## 常見問題

**Q: 虛幣沒有顯示？**
A: CoinGecko 免費 API 有 rate limit，App 會自動 fallback 至 Supabase 快取，5 分鐘後重試即可。

**Q: 圖表無法顯示？**
A: 需要至少兩天的每日快照。新增資產後系統會自動建立快照，隔天即可看到趨勢圖。

**Q: Supabase 無法啟動？**
A: 確認 Docker Desktop 正在運行，且 54321-54324 埠未被占用。

**Q: App 啟動後出現 `TypeError: Cannot read property '...' of undefined` 紅畫面？**
A: 這通常是依賴版本錯位導致。請嘗試以下步驟徹底重置環境：
```bash
rm -rf node_modules package-lock.json
npm install --legacy-peer-deps
npx expo start -c --tunnel
```
