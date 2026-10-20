/**
 * Live market charts for "bitcoin chart", "price of gold", "show me the Tesla
 * chart" and the like: a TradingView chart embedded in the panel while the
 * model answers with analysis. Recognised on the device — no model call.
 */

/** Common names → TradingView symbols. Anything else that looks like a ticker
 *  ("AAPL", "EURUSD", "BTCUSDT") is passed through for TradingView to resolve. */
const ASSETS: Record<string, { symbol: string; label: string }> = {
  bitcoin: { symbol: 'BINANCE:BTCUSDT', label: 'Bitcoin' },
  btc: { symbol: 'BINANCE:BTCUSDT', label: 'Bitcoin' },
  ethereum: { symbol: 'BINANCE:ETHUSDT', label: 'Ethereum' },
  eth: { symbol: 'BINANCE:ETHUSDT', label: 'Ethereum' },
  solana: { symbol: 'BINANCE:SOLUSDT', label: 'Solana' },
  sol: { symbol: 'BINANCE:SOLUSDT', label: 'Solana' },
  xrp: { symbol: 'BINANCE:XRPUSDT', label: 'XRP' },
  ripple: { symbol: 'BINANCE:XRPUSDT', label: 'XRP' },
  bnb: { symbol: 'BINANCE:BNBUSDT', label: 'BNB' },
  dogecoin: { symbol: 'BINANCE:DOGEUSDT', label: 'Dogecoin' },
  doge: { symbol: 'BINANCE:DOGEUSDT', label: 'Dogecoin' },
  cardano: { symbol: 'BINANCE:ADAUSDT', label: 'Cardano' },
  gold: { symbol: 'OANDA:XAUUSD', label: 'Gold' },
  xauusd: { symbol: 'OANDA:XAUUSD', label: 'Gold' },
  silver: { symbol: 'OANDA:XAGUSD', label: 'Silver' },
  oil: { symbol: 'TVC:USOIL', label: 'Crude oil' },
  'crude oil': { symbol: 'TVC:USOIL', label: 'Crude oil' },
  'euro dollar': { symbol: 'FX:EURUSD', label: 'EUR/USD' },
  'euro': { symbol: 'FX:EURUSD', label: 'EUR/USD' },
  'pound': { symbol: 'FX:GBPUSD', label: 'GBP/USD' },
  'yen': { symbol: 'FX:USDJPY', label: 'USD/JPY' },
  'dollar index': { symbol: 'TVC:DXY', label: 'US Dollar Index' },
  'nasdaq': { symbol: 'NASDAQ:NDX', label: 'Nasdaq 100' },
  's&p 500': { symbol: 'SP:SPX', label: 'S&P 500' },
  's and p 500': { symbol: 'SP:SPX', label: 'S&P 500' },
  'sp500': { symbol: 'SP:SPX', label: 'S&P 500' },
  'dow': { symbol: 'TVC:DJI', label: 'Dow Jones' },
  'dow jones': { symbol: 'TVC:DJI', label: 'Dow Jones' },
  apple: { symbol: 'NASDAQ:AAPL', label: 'Apple' },
  tesla: { symbol: 'NASDAQ:TSLA', label: 'Tesla' },
  nvidia: { symbol: 'NASDAQ:NVDA', label: 'Nvidia' },
  microsoft: { symbol: 'NASDAQ:MSFT', label: 'Microsoft' },
  amazon: { symbol: 'NASDAQ:AMZN', label: 'Amazon' },
  google: { symbol: 'NASDAQ:GOOGL', label: 'Alphabet' },
  alphabet: { symbol: 'NASDAQ:GOOGL', label: 'Alphabet' },
  meta: { symbol: 'NASDAQ:META', label: 'Meta' },
  netflix: { symbol: 'NASDAQ:NFLX', label: 'Netflix' },
}

export type Chart = {
  symbol: string
  label: string
  /** The embeddable chart. */
  url: string
  /** The symbol's page on TradingView itself: full chart, news, financials. */
  link: string
  /** False for exchanges TradingView will not show in embedded charts. */
  embeddable: boolean
}

