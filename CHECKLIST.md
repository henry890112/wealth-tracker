# WealthTracker 專案檢查清單

## 檔案結構

### 根目錄
- [x] `App.js` — ThemeProvider + GlassTabBar + Navigation
- [x] `package.json`
- [x] `app.json`
- [x] `babel.config.js`
- [x] `.gitignore`
- [x] `.env.example`

### src/lib/
- [x] `supabase.js`
- [x] `ThemeContext.js` — 深色/淺色/系統主題

### src/services/
- [x] `api.js` — FinMind / Yahoo Finance / CoinGecko / ExchangeRate

### src/screens/
- [x] `AuthScreen.js`
- [x] `DashboardScreen.js`
- [x] `SearchScreen.js`
- [x] `TrendsScreen.js`
- [x] `RecordsScreen.js`
- [x] `SettingsScreen.js`
- [x] `AssetDetailScreen.js`
- [x] `AddAssetScreen.js`

### supabase/
- [x] `config.toml`
- [x] `migrations/` — 資料庫 Schema + trigger 修正

---

## 資料庫

### 資料表
- [x] `profiles`
- [x] `assets`（含 market_type 欄位）
- [x] `transactions`
- [x] `daily_snapshots`
- [x] `exchange_rates`
- [x] `price_cache`

### 觸發器
- [x] `handle_new_user`
- [x] `update_asset_after_transaction`（ADJUST 略過，避免覆蓋手動金額）

### 函數
- [x] `create_daily_snapshot`

### 安全性
- [x] RLS 啟用於所有使用者資料表
- [x] price_cache / exchange_rates 公開讀取

---

## 功能

### 認證
- [x] 註冊 / 登入 / 登出
- [x] Session 自動管理

### 主題
- [x] 深色 / 淺色 / 跟隨系統
- [x] AsyncStorage 持久化
- [x] 全 App 一致套用

### 導覽
- [x] 5 個底部 Tab（總覽/搜尋/圖表/紀錄/設定）
- [x] GlassTabBar（BlurView 毛玻璃）
- [x] Stack Navigator（AssetDetail、AddAsset）

### 資料刷新
- [x] 所有畫面使用 `useFocusEffect`（切換 Tab 自動刷新）

### 資產總覽
- [x] 淨資產 hero + 本月變化
- [x] 五類別卡片
- [x] 資產列表按類別分組（無篩選）
- [x] 投資資產按市場分組（台股/美股/虛幣）
- [x] 下拉刷新

### 搜尋
- [x] 熱門標的即時抓取（CoinGecko / Yahoo / FinMind）
- [x] 漲跌幅雙向 / 交易量 / 市值 排序
- [x] 市值、24h 振幅顯示
- [x] CoinGecko fallback（Supabase cache → simple/price）
- [x] TradingView 圖表 Modal
- [x] 新增 Modal：股數 × 成本 × 槓桿
- [x] 下拉刷新熱門標的

### 新增資產
- [x] 五大類別
- [x] 投資：股數 × 成本 × 槓桿（預設 1x）
- [x] 其他：手動輸入金額
- [x] 自動建立交易記錄與快照

### 趨勢圖表
- [x] 多時段（7d/30d/90d/180d/自定義）
- [x] 折線圖（動態 baseline）
- [x] 甜甜圈圖可互動（點擊鑽取類別）
- [x] 單一資產顯示完整圓環
- [x] 圖例含百分比進度條

### 紀錄
- [x] 類型篩選（買入/賣出/調整）
- [x] 市場篩選（台股/美股/虛幣/其他）

### 設定
- [x] 基準貨幣
- [x] 主題偏好
- [x] 登出

---

## API

| API | 用途 | 快取 |
|-----|------|------|
| FinMind | 台股報價、搜尋 | Supabase 5 min |
| Yahoo Finance | 美股報價、trending | Supabase 5 min |
| CoinGecko | 虛幣報價、markets 排名、搜尋 | Supabase 5 min |
| ExchangeRate | 匯率換算 | Supabase 5 min |

---

**最後更新**: 2026-03-28
