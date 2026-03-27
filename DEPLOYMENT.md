# 🚀 WealthTracker 部署與遷移指南

本文件說明如何將 WealthTracker 專案遷移到其他裝置並啟動。

## 📦 方式一：使用 Git（推薦）

### 1. 在原始裝置上傳到 Git

```bash
cd WealthTracker

# 初始化 Git（如果還沒有）
git init

# 添加所有檔案
git add .

# 提交
git commit -m "Initial commit: WealthTracker v1.0"

# 推送到 GitHub（需要先在 GitHub 建立 repository）
git remote add origin https://github.com/your-username/wealth-tracker.git
git branch -M main
git push -u origin main
```

### 2. 在新裝置上下載

```bash
# Clone 專案
git clone https://github.com/your-username/wealth-tracker.git
cd wealth-tracker

# 安裝依賴
npm install

# 複製環境變數
cp .env.example .env
# 編輯 .env 填入您的設定

# 啟動專案
npm start
```

---

## 💾 方式二：直接複製檔案

### 1. 打包專案

在原始裝置上，將整個 `WealthTracker` 資料夾壓縮成 ZIP 檔案。

**重要：** 可以排除以下資料夾以減少檔案大小：
- `node_modules/` （會重新安裝）
- `.expo/` （會自動生成）

### 2. 在新裝置上解壓縮

```bash
# 解壓縮到目標位置
# 例如：C:\Projects\WealthTracker

# 進入專案目錄
cd WealthTracker

# 安裝依賴
npm install

# 複製環境變數
cp .env.example .env
# 編輯 .env 填入您的設定

# 啟動專案
npm start
```

---

## 🔧 新裝置環境需求

### 必須安裝的軟體

1. **Node.js 18+**
   - 下載：https://nodejs.org/
   - 驗證：`node --version`

2. **npm**（通常隨 Node.js 一起安裝）
   - 驗證：`npm --version`

3. **Git**（如果使用方式一）
   - 下載：https://git-scm.com/
   - 驗證：`git --version`

### 選擇性安裝（完整功能需要）

4. **Docker Desktop**（用於本地 Supabase）
   - 下載：https://www.docker.com/products/docker-desktop
   - 驗證：`docker --version`

5. **Supabase CLI**
   ```bash
   # Windows (使用 Scoop)
   scoop bucket add supabase https://github.com/supabase/scoop-bucket.git
   scoop install supabase
   
   # macOS (使用 Homebrew)
   brew install supabase/tap/supabase
   
   # Linux
   brew install supabase/tap/supabase
   ```

---

## 🚀 啟動步驟（完整版）

### 步驟 1: 安裝依賴

```bash
cd WealthTracker
npm install
```

### 步驟 2: 設定環境變數

```bash
# 複製範本
cp .env.example .env

# 編輯 .env 檔案
# Windows: notepad .env
# macOS/Linux: nano .env
```

填入以下內容：
```env
EXPO_PUBLIC_SUPABASE_URL=http://localhost:54321
EXPO_PUBLIC_SUPABASE_ANON_KEY=<從 supabase start 取得>
```

### 步驟 3: 啟動 Supabase（如果需要完整功能）

```bash
# 確保 Docker Desktop 正在運行

# 啟動 Supabase
supabase start

# 應用資料庫遷移
supabase db reset
```

記下輸出的 `anon key`，並更新到 `.env` 檔案中。

### 步驟 4: 啟動應用程式

```bash
npm start
```

然後：
- 按 `w` 在瀏覽器開啟
- 按 `a` 在 Android 模擬器開啟
- 按 `i` 在 iOS 模擬器開啟
- 掃描 QR code 在手機上開啟（需安裝 Expo Go）

---

## 📱 在手機上測試

### 1. 安裝 Expo Go App

- **iOS**: 從 App Store 下載 "Expo Go"
- **Android**: 從 Google Play 下載 "Expo Go"

### 2. 連接到開發伺服器

確保手機和電腦在同一個 Wi-Fi 網路下，然後：

1. 在電腦上執行 `npm start`
2. 使用手機掃描終端機顯示的 QR code
3. Expo Go 會自動開啟應用程式

---

## 🌐 部署到雲端（Supabase Cloud）

### 1. 建立 Supabase Cloud 專案

1. 前往 https://app.supabase.com
2. 點擊 "New Project"
3. 填寫專案資訊並建立

### 2. 連結本地專案到雲端

```bash
# 登入 Supabase
supabase login

# 連結到雲端專案
supabase link --project-ref <your-project-ref>

# 推送資料庫 Schema
supabase db push
```

### 3. 更新環境變數

編輯 `.env` 使用雲端連線資訊：

```env
EXPO_PUBLIC_SUPABASE_URL=https://<your-project-ref>.supabase.co
EXPO_PUBLIC_SUPABASE_ANON_KEY=<your-cloud-anon-key>
```

### 4. 重新啟動應用程式

```bash
npm start
```

---

## 🔍 常見問題排解

### Q: npm install 失敗
**解決方案：**
```bash
# 清除 npm 快取
npm cache clean --force

# 刪除 node_modules 和 package-lock.json
rm -rf node_modules package-lock.json

# 重新安裝
npm install
```

### Q: Expo 無法啟動
**解決方案：**
```bash
# 清除 Expo 快取
npx expo start -c

# 或重置 Metro bundler
rm -rf .expo
npm start
```

### Q: Supabase 無法連接
**解決方案：**
1. 確認 Docker Desktop 正在運行
2. 檢查 `.env` 檔案中的 URL 和 Key 是否正確
3. 重新啟動 Supabase：
   ```bash
   supabase stop
   supabase start
   ```

### Q: 手機無法連接到開發伺服器
**解決方案：**
1. 確認手機和電腦在同一個 Wi-Fi
2. 檢查防火牆設定
3. 使用 Tunnel 模式：
   ```bash
   npx expo start --tunnel
   ```

---

## 📋 快速檢查清單

在新裝置上啟動前，確認：

- [ ] Node.js 18+ 已安裝
- [ ] npm 已安裝
- [ ] 專案檔案已複製或 clone
- [ ] `npm install` 已執行
- [ ] `.env` 檔案已設定
- [ ] Docker Desktop 已安裝並運行（如需完整功能）
- [ ] Supabase CLI 已安裝（如需完整功能）
- [ ] `supabase start` 已執行（如需完整功能）
- [ ] `npm start` 可以正常啟動

---

## 🎯 簡化版啟動（僅 UI 測試）

如果您只想測試 UI，不需要資料庫功能：

```bash
# 1. 安裝依賴
npm install

# 2. 直接啟動（會顯示錯誤但 UI 可以看到）
npm start
```

**注意：** 這種方式下，登入和資料功能會無法使用，但可以看到所有畫面的 UI 設計。

---

## 📞 需要協助？

- 查看 `README.md` 了解完整功能說明
- 查看 `QUICKSTART.md` 了解快速開始步驟
- 查看 `PROJECT_SUMMARY.md` 了解技術細節
- 查看 `CHECKLIST.md` 確認所有設置是否完成

---

**最後更新：** 2026-03-27
**版本：** 1.0.0
