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

export type Chart = { symbol: string; label: string; url: string }

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
  if (known) return { ...known, url: chartUrl(known.symbol) }
  // A ticker the recogniser wrote in capitals ("AAPL", "BTCUSDT"), or a
  // currency pair ("EUR USD", "gbp/jpy"). Ordinary words ("the new iPhone")
  // are not tickers, however short.
  const pair = /^([a-z]{3})\s*\/?\s*([a-z]{3})$/i.exec(asked)
  const codes = /^(?:EUR|USD|GBP|JPY|AUD|CAD|CHF|NZD|BTC|ETH|USDT|XAU|XAG)$/
  if (pair && codes.test(pair[1].toUpperCase()) && codes.test(pair[2].toUpperCase())) {
    const symbol = `${pair[1]}${pair[2]}`.toUpperCase()
    return { symbol, label: `${symbol.slice(0, 3)}/${symbol.slice(3)}`, url: chartUrl(symbol) }
  }
  if (/^[A-Z][A-Z0-9.:]{1,14}$/.test(asked)) {
    return { symbol: asked, label: asked, url: chartUrl(asked) }
  }
  return null
}

export function chartUrl(symbol: string): string {
  const q = new URLSearchParams({
    symbol,
    interval: '60',
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