/**
 * Exchanges whose data TradingView only shows on its own site: an embedded
 * chart says "This symbol is only available on TradingView" and then quietly
 * shows Apple instead. Checked one by one (Oct 2026): Bursa Malaysia, Tokyo,
 * Hong Kong, Singapore, Thailand, Korea, Taiwan, London and India's NSE are
 * blocked; BSE, TPEX and FTSE Malaysia indices share those licences. For these
 * the panel offers the TradingView page instead of a wrong chart. (Working:
 * US, crypto, forex, commodities, Xetra, Euronext, ASX, TSX, B3, IDX, SSE.)
 */
const SITE_ONLY = /^(MYX|FTSEMYX|TSE|HKEX|SGX|SET|KRX|TWSE|TPEX|LSE|LSIN|NSE|BSE)$/i

/** A chart for any TradingView symbol, "EXCHANGE:TICKER" or a bare ticker. */
export function symbolChart(symbol: string, label?: string): Chart {
  const clean = symbol.trim().toUpperCase()
  const exchange = clean.includes(':') ? clean.split(':')[0] : ''
  return {
    symbol: clean,
    label: label || clean.split(':').pop() || clean,
    url: chartUrl(clean),
    link: `https://www.tradingview.com/symbols/${encodeURIComponent(clean.replace(':', '-'))}/`,
    embeddable: !SITE_ONLY.test(exchange),
  }
}

const TRIGGER =
  /^(?:(?:show|open|pull up|give|get|bring up)\s+(?:me\s+)?)?(?:the\s+)?(?:(.+?)\s+(?:chart|graph|price|prices|candles?)(?:\s+(?:now|today|right now))?|(?:chart|graph|price|prices|candles?)\s+(?:of|for)\s+(.+?))$/i

/** The chart a question asks for, or null. */
export function chartFor(said: string): Chart | null {
  const text = said
    .trim()
    .replace(/[.!?]+$/, '')
    .replace(/^(?:(?:hey|hi|ok(?:ay)?|danya|dania|dhanya|please|can you|could you)[\s,]+)*/i, '')
    .replace(/^(?:what(?:'s| is)|how(?:'s| is))\s+(?:the\s+)?/i, '')
  const m = TRIGGER.exec(text)
  if (!m) return null
  const asked = (m[1] ?? m[2] ?? '').trim().replace(/^(?:the|a)\s+/i, '').replace(/'s$/, '')
  if (!asked) return null
  const known = ASSETS[asked.toLowerCase()]
  if (known) return symbolChart(known.symbol, known.label)
  // A ticker the recogniser wrote in capitals ("AAPL", "BTCUSDT"), or a
  // currency pair ("EUR USD", "gbp/jpy"). Ordinary words ("the new iPhone")
  // are not tickers, however short.
  const pair = /^([a-z]{3})\s*\/?\s*([a-z]{3})$/i.exec(asked)
  const codes = /^(?:EUR|USD|GBP|JPY|AUD|CAD|CHF|NZD|BTC|ETH|USDT|XAU|XAG)$/
  if (pair && codes.test(pair[1].toUpperCase()) && codes.test(pair[2].toUpperCase())) {
    const symbol = `${pair[1]}${pair[2]}`.toUpperCase()
    return symbolChart(symbol, `${symbol.slice(0, 3)}/${symbol.slice(3)}`)
  }
  if (/^[A-Z][A-Z0-9.:]{1,14}$/.test(asked)) return symbolChart(asked)
  return null
}

export function chartUrl(symbol: string): string {
  const q = new URLSearchParams({
    symbol,
    // Daily candles: the view an analysis is about. The chart's own buttons
    // switch to hours or minutes.
    interval: 'D',
    theme: 'dark',
    style: '1',
    timezone: 'Etc/UTC',
    hidesidetoolbar: '1',
    symboledit: '1',
    saveimage: '0',
    toolbarbg: '061420',
    locale: 'en',
  })
  return `https://s.tradingview.com/widgetembed/?${q.toString()}`
}
