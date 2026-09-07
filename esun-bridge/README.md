# 玉山唯讀橋接層

這個服務只提供 `GET /health`、`GET /v1/holdings` 與 `GET /v1/balance`，沒有任何下單、取消或修改券商資料的端點。`/v1/balance` 回傳可用餘額、交割餘額與股票預收款。

1. 從玉山官網下載 Node.js 的 `esun-trade` 與 `esun-marketdata` `.tgz`，分別放到 `vendor/esun-trade.tgz`、`vendor/esun-marketdata.tgz`。
2. 複製 `.env.example` 為私有 `.env`，設定 `ESUN_CONFIG_PATH` 到官方 `config.ini` 的絕對路徑；`.p12` 必須留在同一私有目錄。
3. 在此資料夾執行 `npm install`、`npm start`。首次登入時請在執行橋接程式的終端機輸入券商與憑證密碼。
4. 網頁版可用 `http://127.0.0.1:8787`。iPhone 會封鎖未加密的 HTTP bridge，因此請使用 Tailscale 私有 HTTPS：Mac 與 iPhone 登入同一個 Tailscale 帳號後，執行 `tailscale serve --bg --https=8443 http://127.0.0.1:8787`，再將輸出的 `https://<mac>.<tailnet>.ts.net:8443` 設為 `EXPO_PUBLIC_ESUN_BRIDGE_URL`。同時設定 `HOST=0.0.0.0` 與 `ESUN_BRIDGE_TOKEN`。

App 端只需要非敏感的 `EXPO_PUBLIC_ESUN_BRIDGE_URL`，例如 `https://your-mac.your-tailnet.ts.net:8443`。請不要在 Expo `.env` 裡保留 `EXPO_PUBLIC_ESUN_API_KEY`，因為該前綴的值會進入 App bundle。

## 完成模擬資格

先執行 `npm run simulate:login`，確認可在終端機輸入券商與憑證密碼並完成登入。玉山要求成功送出一筆模擬委託才可申請正式金鑰；為避免誤用正式設定檔，`simulate:order` 會先檢查 `Environment = SIMULATION`。

若曾輸入錯誤密碼，先執行 `npm run simulate:reset-login` 清除 macOS Keychain 的玉山 SDK 密碼快取，再重新執行登入測試。

送出前請自行指定測試標的與數量，並輸入明確確認值：

```bash
ESUN_SIM_SYMBOL=2884 ESUN_SIM_QUANTITY=1 ESUN_SIMULATION_ORDER_CONFIRM=PLACE_SIMULATION_ORDER npm run simulate:order
```

這支指令固定建立「現股、ROD、限跌停」的**模擬買單**；不會在未提供確認值時送出委託。
