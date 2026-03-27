# 💰 WealthTracker - 個人資產管理系統

基於 SDD.md 規格開發的專業級個人資產管理應用程式，具備會計思維、多幣別支援、自動估價和趨勢分析功能。

## 📋 功能特色

### ✅ 已實現功能

- **🔐 使用者認證**: Email/密碼註冊登入系統
- **📊 會計分類 Dashboard**: 
  - 流動資產、投資資產、固定資產、應收帳款、負債分類
  - 自動計算淨資產 (資產 - 負債)
  - 多幣別統一換算為基準貨幣
- **🔍 智慧搜尋與新增**:
  - 支援台股、美股、虛擬貨幣搜尋
  - 分類標籤選擇
  - 自動記錄交易流水
- **📈 趨勢分析**:
  - 30天淨資產折線圖
  - 最高/最低淨資產統計
  - 每日快照自動記錄
- **⚙️ 系統設定**:
  - 基準貨幣切換 (TWD/USD/EUR/JPY/CNY)
  - 漲跌顏色習慣設定
  - 資料同步功能

### 🔌 API 整合

- **FinMind API**: 台股/美股即時報價
- **CoinGecko API**: 虛擬貨幣價格
- **ExchangeRate API**: 匯率轉換

## 🛠️ 技術棧

- **Frontend**: React Native (Expo)
- **Backend**: Supabase (PostgreSQL + Auth)
- **Icons**: Lucide React Native
- **Charts**: React Native Chart Kit
- **Navigation**: React Navigation

## 📦 安裝步驟

### 前置需求

- Node.js 18+ 
- Docker Desktop (用於本地 Supabase)
- Expo CLI
- Supabase CLI

### 1. 安裝依賴

```bash
cd WealthTracker
npm install
```

### 2. 設定 Supabase 本地環境

```bash
# 安裝 Supabase CLI (如果尚未安裝)
npm install -g supabase

# 初始化 Supabase (已完成，跳過此步驟)
# supabase init

# 啟動本地 Supabase Docker 容器
supabase start
```

啟動後，你會看到類似以下的輸出：

```
API URL: http://localhost:54321
GraphQL URL: http://localhost:54321/graphql/v1
DB URL: postgresql://postgres:postgres@localhost:54322/postgres
Studio URL: http://localhost:54323
Inbucket URL: http://localhost:54324
JWT secret: super-secret-jwt-token-with-at-least-32-characters-long
anon key: eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
service_role key: eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
```

### 3. 執行資料庫遷移

```bash
# 應用資料庫 schema
supabase db reset
```

### 4. 設定環境變數

複製 `.env.example` 為 `.env`:

```bash
cp .env.example .env
```

編輯 `.env` 檔案，填入 Supabase 本地連線資訊：

```env
EXPO_PUBLIC_SUPABASE_URL=http://localhost:54321
EXPO_PUBLIC_SUPABASE_ANON_KEY=<your-anon-key-from-supabase-start>

# API Keys (選填，使用免費 API)
EXPO_PUBLIC_FINMIND_API_KEY=
EXPO_PUBLIC_COINGECKO_API_KEY=
EXPO_PUBLIC_EXCHANGE_RATE_API_KEY=
```

### 5. 啟動應用程式

```bash
# 啟動 Expo 開發伺服器
npm start

# 或直接在特定平台啟動
npm run android  # Android
npm run ios      # iOS
npm run web      # Web
```

## 🗄️ 資料庫結構

### 主要資料表

- **profiles**: 使用者設定檔 (基準貨幣、主題、顏色習慣)
- **assets**: 資產清單 (名稱、分類、幣別、金額、股數)
- **transactions**: 交易記錄 (買入、賣出、調整)
- **watchlist**: 自選清單
- **daily_snapshots**: 每日快照 (用於趨勢圖)
- **exchange_rates**: 匯率快取
- **price_cache**: 價格快取

### 自動化觸發器

