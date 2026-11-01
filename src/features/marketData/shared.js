export const FINMIND_BASE_URL = 'https://api.finmindtrade.com/api/v4';
export const COINGECKO_BASE_URL = 'https://api.coingecko.com/api/v3';
export const BINANCE_BASE_URL = 'https://api.binance.com/api/v3';

// Map ticker symbols to CoinGecko IDs
export const SYMBOL_TO_COINGECKO_ID = {
  BTC:  'bitcoin',
  ETH:  'ethereum',
  USDT: 'tether',
  BNB:  'binancecoin',
  SOL:  'solana',
  XRP:  'ripple',
  USDC: 'usd-coin',
  DOGE: 'dogecoin',
  ADA:  'cardano',
  AVAX: 'avalanche-2',
  TRX:  'tron',
  TON:  'the-open-network',
  LINK: 'chainlink',
  DOT:  'polkadot',
  MATIC:'matic-network',
  SHIB: 'shiba-inu',
  LTC:  'litecoin',
  UNI:  'uniswap',
  ATOM: 'cosmos',
  XLM:  'stellar',
};

export const getDateString = (daysOffset) => {
  const date = new Date();
  date.setDate(date.getDate() + daysOffset);
  return date.toISOString().split('T')[0];
};
