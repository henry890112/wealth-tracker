import { EsunTrade } from '@esun/trade';
import { getSimulationConfigPath } from './simulation-config.mjs';

const esun = new EsunTrade({ configPath: getSimulationConfigPath() });
await esun.login();
console.log('模擬環境登入成功。');
await esun.logout();
