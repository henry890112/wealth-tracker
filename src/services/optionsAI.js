import { supabase } from '../lib/supabase';
import { optionPayoffAtExpiration } from './optionsAIStrategies';
import { calculateExpectedMove, selectAtmIv } from './optionsExpectedMove';

const numberOrNull = value => value === null || value === undefined || value === '' || !Number.isFinite(Number(value)) ? null : Number(value);

export function buildOptionsAISnapshot({ symbol, expiration, spot, spotAsOf, spotSource, chain, strategies, selectedStrategy }) {
  const contracts = (chain?.contracts || []).filter(row => row.expiration === expiration);
  const atmIv = selectAtmIv(contracts, spot, expiration);
  const expectedMove = calculateExpectedMove({ spot, expiration, annualIv: atmIv?.annualIv });
  const nearest = type => contracts.filter(row => row.type === type && Number.isFinite(Number(row.strike)))
    .sort((a, b) => Math.abs(Number(a.strike) - spot) - Math.abs(Number(b.strike) - spot))[0];
  const pick = row => row ? {
    strike: numberOrNull(row.strike), bid: numberOrNull(row.bid), ask: numberOrNull(row.ask),
    volume: numberOrNull(row.volume), openInterest: numberOrNull(row.openInterest),
    iv: numberOrNull(row.impliedVolatility), delta: numberOrNull(row.delta), gamma: numberOrNull(row.gamma),
  } : null;
  return {
    symbol, expiration, spot: numberOrNull(spot), spotAsOf, spotSource, currency: 'USD',
    provider: chain?.provider || null, providerAsOf: chain?.providerAsOf || null,
    priceDelay: chain?.priceDelay || null, greeksDelay: chain?.greeksDelay || null,
    expectedMove: expectedMove ? {
      annualIv: expectedMove.annualIv, calendarDays: expectedMove.days,
      oneSigmaMoveUSD: expectedMove.move, lowerUSD: expectedMove.lower, upperUSD: expectedMove.upper,
      method: 'spot * annual_IV * sqrt(calendar_days / 365); not a forecast or profit probability',
    } : null,
    contractCount: contracts.length, selectedStrategy,
    totalCallVolume: contracts.filter(row => row.type === 'call').reduce((sum, row) => sum + (numberOrNull(row.volume) || 0), 0),
    totalPutVolume: contracts.filter(row => row.type === 'put').reduce((sum, row) => sum + (numberOrNull(row.volume) || 0), 0),
    atmCall: pick(nearest('call')), atmPut: pick(nearest('put')),
    strategies: strategies.map(item => ({
      name: item.title,
      legs: item.legs.map(leg => ({ side: leg.side === 1 ? 'buy_ask' : 'sell_bid', type: leg.type, strike: leg.strike })),
      costUSD: item.cost, maxLossUSD: item.maxLoss, maxGainUSD: item.maxGain,
      breakevenAtExpiration: item.breakeven,
      scenariosAtExpiration: [0.95, 1, 1.05].map(factor => ({
        underlying: Math.round(spot * factor * 100) / 100,
        pnlUSD: optionPayoffAtExpiration(item, spot * factor),
      })),
    })),
  };
}

export async function askOptionsAI({ snapshot, messages }) {
  const systemPrompt = [
    '你是美股選擇權資料解讀助手。請用繁體中文、簡短且手機易讀的 Markdown 回答。',
    '以下 JSON 是唯一可用的市場與策略數據；不可捏造即時報價、Greeks、成交量、機率、保證獲利或推薦特定交易。',
    '到期情境損益只是內含價計算，不是到期前的選擇權報價；到期前價格還受時間價值、隱含波動率、利率、股息等影響。',
    'maxGainUSD 為 null 表示向上理論無上限；缺失數據要明說。成本採買入 ask、賣出 bid，不含手續費與滑價。',
    '成交量與未平倉量不能單獨判定買賣方向。IV 為來源原始欄位，若尺度不明不可擅自轉成百分比。',
    'expectedMove 為簡化 ±1σ 波動尺度，並非價格預測、信賴區間或策略獲利機率；不可將它解讀為保證上下界。',
    '若使用者問「如果股價漲/跌 X%」，只用已有的情境數字；其他 X% 可用已提供的策略腿與報價算到期內含價損益，但不得預測到期前報價。',
    '說明資料延遲與來源，且強調這是研究工具不是投資建議。',
    `資料快照：${JSON.stringify(snapshot)}`,
  ].join('\n');
  const { data, error } = await supabase.functions.invoke('ai-chat', {
    body: {
      mode: 'generate', systemPrompt,
      messages: messages.slice(-6).map(item => ({ role: item.role, content: String(item.content).slice(0, 1500) })),
      enableSearch: false, maxTokens: 900, temperature: 0.2,
    },
  });
  if (error) {
    if (/401|unauthorized|jwt/i.test(error.message || '')) throw new Error('請先登入或重新登入，再使用選擇權 AI。');
    throw new Error('AI 暫時無法回應，請稍後再試。');
  }
  if (data?.error) throw new Error(String(data.error));
  const answer = String(data?.content || '').replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
  if (!answer) throw new Error('AI 沒有回傳內容，請重試。');
  return answer;
}