- **update_asset_after_transaction**: 交易後自動更新資產金額和平均成本
- **handle_new_user**: 新用戶註冊時自動建立 profile
- **create_daily_snapshot**: 手動呼叫以建立每日快照

## 🚀 部署到 Supabase Cloud

### 1. 建立 Supabase 專案

前往 [Supabase Dashboard](https://app.supabase.com) 建立新專案。

### 2. 連結本地專案到雲端

```bash
# 登入 Supabase
supabase login

# 連結到雲端專案
supabase link --project-ref <your-project-ref>
```

### 3. 推送資料庫 Schema

```bash
# 推送本地 migrations 到雲端
supabase db push
```

### 4. 更新環境變數

更新 `.env` 檔案使用雲端 Supabase 連線資訊：

```env
EXPO_PUBLIC_SUPABASE_URL=https://<your-project-ref>.supabase.co
EXPO_PUBLIC_SUPABASE_ANON_KEY=<your-anon-key>
```

## 📱 使用說明

### 首次使用

1. **註冊帳號**: 使用 Email 和密碼註冊
2. **設定基準貨幣**: 前往「設定」頁面選擇您的基準貨幣
3. **新增資產**: 
   - 點擊「搜尋資產」
   - 搜尋股票代碼或名稱
   - 選擇分類並輸入持有股數和成本
4. **查看趨勢**: 系統會自動記錄每日快照，可在「趨勢分析」查看

### 資產分類說明

- **流動資產**: 現金、活存、定存等
- **投資資產**: 股票、基金、債券等
- **固定資產**: 房地產、車輛等
- **應收帳款**: 借出款項
- **負債**: 貸款、信用卡債等

## 🔧 開發指令

```bash
# 啟動開發伺服器
npm start

# 重置 Supabase 資料庫
supabase db reset

# 查看 Supabase 狀態
supabase status

# 停止 Supabase
supabase stop

# 查看 Supabase Studio (資料庫管理介面)
# 瀏覽器開啟 http://localhost:54323
```

## 📂 專案結構

```
WealthTracker/
├── App.js                          # 主應用程式入口
├── src/
│   ├── lib/
│   │   └── supabase.js            # Supabase 客戶端設定
│   ├── services/
│   │   └── api.js                 # 外部 API 整合
│   └── screens/
│       ├── AuthScreen.js          # 登入/註冊畫面
│       ├── DashboardScreen.js     # 資產總覽
│       ├── SearchScreen.js        # 搜尋與新增資產
│       ├── TrendsScreen.js        # 趨勢分析
│       └── SettingsScreen.js      # 系統設定
├── supabase/
│   ├── config.toml                # Supabase 設定
│   └── migrations/
│       └── 20240101000000_initial_schema.sql  # 資料庫 Schema
├── package.json
├── app.json
└── README.md
```

## 🐛 常見問題

### Q: Supabase 無法啟動？
A: 確認 Docker Desktop 正在運行，並檢查 54321-54324 端口是否被佔用。

### Q: 無法連接到資料庫？
A: 檢查 `.env` 檔案中的 `EXPO_PUBLIC_SUPABASE_URL` 和 `EXPO_PUBLIC_SUPABASE_ANON_KEY` 是否正確。

### Q: 搜尋功能無法使用？
A: 免費 API 有請求限制，請稍後再試或註冊 API Key。

### Q: 圖表無法顯示？
A: 需要至少有一筆每日快照資料。新增資產後，系統會自動建立快照。

## 📝 待實作功能

- [ ] 交易歷史詳細頁面
- [ ] 資產詳情頁面 (含 K 線圖)
- [ ] 批次匯入/匯出功能
- [ ] 推播通知 (價格警示)
- [ ] 多帳戶支援
- [ ] 資產配置餅圖
- [ ] 報表匯出 (PDF/Excel)

## 📄 授權

MIT License

## 👨‍💻 作者

根據 SDD.md V7 規格開發

---

**需要協助？** 請查看 [Supabase 文件](https://supabase.com/docs) 或 [Expo 文件](https://docs.expo.dev/)
