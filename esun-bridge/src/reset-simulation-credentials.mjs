import { EsunTrade } from '@esun/trade';
import { getSimulationConfigPath } from './simulation-config.mjs';

const esun = new EsunTrade({ configPath: getSimulationConfigPath() });
await esun.logout();
console.log('已清除 macOS Keychain 中的玉山模擬登入與憑證密碼快取。');
