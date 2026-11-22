# Markets

The **Markets** screen is a board of live price charts and watchlists. It is for watching prices; it never
writes to the ledger, and nothing on it is used to value an account or an expense.

## What it shows

- **Charts.** Open-high-low-close bars by default, with candles, a line or an area one click away. The bar
  size is chosen from a row on every chart: 1m, 5m, 15m, 1h, 4h, 1D, 1W. Volume, 20/50/200-bar moving
  averages and a log scale are under **Indicators**. Hover to read a bar's open, high, low and close, and
  drag to move through time.
- **Scrolling and zooming.** Scrolling with the pointer over a chart moves the page, as it does anywhere
  else. To zoom a chart, hold Ctrl or ⌘ and scroll, pinch on a trackpad, use the − and + buttons that appear
  over the chart, or drag along the dates at the bottom. A sideways swipe moves through time. A chart that
  fills the screen zooms on a plain scroll, since there is no page to move.
- **Watchlists.** The latest price, the day's change and a small line of the day's closes for each symbol.
  Clicking a row loads it into the selected chart (the one with the copper top edge).
- **Bitcoin's order book.** Everyone waiting to buy and sell on Coinbase: sellers above, buyers below, the
  spread between them, updated about four times a second. Each row shows the price, the bitcoin resting
  there and the running total out from the middle, shaded by that total. Prices can be shown to the cent or
  grouped in wider dollar steps.
- **Bitcoin's depth chart.** The same order book added up outward from the price: buy orders rising to the
  left, sell orders to the right. Hovering reads how much bitcoin, and how many dollars, sit between the
  price and the pointer. The reach either side is ±0.25%, ±0.5%, ±1% or ±2.5%.
- **Any symbol.** Bitcoin, gold, silver, stock indexes and single stocks are quick picks; anything else is
  found by name or ticker through the search.

Panels are added from **+ Add** at the top of the screen. The order book and depth chart are for bitcoin
only, since Coinbase is the one source here with a public order book.

Panels are dragged by their top edge and resized from the bottom-right corner, the bottom edge or the right
edge. A chart can fill the screen and come back with Escape. On a phone the panels stack in one column.

## Colours

**Colors**, at the top of the screen, changes how the Markets screen alone looks. The rest of the app keeps
its own night and day themes, and the choice is saved in this browser.

| Look | What it is |
| --- | --- |
| Appalachian | The app's own colours; follows the night and day switch |
| Terminal | Amber text on black with hard green and red, fixed-width type and square corners, like a trading terminal |
| Slate | Dark grey with teal and red, as most charting sites use |
| Paper | Black on white, for a bright room |

Every panel follows the look: charts, watchlists, the order book and the depth chart. Dialogs such as the
symbol search belong to the app and keep its theme. A look is a set of colour tokens in
`frontend/src/app/markets/markets.css` and one entry in `looks.ts`, so another can be added in a few lines.

## Priced in bitcoin

Every chart except bitcoin's own can be drawn in dollars or in whole bitcoin.

- The **$ / ₿ switch in the top bar** prices every chart at once. It is the app-wide lens, so it is
  remembered with your ledger.
- The **$ / ₿ buttons on a chart** price that chart alone, so gold can sit in bitcoin beside a stock in
  dollars. That choice is saved with the board. Using the top-bar switch afterwards moves every chart again,
  including any that had been set on its own.

Bitcoin's chart stays in dollars and, under the bitcoin lens, adds how much bitcoin a dollar buys.

How a bar is priced:

- A bar's **open** is its dollar open divided by bitcoin's price at the moment the bar opened, and its
  **close** is its dollar close divided by bitcoin's price at the moment it closed.
- What the price reached in between is not known in bitcoin, because the dollar high and the bitcoin price at
  that instant are not recorded together. So a bar spans only its open and close: its high and low are the
  higher and lower of the two. A weekly bar is built from that week's daily bars, so it does show the range
  of its days.
- Bitcoin's price at a moment is read from Coinbase bars of the same size or finer. On the edge of a bar it
  is that bar's open; inside a bar it is taken on a straight line from the bar's open to its close, which is
  the one estimate made. A stretch older than the bitcoin bars held is left off the chart, not guessed.
- A stock's day runs over its exchange's regular hours (09:30 to 16:00 in New York). A futures day runs from
  18:00 New York time the evening before to the contract's settlement the next afternoon; settlement times
  are built in for the common metals, energy, index, Treasury and grain contracts and are approximate, and
  any other contract is taken at the 17:00 close. The newest bar is priced no later than its last trade.

How far back each bar size goes in bitcoin: 1m about two days, 5m about ten days, 15m a month, 1h and 4h
about six months, 1D and 1W five years (the most recent six months of daily bars use hourly bitcoin prices,
older ones daily).

