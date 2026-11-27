import { useEffect, useMemo, useRef, useState } from "react";
import {
  BarSeries,
  CandlestickSeries,
  ColorType,
  CrosshairMode,
  HistogramSeries,
  LineSeries,
  LineStyle,
  PriceScaleMode,
  createChart,
} from "lightweight-charts";
import type { IChartApi, ISeriesApi, SeriesType, Time, UTCTimestamp } from "lightweight-charts";
import { DATED } from "./board";
import type { Interval, Style } from "./board";
import { bitcoinPrice, compact, price } from "./feed";
import type { Bar } from "./feed";
import { bands as bandsOf, macd as macdOf, movingAverage, rowsFrom, rsi as rsiOf, wheelAction } from "./series";
import type { Row } from "./series";

/** A colour token made see-through, for volume bars and the bands. */
function alpha(color: string, opacity: number) {
  const hex = /^#([0-9a-f]{6})$/i.exec(color);
  if (!hex) return color;
  const value = parseInt(hex[1], 16);
  return `rgba(${value >> 16}, ${(value >> 8) & 255}, ${value & 255}, ${opacity})`;
}

function palette(element: HTMLElement) {
  const style = getComputedStyle(element);
  const read = (name: string, fallback: string) => style.getPropertyValue(name).trim() || fallback;
  return {
    text: read("--ink-3", "#7d95a2"),
    grid: read("--hairline", "#172831"),
    edge: read("--bezel", "#20343e"),
    label: read("--mk-label", "#304e5d"),
    font: style.fontFamily || "system-ui, sans-serif",
    up: read("--mk-up", "#4cc38a"),
    down: read("--mk-down", "#e2647c"),
    bitcoin: read("--btc", "#e58b4e"),
    neutral: read("--usd", "#c9d8e0"),
    averages: [read("--mk-ma-1", "#a9c1cf"), read("--mk-ma-2", "#b37cdb"), read("--mk-ma-3", "#4fb3a6")],
    band: read("--mk-band", "#6f8fa3"),
    rsi: read("--mk-rsi", "#b37cdb"),
    macd: read("--mk-macd", "#4fb3a6"),
    signal: read("--mk-signal", "#e58b4e"),
  };
}

/** The theme named on the page, read after the page has switched so the colour tokens are the new ones. */
function useTheme() {
  const [theme, setTheme] = useState(() => document.documentElement.dataset.theme ?? "");
  useEffect(() => {
    const observer = new MutationObserver(() => setTheme(document.documentElement.dataset.theme ?? ""));
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    return () => observer.disconnect();
  }, []);
  return theme;
}

interface Drawn {
  shape: string;
  main: ISeriesApi<SeriesType>;
  volume: ISeriesApi<"Histogram"> | null;
  averages: { period: number; color: string; series: ISeriesApi<"Line"> }[];
  bands: { upper: ISeriesApi<"Line">; middle: ISeriesApi<"Line">; lower: ISeriesApi<"Line"> } | null;
  rsi: ISeriesApi<"Line"> | null;
  macd: { histogram: ISeriesApi<"Histogram">; line: ISeriesApi<"Line">; signal: ISeriesApi<"Line"> } | null;
  colors: ReturnType<typeof palette>;
  key: string;
  first: number;
  count: number;
}

const SPACING = 7;
/** The narrowest and widest a bar is drawn, in pixels. */
const NARROWEST = 0.5;
const WIDEST = 80;

/** Clock time of a moment in seconds, to the second, for a tick chart's axis and crosshair. */
const clockTime = (seconds: number) => new Date(seconds * 1000).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", second: "2-digit" });
/** RSI lines drawn across its pane: stretched up above 70, stretched down below 30. */
const RSI_LINES = [70, 30];
type Points = (number | null)[];
/** A study's line; a bar with no value is left blank, so the line breaks there instead of bridging the gap. */
const points = (rows: Row[], values: Points) => rows.map((row, at) => (values[at] != null ? { time: row.time, value: values[at] as number } : { time: row.time }));

