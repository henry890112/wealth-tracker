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
- 若要安裝到實體 iPhone，請依下方「在 iPhone 使用（免費 Xcode Personal Team）」的步驟操作

---

## 📱 在 iPhone 使用（免費 Xcode Personal Team）

本專案採用 **Xcode 本機 Development Build**，不需要付費的 Apple Developer Program，也不需要 EAS Build 或 Expo Go。這個方式僅限自己使用的 iPhone，App 的免費簽章每 7 天會到期一次。

### 前置需求

- Mac 已安裝最新版 Xcode，並至少開啟一次以完成授權。
- 在 Xcode 的 **Settings → Accounts** 登入自己的 Apple Account；未付費帳號會顯示為 **Personal Team**。
- iPhone 以 USB 連接 Mac、解鎖並按下「信任這部電腦」。
- 若要在 iPhone 正常登入與同步資料，請先完成下方的「部署到雲端（Supabase Cloud）」設定。手機無法使用 `http://localhost:54321` 連到 Mac 的本機 Supabase。

### 第一次安裝到 iPhone

在專案目錄執行：

```bash
npx expo run:ios --device
```

依提示選擇已連線的 iPhone。Expo 會產生必要的 iOS 專案、呼叫 Xcode 編譯，並把 WealthTracker 安裝到手機。

若 Xcode 顯示簽章錯誤，請開啟 iOS workspace，選擇 App target 的 **Signing & Capabilities**，在 **Team** 選擇自己的 **Personal Team**，然後再次執行上述命令：

```bash
open ios/WealthTracker.xcworkspace
```

### 日常使用與程式更新

建議讓手機與 Mac 在同一個 Wi-Fi，然後在 Mac 啟動開發伺服器：

```bash
npx expo start --dev-client --lan
```

用手機上的 WealthTracker 開啟專案或掃描顯示的 QR code。正常時網址會是 `192.168.x.x` 或 `10.x.x.x`。

若手機與 Mac 不在同一個網路，仍可使用 Tunnel；兩台裝置都必須能上網，且 Mac 必須持續運行開發伺服器：

```bash
npx expo start --dev-client --tunnel --clear
```

Tunnel 產生的 `exp.direct` 網址可跨網路連線，但載入與熱更新較慢，且依賴 ngrok 服務。若終端機顯示 `failed to start tunnel`、`session closed`，或 App 無法連到 `exp.direct`，請改用同一個 Wi-Fi 的 LAN 模式；外出時也可讓 Mac 連上 iPhone 個人熱點後使用 LAN 模式。

## 玉山證券唯讀同步

玉山同步由 Mac 上的 `esun-bridge` 處理憑證與 SDK 登入。bridge 僅提供庫存、報價與帳務餘額讀取；App 預覽後，必須由使用者確認才會把持股數、平均成本與市值寫入 WealthTracker。可用餘額會以「玉山證券可用餘額」同步至流動資產；交割餘額與股票預收款只供 App 顯示。它**不會**送出、修改或取消任何券商委託。

> Expo Tunnel 只提供 App 的開發載入，**不會**轉送玉山 bridge。iPhone 使用 bridge 時，請透過 Tailscale 的私有 HTTPS 連線。

### 1. 準備私有檔案

以下檔案只能存在 Mac，且不得提交到 Git：

- 玉山提供的 `config.ini` 與 `.p12` 憑證
- `esun-bridge/.env`
- 券商登入密碼、憑證密碼與 `ESUN_BRIDGE_TOKEN`

在 `esun-bridge/.env` 設定：

```ini
ESUN_CONFIG_PATH=/absolute/path/to/ESUN_API/config.ini
HOST=0.0.0.0
PORT=8787
ESUN_BRIDGE_TOKEN=<至少 24 字元的隨機安全碼>
```

首次讀取庫存時，SDK 會在執行 bridge 的 Mac 終端機要求輸入券商登入密碼與憑證密碼；這是玉山 SDK 的安全設計，密碼不會傳給 App。

### 2. 建立 Tailscale 私有 HTTPS bridge

在 Mac 與 iPhone 安裝 Tailscale、登入同一個帳號後，於 Mac 執行：

```bash
cd ~/WealthTracker/esun-bridge
tailscale serve --bg --https=8443 http://127.0.0.1:8787
```

指令會顯示僅限你的 tailnet 使用的 HTTPS 網址，例如：

```text
https://your-mac.your-tailnet.ts.net:8443
```

將此網址填入專案根目錄 `.env`，然後重啟 Expo：

```ini
EXPO_PUBLIC_ESUN_BRIDGE_URL=https://your-mac.your-tailnet.ts.net:8443
```

請勿使用 `EXPO_PUBLIC_ESUN_API_KEY`、`EXPO_PUBLIC_ESUN_BRIDGE_TOKEN` 或把憑證資訊放進 Expo `.env`；任何 `EXPO_PUBLIC_*` 值都會進入 App bundle。

### 3. 啟動與 App 設定

終端機 A：