A yield (such as the 10-year Treasury) is a rate, not a price, and a symbol quoted in another currency would
need an exchange rate, so both stay as they are and are marked **Not priced in bitcoin**. Watchlists stay in
each symbol's own currency. Each chart header keeps the dollar price and the day's dollar change beside the
bitcoin figure.

## Where the prices come from

| What | Source | How fresh |
| --- | --- | --- |
| Bitcoin (`BTC-USD`) | Coinbase Exchange public feed | Every trade as it happens, usually within a few hundredths of a second |
| Everything else | Yahoo Finance public chart endpoint | Read every 15 seconds while that market is open; some exchanges run up to 15 minutes behind |

### Bitcoin, trade by trade

While a Markets screen is open, the server keeps one connection to Coinbase's public trade feed and passes
each BTC-USD trade to the browser the moment it arrives. The bitcoin chart's newest bar, its header price
and bitcoin's watchlist row move with every trade, and the chart's source reads **Coinbase · every trade**.
Each trade carries the exchange's own timestamp; on a home connection a trade is typically on screen 10 to
300 milliseconds after it happened. That delay is the network, and nothing here can remove it.

- The screen redraws at most about 30 times a second. A burst of hundreds of trades is one redraw, and every
  trade in it still counts toward the bar's high, low and volume.
- The bars themselves are re-read from Coinbase every 10 seconds so they stay exact.
- If the stream cannot be reached, the screen goes back to reading bitcoin every 3 seconds and the
  "every trade" label disappears. It reconnects by itself.
- The connection to Coinbase closes about 20 seconds after the last Markets screen is closed, and the stream
  rests while the browser tab is hidden.
- Only bitcoin is streamed. Charts priced in bitcoin for other symbols are still read every 5 seconds.

### Bitcoin's order book

The full BTC-USD book is tens of thousands of price levels, so the server keeps it and sends the browser a
picture about four times a second: the 60 levels nearest the spread on each side exactly as the exchange
holds them, a view grouped by the dollar a quarter of a percent either way, and a coarser view 2.5% either
way for the depth chart and the wider groups. The server holds the book only while an order book or depth
panel is open. If an update is missed and the book stops making sense (a buyer above the lowest seller), it
is read again from the start instead of being shown wrong. Sizes are in BTC.

The browser only ever talks to your own ledger. The server fetches the prices, so the strict content
security policy is unchanged and **only ticker symbols leave your machine**: no balances, account names or
anything else from the ledger. Requests are made only while the Markets screen is open and visible, and
several panels showing the same symbol share one outbound request.

Neither source is a contracted feed. Either can change, rate-limit or go quiet. When that happens the chart
keeps the last bars it received and is marked **Not updating**; a symbol with no prices says so instead of
drawing an empty chart. No price is ever filled in.

Four-hour and weekly bitcoin bars are built from Coinbase's hourly and daily bars. Daily and weekly bars for
other symbols sit on their trading date in the exchange's own time zone; bars within a day are shown in your
browser's time zone.

## What is saved

The board (which panels, their symbols, bar sizes, styles and positions) is kept in this browser's local
storage under `appalachian-bitcoin.markets.v1`, and the colour look under `appalachian-bitcoin.markets.look`. It is not part of the ledger or its backups, so another
browser or device starts from the default board. **Reset board** returns to that default.

## Endpoints

All require a signed-in owner and are read-only.

- `GET /api/market/candles?symbol=&interval=&unit=&after=`: bars as `[time, open, high, low, close, volume]`,
  time in seconds. With `after`, only the bars from that time on, and `full` is `false`. `unit=bitcoin`
  restates a dollar-quoted symbol in whole bitcoin; the reply's `unit` is `BITCOIN` when it did, and the
  symbol's own currency when it did not.
- `GET /api/market/stream`: server-sent events, one per BTC-USD trade, as `{"p": price, "s": size in BTC,
  "t": milliseconds}`. A stream ends after ten minutes and the browser reconnects, which checks the sign-in
  again. It is sent with `X-Accel-Buffering: no`, so the bundled nginx passes events through unbuffered.
- `GET /api/market/book`: server-sent events, each a picture of the BTC-USD order book as `{"t", "bid",
  "ask", "top", "near", "wide"}`, where each view is `{"step", "bids", "asks"}` with levels as
  `[price, size in BTC]`, bids from the highest price down and asks from the lowest up.
- `GET /api/market/quotes?symbols=A,B,C`: latest price, the earlier price the change is measured from
  (`previous`, with `basis` saying whether that is 24 hours ago or the previous close) and a short run of
  closes. A symbol with no price carries only an `error`.
- `GET /api/market/search?q=`: symbols matching a name or ticker.

These values are plain numbers because they are chart coordinates. Ledger money stays in integer cents and
integer bitcoin units, as described in [architecture](architecture.md).

Charts are drawn with [TradingView Lightweight Charts™](https://www.tradingview.com/) (Apache-2.0) and the
board is laid out with react-grid-layout (MIT); see the [third-party notices](../THIRD_PARTY_NOTICES.md).
