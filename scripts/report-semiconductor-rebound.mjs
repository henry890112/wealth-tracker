import fs from 'node:fs/promises';
import {closeIndicators} from './rebound-close-indicators.mjs';
const root='research/semiconductor-rebound';
const data=JSON.parse(await fs.readFile(`${root}/event-study.json`,'utf8'));
const watch=JSON.parse(await fs.readFile(`${root}/watchlist.json`,'utf8'));
const raw=JSON.parse(await fs.readFile(`${root}/data/_SOX.json`,'utf8')).chart.result[0];
const verified=JSON.parse(await fs.readFile(`${root}/verified-closes.json`,'utf8'))['^SOX'];
const closes=raw.timestamp.map((t,i)=>{
  const date=new Date(t*1000).toISOString().slice(0,10);
  return raw.indicators.quote[0].close[i]??verified[date]?.close;
});
const last=closeIndicators(closes).at(-1);
const nextMA5=closes.slice(-4).reduce((a,b)=>a+b,0)/4;
const f=x=>Number.isFinite(x)?x.toFixed(2):'—';
const pct=x=>Number.isFinite(x)?`${(x*100).toFixed(2)}%`:'—';
const names={unconditional:'每20日固定進場基準',oversold:'RSI首次跌至30以下',rsiRecovery:'RSI重新站上30',maRecovery:'距60日高點跌8%且收復MA5',breakoutRecovery:'近10日超賣後突破前三日高點'};
const lines=[
'# SOX 與持有／收藏半導體標的：反彈研究',
`資料擷取時間：${data.methodology.fetchedAt}；美股及台股最後日線：2026-10-22。這是資料快照，不是即時報價。`,
'## 先看結論',
'目前不能宣稱已找到高勝率抄底公式。反彈候選要分成「跌深」、「止跌確認」、「可承受風險」三件事；超賣只滿足第一項。此次歷史比較沒有證明短均線收復在 SOX 上優於普通固定時間進場。',
'## SOX 最新讀值（修正缺日後）',
`收盤 ${f(last.close)}；單日 ${pct(last.dailyReturn)}；RSI14 ${f(last.rsi)}；MA5 ${f(last.ma5)}；MA20 ${f(last.ma20)}；MA60 ${f(last.ma60)}；MA200 ${f(last.ma200)}。`,
`目前收盤${last.close>last.ma5?'高於':'低於'}MA5，${last.close>last.ma20?'高於':'低於'}MA20。下一交易日要站上當日更新後的MA5，收盤需高於約 ${f(nextMA5)}（僅適用下一根日K，並非固定買進價）。公式：下一日收盤 > 最近四日收盤平均。`,
'重要修正：原始 Yahoo 10/21 的 OHLC 全部為空。已用 Nasdaq 官方與 FRED 一致的收盤 11,505.56 補入「收盤指標」序列；未補造開高低。之前未補缺日所算的 RSI29.36、MA5及ATR不能當成完整日線結果。現階段不發布 SOX 最新ATR或以它推導的精確停損。',
'## 可以怎麼觀察，而不是猜最低點',
'1. 跌深觀察：RSI14降至30附近，或距近60日高點回落至少8%。這只是研究定義，不是經濟定律。',
'2. 初步轉強：RSI從30下方回到30上方，且收盤站回MA5。訊號在收盤後確認，不把盤中突破當成收盤成立。',
'3. 價格確認：再看能否收盤突破先前三個交易日最高價；但缺少任何一日高價時不應顯示成立。這可能較晚、也可能錯過快速V轉，沒有保證提高報酬。',
'4. 橫向確認：看SMH／SOXX是否同步轉強，再看你的個股是否跟上；ETF與SOX成分權重不同，不能視為同一資產。SOX資料成交量為0，不能以指數本身量能推論放量。',
'5. 失敗條件：確認後又失守反彈低點，或個股遭財報跳空，原反彈假設需重新評估。停損不是成交保證；暫不替未驗證的規則宣稱最佳ATR倍數、倉位或報酬風險比。',
'這套是可檢查的觀察流程，不是已驗證買進策略；也不把幾個條件加總的分數包裝成獲利機率。',
'## 歷史事件比較方法',
'指標定義：MA為最近N根收盤的算術平均；RSI14用前14筆漲跌平均作種子，再以（前值×13＋本日漲／跌）÷14作Wilder平滑，RSI＝100−100÷（1＋平均漲幅÷平均跌幅）。ATR14同樣平滑TR，TR＝max（高−低、|高−前收|、|低−前收|）。RSI觀察動能，MA觀察價格是否轉強，ATR只衡量波動及風險尺度，不能預言方向。',
'使用約十年日線；前200筆供指標暖機。2017至2022為早期組，2023之後為保留比較組。規則在本次計算前固定，但這仍是事後研究，不是未來實盤驗證。每次訊號收盤後，下一根開盤進場，第20根收盤出場。每邊假設0.1%成本；不是台股實際稅費估計，也沒有停損／停利。SOX不可直接交易，其結果只是指數價格事件研究。',
'同一策略持有期間不重複進場。資料缺漏前後涵蓋200日暖機與20日結果的視窗不納入；訓練期持有跨入2023的樣本排除。OHLC乘以adjclose/close作還原；這是股利調整報酬近似，歷史價格並非當時實際掛單價。',
'勝率95%區間採Wilson區間，只是小樣本描述，沒有修正市場事件相依性或多策略比較。不同策略與不同股票不能當成獨立樣本累加。固定時間基準不是同風險配對控制組，不能由平均差異推導因果。',
'## SOX：保留比較組（2023之後）',
'|規則|筆數|勝率|勝率95%區間|平均淨報酬|中位數|最差期末報酬|最差途中回撤|',
'|---|---:|---:|---|---:|---:|---:|---:|',
];
const sox=data.assets.find(a=>a.symbol==='^SOX');
for(const [key,s]of Object.entries(sox.studies)){const x=s.holdout;lines.push(`|${names[key]}|${x.count}|${pct(x.winRate)}|${x.winRateWilson95?.map(pct).join('～')??'—'}|${pct(x.mean)}|${pct(x.median)}|${pct(x.worst)}|${pct(x.worstAdverseExcursion)}|`);}
lines.push('「途中回撤」指持有期最低價相對進場價，不是整體投資組合最大回撤。某些訊號只有1筆，100%勝率完全不足以支持高勝率結論。',
'## 各標的最新資料與可用性',
'美股以KLAC、AVGO、QCOM、DRAM、CBRS及鄰近供應鏈AAOI觀察；台股包含持有／收藏的2330、3711、2454、2337、5347、6291、6488、2379。AAOI是光通訊相關，不應等同純半導體；目前選股清單有存活者及選擇偏差。',
'|標的|收盤|RSI14|MA5|MA20|距60日高點|資料提醒|',
'|---|---:|---:|---:|---:|---:|---|');
for(const a of data.assets){if(a.symbol==='^SOX')continue;if(a.excluded){lines.push(`|${a.symbol}|—|—|—|—|—|${a.date} OHLC矛盾，暫不採用|`);continue;}const c=a.current;lines.push(`|${a.symbol}|${f(c.rawClose)}|${c.reliable?f(c.rsi):'暫不採用'}|${c.reliable?f(c.ma5):'暫不採用'}|${c.reliable?f(c.ma20):'暫不採用'}|${c.reliable?pct(c.drawdown60):'暫不採用'}|${!c.reliable?'近期缺日，不能判定訊號':a.usableRows<200?'歷史不足200日，無長期回測':'一般行情仍可能修訂'}|`);}
lines.push('## 各標的比較結果（早期與保留組均列出）');
for(const a of data.assets){if(a.excluded)continue;lines.push(`### ${a.symbol}`,'|規則|早期筆數|早期平均|保留筆數|保留勝率|保留平均|保留中位數|','|---|---:|---:|---:|---:|---:|---:|');for(const [k,s]of Object.entries(a.studies))lines.push(`|${names[k]}|${s.train.count}|${pct(s.train.mean)}|${s.holdout.count}|${pct(s.holdout.winRate)}|${pct(s.holdout.mean)}|${pct(s.holdout.median)}|`);}
lines.push('## 持有期間與成本敏感度：不能只挑勝率最高的一列',
'以下固定比較「跌8%後收復MA5」。10／20／40日為預先選定的壓力測試範圍，不據此選出最佳參數。持有天數改變也改變不重複進場的樣本集合，因此不是同一批交易只延後賣出。',
'|標的|持有日數|每邊成本|筆數|勝率|平均淨報酬|中位數|最差期末|',
'|---|---:|---:|---:|---:|---:|---:|---:|');
for(const symbol of ['^SOX','SMH','SOXX'])for(const s of data.assets.find(a=>a.symbol===symbol).studies.maRecovery.sensitivity)lines.push(`|${symbol}|${s.horizon}|${pct(s.cost)}|${s.count}|${pct(s.winRate)}|${pct(s.mean)}|${pct(s.median)}|${pct(s.worst)}|`);
lines.push('同期間普通固定時間進場的平均淨報酬（每邊0.1%），供對照，並非風險配對或顯著性檢定：','|標的|10日|20日|40日|','|---|---:|---:|---:|');
for(const symbol of ['^SOX','SMH','SOXX']){const s=data.assets.find(a=>a.symbol===symbol).studies.unconditional.sensitivity.filter(x=>x.cost===0.001);lines.push(`|${symbol}|${s.map(x=>pct(x.mean)).join('|')}|`);}
lines.push('SOX的10日組勝率73.9%，但最差一筆仍約−21.2%；20日組勝率僅38.9%。這種敏感性與小樣本不支持「抓準反彈」的保證，也不能只報10日組漂亮的數字。',
'## 加入停損／停利後是否改善？',
'僅作風險情境比較：下一日開盤進場，固定停損＝進場開盤−1.5×訊號當日ATR14，目標＝進場開盤＋3×ATR14，最多20日；不使用移動停損。隔日跳空穿越停損按開盤退出；同根K棒同時碰到目標與停損，保守假設先停損。成本每邊0.1%。這不是修改App目前以成本／均線為基礎的停損設定。',
'|標的|筆數|勝率|平均淨報酬|中位數|最差一筆|出場點序列最大回撤|',
'|---|---:|---:|---:|---:|---:|---:|');
for(const symbol of ['^SOX','SMH','SOXX','KLAC','AVGO','2330.TW','2454.TW','2379.TW']){const s=data.assets.find(a=>a.symbol===symbol).studies.maRecovery.bracket.holdout;lines.push(`|${symbol}|${s.count}|${pct(s.winRate)}|${pct(s.mean)}|${pct(s.median)}|${pct(s.worst)}|${pct(s.exitToExitDrawdown)}|`);}
lines.push('SOX加入這組1.5ATR／2R條件後平均約−0.07%，沒有證據顯示它把普通反彈訊號變成優勢策略。表中回撤只在出場時衡量，會低估持有中風險；不是每日淨值最大回撤。每日OHLC無法重建盤中順序，成交、滑價、停牌及流動性限制仍是簡化假設。',
'## 最新逐檔觀察價位',
'價格以下列快照的同一還原口徑呈現。下一日MA5門檻會每天變，前三日高點是本次快照已有三日的高點，不是對未來的預測。先觀察收盤收復短均線，再觀察突破與量能，不能把表格數字直接視為委託價。',
'|標的|收盤|RSI14|下一日收復MA5門檻|前三日高點|量／前20日均量|20日相對QQQ|狀態|',
'|---|---:|---:|---:|---:|---:|---:|---|');
for(const a of watch.assets){if(['SPY','QQQ','^VIX'].includes(a.symbol))continue;lines.push(a.available?`|${a.symbol}|${f(a.close)}|${f(a.rsi)}|${f(a.nextMA5)}|${f(a.priorHigh3)}|${f(a.volumeRatio20)}×|${pct(a.relative20QQQ)}|${a.state}|`:`|${a.symbol}|—|—|—|—|—|—|缺日：${a.missingDates.join('、')}；不發訊號|`);}
lines.push('相對QQQ＝（標的本日／20日前價格）÷（QQQ本日／同日價格）−1。正值代表這段時間相對強，不是絕對上漲；台股不直接套用同日美股收盤，以免時間先後錯置。量比以前20個交易日、不含本日的平均作分母。',
'SOX相對QQQ約−9.63%，SMH約−8.32%、SOXX約−11.60%。SMH量比1.90倍、SOXX1.83倍，但價格仍低於MA5／MA20且RSI下降；這是下跌期間放量，不能解讀為買盤已確認。',
`你的美股半導體持有觀察組：${watch.breadth.usHeld.usable}/${watch.breadth.usHeld.selected}檔資料可用，站上MA5 ${watch.breadth.usHeld.aboveMA5}檔、MA20 ${watch.breadth.usHeld.aboveMA20}檔；排除QCOM缺日。台股持有／收藏觀察組：${watch.breadth.taiwanSelected.usable}檔中，站上MA5 ${watch.breadth.taiwanSelected.aboveMA5}檔、MA20 ${watch.breadth.taiwanSelected.aboveMA20}檔。這是你的當前清單廣度，不是全市場或歷史SOX成分股廣度。`,
'世界、沛亨、環球晶：完整歷史回測排除，原因是多年以前的OHLC矛盾；最新觀察表只用最近連續有效收盤重新暖機（297筆），所以可以列當前MA／RSI，而不能宣稱完整十年策略驗證。DRAM與CBRS歷史不足200日，只列近期觀察，不借用別檔勝率。',
'## 每日追蹤方式與可執行的邊界',
'- 收盤後更新資料，先確認沒有缺日、錯誤調整或尚未收盤的K棒；台股和美股分開。資料不足優先於任何看多判斷。',
'- 觀察名單：SOX／SMH／SOXX與個股出現跌深條件時列入，不立即等同買點。',
'- 初步反彈：標的收盤站回MA5且RSI向上；若先前RSI低於30，另要求收回30。再觀察收盤突破前三日高點，不能只看盤中刺穿。',
'- 輔助確認：至少SMH與SOXX都站回MA5，再看你的可用持股是否有過半數站回MA5；量比超過1.2且當天上漲、20日相對強弱改善可記為支持證據。這些綜合門檻是待前瞻驗證的研究清單，未在本研究宣稱回測勝率。',
'- 若要測試，先用模擬帳戶記錄下一日開盤、當時可用的ATR與預定退出條件，不用事後最低價當成本。設定可承受總損失後再決定股數；不因已有虧損而反推應該加碼。',
'- 確認失敗：價格跌回觸發前低點／預定停損、廣度再惡化或財報跳空。先前訊號不等於未來仍有效。財報前需單獨檢查官方公告；此研究沒有回測財報或消息因子。',
'目前判讀：市場、ETF與多數觀察股尚未完成短線價格確認；KLAC／CBRS雖更超賣，也更不能由跌幅直接推導已見底。瑞昱仍在MA20上方，屬相對不同的結構，不應把所有半導體當成同一個買點。',
'## 驗證與限制',
'- 已驗證RSI手算種子、Wilder遞推、MA暖機、前綴不變性（沒有偷看未來）、隔日開盤、雙邊成本、不重疊交易、缺日排除、跨期排除、跳空停損、同棒雙觸及與統計等17項測試，包含KLAC指標與App既有實作交叉比對，以及SOX補缺日後的結果比對。',
'- QCOM／VIX近期缺日，無完整當前訊號；三檔台股異常歷史不作回測。缺資料不是看多或看空結論。',
'- 量能、相對強弱與廣度是當前數據，不是完整多因子策略的回測績效。比較多個條件後再挑最好的一個會產生資料探勘偏誤；因此不發布最佳化分數或機率。',
'- 沒有逐日投資組合淨值、實際稅費、匯率損益、退市公司與歷史持股成分，不能把結果當個人實際損益或完整資產配置建議。',
'- 未部署、未自動下單、未改寫App停損。研究結論是目前缺乏穩健的精準反彈優勢，而不是保證某一天會反彈。',
'## 來源與重現','- [Nasdaq SOX官方](https://indexes.nasdaq.com/Index/Overview/SOX)：核對最新收盤及前收。','- [FRED／Nasdaq日線](https://fred.stlouisfed.org/data/NASDAQSOX)：核對10/21收盤。','- [Fidelity RSI說明](https://www.fidelity.com/learning-center/trading-investing/technical-analysis/technical-indicator-guide/RSI)：超賣可持續，不能保證反轉。','- [Fidelity ATR說明](https://www.fidelity.com/learning-center/trading-investing/technical-analysis/technical-indicator-guide/atr)：衡量波動，不是方向預測。','- 原始行情來源、擷取時間與SHA256見manifest.json；逐筆事件與統計見event-study.json；官方補核的收盤見verified-closes.json。','重現：`node scripts/analyze-semiconductor-rebound.mjs` → `node scripts/report-semiconductor-rebound.mjs`；指標測試：`node --test tests/reboundResearch.test.mjs`。');
lines.push('- [VanEck SMH官方](https://www.vaneck.com/us/en/investments/semiconductor-etf-smh?redirectVE=generic)：SMH追蹤MVIS US Listed Semiconductor 25 Index。','- [SEC文件對SOXX的說明](https://www.sec.gov/Archives/edgar/data/83246/000110465926057871/tm2613458d70_fwp.htm)：SOXX追蹤NYSE Semiconductor Index，非同一個SOX指數。','- [SEC投資人教育：停損單](https://www.investor.gov/introduction-investing/general-resources/news-alerts/alerts-bulletins/investor-bulletins-15)：停損觸發價不保證成交價。','更新完整報告前另執行 `node scripts/rebound-watchlist.mjs`，以生成最新觀察表；不要只更新一份輸出而混用不同快照。');
let markdown='';for(let i=0;i<lines.length;i++){markdown+=lines[i]+'\n';if(!(lines[i].startsWith('|')&&lines[i+1]?.startsWith('|')))markdown+='\n';}
await fs.writeFile(`${root}/REPORT.md`,markdown);
const csv=['symbol,strategy,signalDate,entryDate,exitDate,entry,exit,netReturn,adverseExcursion'];
for(const a of data.assets)if(!a.excluded)for(const [strategy,s]of Object.entries(a.studies))for(const t of s.trades)csv.push([a.symbol,strategy,t.signalDate,t.entryDate,t.exitDate,t.entry,t.exit,t.netReturn,t.adverseExcursion].join(','));
await fs.writeFile(`${root}/trades.csv`,csv.join('\n')+'\n');
await fs.writeFile(`${root}/sox-corrected-close-indicators.json`,JSON.stringify({last,nextMA5,sources:verified},null,2));
console.log(JSON.stringify({last,nextMA5}));