```bash
cd ~/WealthTracker/esun-bridge
npm start
```

終端機 B：

```bash
cd ~/WealthTracker
npx expo start --dev-client --tunnel --clear
```

在 iPhone 確認 Tailscale 已連線，再到「更多 → 玉山證券 → 設定橋接安全碼」，輸入與 `ESUN_BRIDGE_TOKEN` 相同的值。安全碼會儲存在裝置安全儲存區；瀏覽器版的儲存空間與 iPhone 分開，需各自設定一次。

Mac 必須保持開機、連網，且 `esun-bridge` 持續運行。更新庫存後請先確認平均成本、成本、市值與未實現損益，再按「確認同步至 WealthTracker」。

修改畫面、文字、JavaScript 或 React Native 邏輯後，App 會自動重新載入，不必重新執行 Xcode 編譯。

## 台股研究訊號與每日推播

研究訊號由 Supabase Edge Function 在台北時間平日 20:30 後產生，僅分析登入者的雲端自選與持倉台股；資料不足、負盈餘、台灣休市或收盤資料尚未更新時，不建立新訊號。App 內的「立即分析目前資料」則可隨時手動執行，只會分析目前登入帳戶、不發送推播，並清楚標示最新可取得的資料日期。訊號用途是提供研究線索，**不代表買進建議**。

### 1. 套用資料庫與部署 Function

在可登入該 Supabase Cloud 專案的終端機執行：

```bash
cd ~/WealthTracker
supabase login
supabase link --project-ref <your-project-ref>
supabase db push
supabase functions deploy daily-investment-signals --no-verify-jwt
```

### 2. （建議）設定 Function 私密值

「立即分析目前資料」可使用 FinMind 公開資料端點，不必先設定 token。若會固定排程、追蹤較多標的，建議設定私密 `FINMIND_API_TOKEN` 以取得較穩定的查詢額度；它只能放在 Supabase Function secret，不能使用或複製 App 的 `EXPO_PUBLIC_FINMIND_API_KEY`。先從安全的憑證保存處取得 FinMind token，接著產生排程專用亂數：

```bash
openssl rand -hex 32
supabase secrets set FINMIND_API_TOKEN=<private-finmind-token> SIGNAL_CRON_SECRET=<the-random-value>
```

請保存同一個 `SIGNAL_CRON_SECRET`，下一步寫入 Vault 時會使用；不要將它放進 Git、App `.env` 或任何 `EXPO_PUBLIC_*` 變數。

### 3. 設定平日 20:30 排程

在 Supabase SQL Editor 執行下列 SQL。Supabase cron 使用 UTC，因此 `30 12 * * 1-5` 是台北時間平日 20:30。將兩個尖括號替換為你的值，且只在 SQL Editor 輸入，不要提交此值：

```sql
select vault.create_secret('<same-random-value>', 'signal_cron_secret');

select cron.schedule(
  'daily-investment-signals-taipei',
  '30 12 * * 1-5',
  $$
  select net.http_post(
    url := 'https://<your-project-ref>.supabase.co/functions/v1/daily-investment-signals',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-signal-cron-secret',
      (select decrypted_secret from vault.decrypted_secrets where name = 'signal_cron_secret')
    ),
    body := '{}'::jsonb
  );
  $$
);
```

若專案尚未啟用 `pg_cron`、`pg_net` 或 Vault，先在 Supabase Dashboard 的 Database Extensions 啟用後再執行。部署完成後可在 Edge Function Logs 查看每日執行結果。

### 4. 建立含推播權限的新 iOS Development Build

本次新增了 `expo-notifications` 原生設定；只重啟 Metro 不足。以 USB 連接 iPhone 後執行：

```bash
cd ~/WealthTracker
npx expo run:ios --device
npx expo start --dev-client --tunnel --clear
```

登入 App 後前往「更多 → 台股研究訊號」，開啟「每日摘要推播」並同意 iOS 通知權限。Push token 只會存到你帳戶的受 RLS 保護資料列。

### 何時需要再用 Xcode

| 情況 | 操作 |
|---|---|
| 純畫面、功能或 JavaScript 修改 | 保持 `npx expo start --dev-client --lan` 運行即可 |
| 新增原生套件、修改權限、icon、splash screen、Expo SDK 或 `app.json` 原生設定 | 再執行 `npx expo run:ios --device` |
| 免費簽章在 7 天後到期、App 無法開啟 | 以 USB 接回 iPhone，再執行 `npx expo run:ios --device` 安裝新簽章版本 |

### 免費方案的限制

- 免費 Personal Team 只能供自己測試，不能用 TestFlight、App Store 或 EAS 內部發佈。
- App 每 7 天需要重新簽章與安裝一次。
- Development Build 需連到持續運行的 Mac 開發伺服器；跨網路時可用 Tunnel，但 ngrok 連線可能不穩定且速度較慢。

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
3. 使用 Development Build 的 LAN 模式：
   ```bash
   npx expo start --dev-client --lan
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

**最後更新：** 2026-09-07
**版本：** 1.0.0
