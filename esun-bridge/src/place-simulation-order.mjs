import { EsunTrade, Order } from '@esun/trade';
import { getSimulationConfigPath } from './simulation-config.mjs';

const symbol = (process.env.ESUN_SIM_SYMBOL || '').trim();
const quantity = Number(process.env.ESUN_SIM_QUANTITY || 0);

if (process.env.ESUN_SIMULATION_ORDER_CONFIRM !== 'PLACE_SIMULATION_ORDER') {
  throw new Error('未取得明確確認：請設定 ESUN_SIMULATION_ORDER_CONFIRM=PLACE_SIMULATION_ORDER。');
}
if (!/^\d{4,6}$/.test(symbol) || !Number.isInteger(quantity) || quantity <= 0) {
  throw new Error('請設定有效的 ESUN_SIM_SYMBOL（台股代碼）與 ESUN_SIM_QUANTITY（正整數）。');
}

const esun = new EsunTrade({ configPath: getSimulationConfigPath() });
await esun.login();
try {
  const order = new Order({
    buySell: Order.Side.Buy,
    price: '',
    stockNo: symbol,
    quantity,
    apCode: Order.ApCode.Common,
    priceFlag: Order.PriceFlag.LimitDown,
    bsFlag: Order.BsFlag.ROD,
    trade: Order.Trade.Cash,
  });
  await esun.placeOrder(order);
  console.log(`模擬委託已送出：買入 ${symbol}，數量 ${quantity}。`);
} finally {
  await esun.logout().catch(() => {});
}
