# 功能模組邊界

此目錄按功能承接原本集中在 `src/screens` 與 `src/services/api.js` 的畫面、資料載入與計算。保留既有導覽入口與公開 API；新功能請直接在所屬模組開發。

## 目前已拆分

- `trends/tradePnl.js`：交易損益走勢、日／月變化、區間篩選與顯示格式。計算不依賴 React 畫面。
- `trends/components/TrendsCharts.js`：資產淨值、損益拆分與資產配置圖。資料由 `TrendsScreen` 傳入。
- `trends/components/PerformanceCalendar.js` 與 `DayDetailModal.js`：財報／損益日曆及當日明細畫面。
- `trends/hooks/useEarningsCalendar.js`：持倉、自選財報日期與市場日曆資料載入；`concurrency.js` 共用限流工具。
- `technical/components/`：法人籌碼、標的切換、策略選擇、策略庫、進出場與型態說明卡；`assetSelection.js` 專管標的合併與代碼正規化。
- `tradePlan/`：停損計算、雲端儲存、交易計畫卡片。舊 `services/tradePlan*.js` 與 `components/TradePlanCard.js` 僅保留相容轉出。
- `marketData/`：行情、搜尋與熱門標的、台股清單、匯率、歷史價格、台股籌碼及新聞。舊 `services/api.js` 僅保留相容轉出。

## 模組負責範圍

- 趨勢與財報日曆：`features/trends/`；`TrendsScreen.js` 保留畫面組裝、導覽與資產快照協調。
- 技術分析：`features/technical/`；`TechnicalAnalysisScreen.js` 保留分析流程、K 線圖協調與目前共用的樣式表。拆出的卡片目前透過 `styles` 屬性接收樣式，修改共用樣式仍需由整合者協調。
- 交易計畫：`features/tradePlan/`；總覽與資產詳情只呼叫同一套計算及儲存介面。
- 行情與資料來源：`features/marketData/`；`services/api.js` 是舊呼叫端的相容入口。財報資料另由既有 `services/financialReports.js` 維護，不要混入價格模組。

## 平行開發約定

- 一個對話負責一個功能模組；功能模組不直接匯入其他畫面檔案。
- `App.js`、`package.json`、`app.json`、iOS 設定、Supabase migration 與共用服務由整合者依序修改。
- 同一個 checkout 上同時編輯不同檔案仍可能遇到 Git 衝突；每個對話先看 `git status`，不要提交或覆蓋其他對話的未完成修改。
- 改動 `src/services/strategyEngines.js` 後，執行 `npm run sync:signal-engine` 同步通知函式使用的產生檔。
- 合併前執行 `node --no-warnings --test tests/*.test.mjs` 與對應平台的 Expo 打包；打包通過不等於實機驗證。
