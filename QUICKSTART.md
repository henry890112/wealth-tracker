# 🚀 WealthTracker 快速開始指南

這份指南將幫助您在 5 分鐘內啟動 WealthTracker 應用程式。

## ⚡ 快速安裝 (3 步驟)

### 步驟 1: 安裝依賴

```bash
cd WealthTracker
npm install
```

### 步驟 2: 啟動 Supabase (本地開發)

確保 Docker Desktop 正在運行，然後執行：

```bash
# 如果尚未安裝 Supabase CLI
npm install -g supabase

# 啟動 Supabase
supabase start

# 應用資料庫 schema
supabase db reset
```

**重要**: 記下 `supabase start` 輸出的 `anon key`，稍後會用到。

### 步驟 3: 設定環境變數並啟動

```bash
# 複製環境變數範本
cp .env.example .env

# 編輯 .env 檔案，填入 anon key (從步驟 2 取得)
# EXPO_PUBLIC_SUPABASE_ANON_KEY=<your-anon-key>

# 啟動應用程式
npm start
```

完成！現在您可以：
- 按 `a` 在 Android 模擬器開啟
- 按 `i` 在 iOS 模擬器開啟  
- 按 `w` 在瀏覽器開啟
- 掃描 QR code 在實體手機開啟 (需安裝 Expo Go App)

## 📱 首次使用

1. **註冊帳號**
   - 輸入 Email 和密碼
   - 點擊「註冊」

2. **新增第一筆資產**
   - 點擊底部「搜尋資產」
   - 搜尋 "2330" (台積電) 或 "AAPL" (Apple)
   - 選擇分類為「投資資產」
   - 輸入持有股數和成本
   - 點擊「新增資產」

3. **查看資產總覽**
   - 返回「資產總覽」頁面
   - 查看您的淨資產和資產分類

4. **設定基準貨幣**
   - 前往「設定」頁面
   - 選擇您偏好的基準貨幣 (預設為 TWD)

## 🔍 測試功能

### 測試搜尋功能

```
台股: 2330, 2317, 2454
美股: AAPL, GOOGL, MSFT, TSLA
虛幣: bitcoin, ethereum
```

### 查看 Supabase Studio

瀏覽器開啟 `http://localhost:54323` 可以直接管理資料庫。

### 測試趨勢圖

新增資產後，系統會自動建立每日快照。前往「趨勢分析」查看圖表。

## 🛠️ 常用指令

```bash
# 啟動應用程式
npm start

# 重新啟動 Supabase
supabase stop
supabase start

# 重置資料庫 (清除所有資料)
supabase db reset

# 查看 Supabase 狀態
supabase status
```

## ⚠️ 常見問題

### 問題: npm install 失敗
**解決**: 確保使用 Node.js 18 或更高版本
```bash
node --version  # 應該顯示 v18.x.x 或更高
```

### 問題: supabase start 失敗
**解決**: 
1. 確認 Docker Desktop 正在運行
2. 檢查端口 54321-54324 是否被佔用
3. 嘗試 `supabase stop` 然後重新 `supabase start`

### 問題: 應用程式無法連接資料庫
**解決**: 
1. 檢查 `.env` 檔案是否存在
2. 確認 `EXPO_PUBLIC_SUPABASE_ANON_KEY` 已正確填入
3. 重新啟動 Expo 開發伺服器 (`npm start`)

### 問題: 搜尋功能沒有結果
**解決**: 
- 台股搜尋需要完整代碼 (例如: "2330")
- 美股搜尋目前僅支援常見股票
- 虛幣搜尋使用完整名稱 (例如: "bitcoin")

## 📚 下一步

- 閱讀完整的 [README.md](./README.md) 了解更多功能
- 查看 [SDD.md](../SDD.md) 了解系統設計
- 探索 Supabase Studio 了解資料庫結構

## 💡 提示

- 使用 `Ctrl+C` 停止 Expo 開發伺服器
- 使用 `r` 重新載入應用程式
- 使用 `m` 切換選單
- 開發時修改程式碼會自動熱重載

---

**遇到問題？** 檢查終端機的錯誤訊息，通常會提供解決方案的提示。
