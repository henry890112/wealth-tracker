# WealthTracker 專案總結

## 專案概述

個人資產管理 App，採用 React Native (Expo 54) + Supabase，支援多幣別、即時報價、趨勢分析與交易紀錄。

## 已完成功能

### 架構與 UI 基礎
- [x] Expo React Native 專案
- [x] Supabase 本地 Docker 環境
- [x] ThemeContext：深色 / 淺色 / 跟隨系統，AsyncStorage 持久化
- [x] GlassTabBar：BlurView 毛玻璃底部導覽列（5 tabs）
- [x] 所有畫面使用 `useFocusEffect` 於切換時自動刷新

### 資料庫
- [x] profiles、assets、transactions、daily_snapshots、price_cache、exchange_rates
- [x] RLS（每個使用者只能存取自己的資料）
- [x] `handle_new_user` trigger
- [x] `update_asset_after_transaction` trigger（BUY/SELL 更新均價；ADJUST 略過）
- [x] `create_daily_snapshot` RPC

### 認證
- [x] Email/密碼 註冊 / 登入 / 登出
- [x] Session 自動管理

### 資產總覽 (DashboardScreen)
- [x] 淨資產 hero 卡片（含本月變化）
- [x] 五類別卡片（流動/投資/固定/應收/負債）
- [x] 無篩選時：資產列表按類別分組顯示
- [x] 投資類別篩選：按台股/美股/虛幣分組顯示
- [x] 下拉刷新

### 搜尋資產 (SearchScreen)
- [x] 即時熱門標的（CoinGecko 前 10、Yahoo trending、FinMind 成交量前 10）
- [x] 漲跌幅（↑/↓ 切換）/ 交易量 / 市值 三種排序
- [x] 卡片顯示：市值、24h 振幅
- [x] CoinGecko rate limit fallback（Supabase 快取 → simple/price）
- [x] 搜尋台股（FinMind）/ 美股（本地清單）/ 虛幣（CoinGecko）
- [x] TradingView K 線圖 Modal
- [x] 新增資產 Modal：股數 × 成本 × 槓桿，鍵盤自動跳欄
- [x] 下拉刷新熱門標的

### 新增資產 (AddAssetScreen)
- [x] 五大類別選擇
- [x] 投資資產：股數 × 均價 × 槓桿（預設 1x）自動計算金額
- [x] 其他類別：手動輸入金額
- [x] 幣別選擇（液態玻璃 UI）
- [x] 新增後自動建立交易記錄與每日快照

### 趨勢分析 (TrendsScreen)
- [x] 時段選擇：7d / 30d / 90d / 180d / 自定義日期區間
- [x] 折線圖（動態 baseline，避免平坦問題）
- [x] 互動甜甜圈圖：點擊類別鑽取（投資 → 台股/美股/虛幣）
- [x] 圖例含百分比進度條，可點擊高亮
- [x] 單一資產時用 Circle 繪製完整圓環

### 交易紀錄 (RecordsScreen)
- [x] 類型篩選：全部 / 買入 / 賣出 / 調整
- [x] 市場篩選：全市場 / 台股 / 美股 / 虛幣 / 其他
- [x] 兩組篩選可同時使用

### 資產詳情 (AssetDetailScreen)
- [x] 資產基本資訊
- [x] 歷史交易列表
- [x] 買入 / 賣出 / 調整操作

### 系統設定 (SettingsScreen)
- [x] 基準貨幣切換（TWD/USD/EUR/JPY/CNY）
- [x] 主題偏好（深色/淺色/跟隨系統）
- [x] 登出

### API 整合
- [x] FinMind：台股報價與搜尋
- [x] Yahoo Finance：美股報價與 trending
- [x] CoinGecko：虛幣報價、markets 排名、搜尋
- [x] ExchangeRate API：匯率換算
- [x] 所有報價快取於 Supabase（5 分鐘 TTL）

## 待實作（可能的未來功能）

- [ ] 推播通知（價格警示）
- [ ] 批次匯入/匯出（CSV）
- [ ] 報表匯出（PDF）
- [ ] 多帳戶支援

## 技術亮點

1. **ThemeContext**：light/dark/system 三模式，全 App 一致深色主題
2. **GlassTabBar**：BlurView 毛玻璃浮動底部導覽，圓角 pill 活躍指示
3. **投資資產鑽取**：甜甜圈圖點擊 → 台股/美股/虛幣細分，支援返回
4. **useFocusEffect**：所有資料畫面切換即刷新，無陳舊資料問題
5. **CoinGecko 雙層 fallback**：markets API → Supabase cache → simple/price API
6. **槓桿計算**：股數 × 成本 × 槓桿倍數，統一於 AddAsset 和 SearchScreen Modal

## 顏色系統

- 主色（綠）：`#16a34a`
- 投資資產（黃）：`#f59e0b`
- 台股（紅）：`#e11d48`
- 美股（藍）：`#2563eb`
- 虛幣（黃橙）：`#f59e0b`
- 負債（紅）：`#ef4444`

---

**最後更新**: 2026-03-28