/** A live price chart, in bars or candles, with optional volume, moving averages, Bollinger bands, RSI and MACD. */
export function PriceChart({
  bars,
  dataKey,
  interval,
  style,
  volume,
  log,
  averages,
  bands = false,
  rsi = false,
  macd = false,
  clock,
  digits,
  bitcoin,
  inBitcoin = false,
  fillsScreen = false,
  look = "",
}: {
  bars: Bar[];
  /** Changes when the bars belong to a different symbol or bar size, which resets the view. */
  dataKey: string;
  interval: Interval;
  style: Style;
  volume: boolean;
  log: boolean;
  averages: number[];
  bands?: boolean;
  rsi?: boolean;
  macd?: boolean;
  /**
   * For a tick chart: when a bar's first trade happened, in seconds, by the bar's number. Its bars are then
   * numbered in order instead of timed, since several can open within one second, and the axis reads these times.
   */
  clock?: (bar: number) => number | undefined;
  digits: number;
  /** Bitcoin's bars are drawn in copper accents; everything else in the neutral ink. */
  bitcoin: boolean;
  /** The bars are priced in whole bitcoin, so every figure is written with ₿. */
  inBitcoin?: boolean;
  /** The chart is the whole screen, so a plain scroll zooms it instead of moving the page. */
  fillsScreen?: boolean;
  /** The Markets colour theme in use. A change redraws the chart in the new colours. */
  look?: string;
}) {
  const host = useRef<HTMLDivElement>(null);
  const chart = useRef<IChartApi | null>(null);
  const drawn = useRef<Drawn | null>(null);
  const indexOf = useRef(new Map<number, number>());
  const total = useRef(0);
  const zoomsFreely = useRef(fillsScreen);
  zoomsFreely.current = fillsScreen;
  const [hover, setHover] = useState<number | null>(null);
  const [away, setAway] = useState(false);
  const theme = useTheme();
  const clocked = useRef(clock);
  clocked.current = clock;
  const numbered = clock !== undefined;
  const rows = useMemo(() => (numbered ? bars.map((bar) => ({ time: bar[0] as UTCTimestamp, bar })) : rowsFrom(bars, interval)), [bars, interval, numbered]);
  const closes = useMemo(() => rows.map((row) => row.bar[4]), [rows]);
  const lines = useMemo(() => averages.map((period) => ({ period, values: movingAverage(closes, period) })), [closes, averages]);
  const studies = useMemo(
    () => ({ bands: bands ? bandsOf(closes) : null, rsi: rsi ? rsiOf(closes) : null, macd: macd ? macdOf(closes) : null }),
    [closes, bands, rsi, macd],
  );
  const averagesKey = averages.join(",");

  useEffect(() => {
    if (!host.current) return;
    const made = createChart(host.current, {
      autoSize: true,
      layout: { background: { type: ColorType.Solid, color: "transparent" }, fontSize: 11, attributionLogo: false },
      crosshair: { mode: CrosshairMode.Normal },
      // A finger moving up or down scrolls the page; sideways it moves through the chart.
      handleScroll: { vertTouchDrag: false },
      timeScale: { rightOffset: 6, barSpacing: SPACING, minBarSpacing: NARROWEST, secondsVisible: false },
      localization: { locale: "en-US" },
    });
    if (clocked.current) {
      // A tick chart's bars are numbered; its axis and crosshair read when each bar's first trade happened.
      const at = (time: Time) => {
        const seconds = clocked.current?.(time as number);
        return seconds === undefined ? "" : clockTime(seconds);
      };
      made.applyOptions({ localization: { locale: "en-US", timeFormatter: at }, timeScale: { tickMarkFormatter: at } });
    }
    chart.current = made;
    // Heard before the chart hears it, so a plain scroll can be kept for the page.
    const element = host.current;
    const onWheel = (event: WheelEvent) => {
      const action = wheelAction(event, zoomsFreely.current);
      if (action === "zoom") return; // The chart zooms around the pointer itself.
      event.stopPropagation();
      if (action === "page") return; // Nothing is cancelled, so the page scrolls as usual.
      // Sideways: move through time, and keep the browser from taking the swipe as "go back".
      event.preventDefault();
      const scale = made.timeScale();
      const pixels = event.deltaMode === 1 ? event.deltaX * 16 : event.deltaX;
      scale.scrollToPosition(scale.scrollPosition() + pixels / scale.options().barSpacing, false);
    };
    element.addEventListener("wheel", onWheel, { capture: true, passive: false });
    made.subscribeCrosshairMove((event) => {
      const at = event.time === undefined ? undefined : indexOf.current.get(event.time as number);
      setHover(at ?? null);
    });
    made.timeScale().subscribeVisibleLogicalRangeChange((range) => setAway(range !== null && range.to < total.current - 1.5));
    return () => {
      element.removeEventListener("wheel", onWheel, { capture: true });
      made.remove();
      chart.current = null;
      drawn.current = null;
    };
  }, []);

  useEffect(() => {
    const made = chart.current;
    if (!made || !host.current) return;
    const shape = [style, volume, averagesKey, bands, rsi, macd, theme, look, digits, bitcoin, inBitcoin].join("|");
    let now = drawn.current;
    if (!now || now.shape !== shape) {
      if (now) {
        const old = [now.main, now.volume, now.rsi, ...now.averages.map((line) => line.series)];
        if (now.bands) old.push(now.bands.upper, now.bands.middle, now.bands.lower);
        if (now.macd) old.push(now.macd.histogram, now.macd.line, now.macd.signal);
        for (const series of old) if (series) made.removeSeries(series);
        while (made.panes().length > 1) made.removePane(made.panes().length - 1);
      }
      const colors = palette(host.current);
      made.applyOptions({
        layout: { textColor: colors.text, fontFamily: colors.font, panes: { separatorColor: colors.edge, separatorHoverColor: alpha(colors.text, 0.2) } },
        grid: { vertLines: { color: colors.grid }, horzLines: { color: colors.grid } },
        crosshair: {
          vertLine: { color: colors.text, width: 1, style: LineStyle.Dashed, labelBackgroundColor: colors.label },
          horzLine: { color: colors.text, width: 1, style: LineStyle.Dashed, labelBackgroundColor: colors.label },
        },
        rightPriceScale: { borderColor: colors.edge, scaleMargins: { top: 0.12, bottom: 0.08 } },
        timeScale: { borderColor: colors.edge },
      });
      const histogram = volume ? made.addSeries(HistogramSeries, { priceFormat: { type: "volume" }, priceScaleId: "", lastValueVisible: false, priceLineVisible: false }) : null;
      histogram?.priceScale().applyOptions({ scaleMargins: { top: 0.84, bottom: 0 } });
      const format = inBitcoin
        ? { priceFormat: { type: "custom" as const, minMove: 1 / 10 ** digits, formatter: (value: number) => bitcoinPrice(value, digits) } }
        : { priceFormat: { type: "price" as const, precision: digits, minMove: 1 / 10 ** digits } };
      const main: ISeriesApi<SeriesType> =
        style === "bars"
          ? made.addSeries(BarSeries, { ...format, upColor: colors.up, downColor: colors.down, openVisible: true, thinBars: false })
          : made.addSeries(CandlestickSeries, { ...format, upColor: colors.up, downColor: colors.down, wickUpColor: colors.up, wickDownColor: colors.down, borderVisible: false });
      // Room under the price for volume; set on the price's own scale so the panes below keep theirs.
      main.priceScale().applyOptions({ scaleMargins: { top: 0.1, bottom: volume ? 0.24 : 0.08 } });
      const quiet = { lastValueVisible: false, priceLineVisible: false, crosshairMarkerVisible: false };
      // The bands follow the price's scale but never stretch it, so a wild stretch does not squash the bars.
      const band = (lineStyle: LineStyle) =>
        made.addSeries(LineSeries, { ...format, ...quiet, color: alpha(colors.band, 0.9), lineWidth: 1, lineStyle, autoscaleInfoProvider: () => null });
      // Each study under the price gets its own pane, a third the height of the price's.
      let pane = 0;
      const rsiLine = rsi
        ? made.addSeries(
            LineSeries,
            {
              color: colors.rsi,
              lineWidth: 1,
              priceLineVisible: false,
              priceFormat: { type: "price", precision: 1, minMove: 0.1 },
              autoscaleInfoProvider: () => ({ priceRange: { minValue: 0, maxValue: 100 } }),
            },
            ++pane,
          )
        : null;
      if (rsiLine) for (const level of RSI_LINES) rsiLine.createPriceLine({ price: level, color: alpha(colors.text, 0.5), lineWidth: 1, lineStyle: LineStyle.Dotted, axisLabelVisible: true, title: "" });
      const macdPane = macd ? ++pane : 0;
      const macdSeries = macd
        ? {
            histogram: made.addSeries(HistogramSeries, { ...quiet, priceFormat: { type: "price", precision: digits, minMove: 1 / 10 ** digits } }, macdPane),
            line: made.addSeries(LineSeries, { ...quiet, color: colors.macd, lineWidth: 1, priceFormat: { type: "price", precision: digits, minMove: 1 / 10 ** digits } }, macdPane),
            signal: made.addSeries(LineSeries, { ...quiet, color: colors.signal, lineWidth: 1, priceFormat: { type: "price", precision: digits, minMove: 1 / 10 ** digits } }, macdPane),
          }
        : null;
      const panes = made.panes();
      panes[0]?.setStretchFactor(3);
      for (const below of panes.slice(1)) below.setStretchFactor(1);
      now = drawn.current = {
        shape,
        main,
        volume: histogram,
        averages: averages.map((period, order) => {
          const color = colors.averages[order % colors.averages.length];
          return { period, color, series: made.addSeries(LineSeries, { ...format, ...quiet, color, lineWidth: 1 }) };
        }),
        bands: bands ? { upper: band(LineStyle.Solid), middle: band(LineStyle.Dashed), lower: band(LineStyle.Solid) } : null,
        rsi: rsiLine,
        macd: macdSeries,
        colors,
        key: "",
        first: 0,
        count: 0,
      };
    }
    // Only the price is drawn on a log scale: RSI and MACD sit near or below zero, where a log scale breaks.
    now.main.priceScale().applyOptions({ mode: log ? PriceScaleMode.Logarithmic : PriceScaleMode.Normal });
    made.applyOptions({ timeScale: { timeVisible: numbered || !DATED.has(interval) } });

    const colors = now.colors;
    const mainPoint = ({ time, bar }: Row) => ({ time, open: bar[1], high: bar[2], low: bar[3], close: bar[4] });
    const volumePoint = ({ time, bar }: Row) => ({ time, value: bar[5], color: alpha(bar[4] >= bar[1] ? colors.up : colors.down, 0.4) });
    // A bar added to the same run of bars is drawn in place; anything else redraws the series.
    const follows = now.key === dataKey && now.count > 0 && rows.length >= now.count && rows[0]?.time === now.first;
    const from = follows ? now.count - 1 : 0;
    if (follows) {
      for (let at = from; at < rows.length; at++) {
        now.main.update(mainPoint(rows[at]));
        now.volume?.update(volumePoint(rows[at]));
      }
    } else {
      now.main.setData(rows.map(mainPoint));
      now.volume?.setData(rows.map(volumePoint));
    }
    // Each study at a bar depends only on that bar and the ones before it, so a new bar is drawn in place too.
    const draw = (series: ISeriesApi<"Line"> | undefined | null, values: Points | undefined) => {
      if (!series || !values) return;
      if (follows) {
        for (let at = from; at < rows.length; at++) series.update(values[at] != null ? { time: rows[at].time, value: values[at] as number } : { time: rows[at].time });
      } else series.setData(points(rows, values));
    };
    for (const line of now.averages) draw(line.series, lines.find((entry) => entry.period === line.period)?.values);
    draw(now.bands?.upper, studies.bands?.upper);
    draw(now.bands?.middle, studies.bands?.middle);
    draw(now.bands?.lower, studies.bands?.lower);
    draw(now.rsi, studies.rsi ?? undefined);
    if (now.macd && studies.macd) {
      draw(now.macd.line, studies.macd.line);
      draw(now.macd.signal, studies.macd.signal);
      const gaps = studies.macd.histogram;
      const bar = (at: number) => ({ time: rows[at].time, value: gaps[at] as number, color: alpha((gaps[at] as number) >= 0 ? colors.up : colors.down, 0.55) });
      if (follows) {
        for (let at = from; at < rows.length; at++) if (gaps[at] != null) now.macd.histogram.update(bar(at));
      } else now.macd.histogram.setData(rows.flatMap((_, at) => (gaps[at] != null ? [bar(at)] : [])));
    }
    if (now.key !== dataKey && rows.length) {
      made.timeScale().applyOptions({ barSpacing: SPACING });
      made.timeScale().scrollToRealTime();
      // A short run, such as a dozen yearly bars, is spread across the chart instead of huddled at its right edge.
      const room = made.timeScale().width();
      if (room > 0 && rows.length * SPACING < room * 0.6) made.timeScale().applyOptions({ barSpacing: Math.min(WIDEST, (room * 0.85) / (rows.length + 6)) });
      made.priceScale("right").applyOptions({ autoScale: true });
    }
    indexOf.current = new Map(rows.map((row, at) => [row.time as number, at]));
    total.current = rows.length;
    now.key = rows.length ? dataKey : "";
    now.first = rows[0]?.time ?? 0;
    now.count = rows.length;
  }, [rows, lines, studies, dataKey, interval, numbered, style, volume, log, averagesKey, averages, bands, rsi, macd, digits, bitcoin, inBitcoin, theme, look]);

  const at = hover !== null && hover < rows.length ? hover : rows.length - 1;
  const shown = rows[at]?.bar;
  const before = rows[at - 1]?.bar[4];
  const move = shown && before ? ((shown[4] - before) / before) * 100 : null;
  const rising = shown ? (move !== null ? move >= 0 : shown[4] >= shown[1]) : true;
  const figure = (value: number) => (inBitcoin ? bitcoinPrice(value, digits) : price(value, digits));
  const resize = (factor: number) => {
    const scale = chart.current?.timeScale();
    if (scale) scale.applyOptions({ barSpacing: Math.min(WIDEST, Math.max(NARROWEST, scale.options().barSpacing * factor)) });
  };
  const rsiNow = studies.rsi?.[at];
  const macdNow = studies.macd?.line[at];
  const signalNow = studies.macd?.signal[at];
  return (
    <div className="mk-chart">
      <div ref={host} className="mk-canvas" role="img" aria-label="Price chart" />
      {shown && (
        <div className="mk-legend num" aria-hidden="true">
          <span className={rising ? "mk-up" : "mk-down"}>
            <i>O</i> {figure(shown[1])} <i>H</i> {figure(shown[2])} <i>L</i> {figure(shown[3])} <i>C</i> {figure(shown[4])}
            {move !== null && ` ${move >= 0 ? "+" : "−"}${Math.abs(move).toFixed(2)}%`}
          </span>
          {volume && shown[5] > 0 && (
            <span>
              <i>Vol</i> {compact(shown[5])}
            </span>
          )}
          {lines.map((line, order) =>
            line.values[at] != null ? (
              <span key={line.period} style={{ color: `var(--mk-ma-${(order % 3) + 1})` }}>
                <i>MA {line.period}</i> {figure(line.values[at] as number)}
              </span>
            ) : null,
          )}
          {studies.bands && studies.bands.upper[at] != null && (
            <span className="mk-leg-band">
              <i>BB 20</i> {figure(studies.bands.upper[at] as number)} / {studies.bands.lower[at] != null ? figure(studies.bands.lower[at] as number) : "—"}
            </span>
          )}
          {rsiNow != null && (
            <span className="mk-leg-rsi">
              <i>RSI 14</i> {rsiNow.toFixed(1)}
            </span>
          )}
          {macdNow != null && (
            <span className="mk-leg-macd">
              <i>MACD</i> {price(macdNow, digits)}
              {signalNow != null && <> · {price(signalNow, digits)}</>}
            </span>
          )}
        </div>
      )}
      <div className="mk-zoom">
        <button onClick={() => resize(1 / 1.3)} title="Narrower bars, more history" aria-label="Zoom out">
          −
        </button>
        <button onClick={() => resize(1.3)} title="Wider bars, less history" aria-label="Zoom in">
          +
        </button>
        {away && (
          <button onClick={() => chart.current?.timeScale().scrollToRealTime()} title="Jump to the latest bar" aria-label="Jump to the latest bar">
            ⇥
          </button>
        )}
      </div>
    </div>
  );
}
