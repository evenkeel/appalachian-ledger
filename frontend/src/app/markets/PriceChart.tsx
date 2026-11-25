import { useEffect, useMemo, useRef, useState } from "react";
import {
  AreaSeries,
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
import type { IChartApi, ISeriesApi, SeriesType } from "lightweight-charts";
import type { Interval, Style } from "./board";
import { bitcoinPrice, compact, price } from "./feed";
import type { Bar } from "./feed";
import { movingAverage, rowsFrom, wheelAction } from "./series";
import type { Row } from "./series";

/** A colour token made see-through, for volume bars and the area fill. */
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
  colors: ReturnType<typeof palette>;
  key: string;
  first: number;
  count: number;
}

const SPACING = 7;
/** The narrowest and widest a bar is drawn, in pixels. */
const NARROWEST = 0.5;
const WIDEST = 80;

/** A live price chart: bars, candles, a line or an area, with optional volume and moving averages. */
export function PriceChart({
  bars,
  dataKey,
  interval,
  style,
  volume,
  log,
  averages,
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
  digits: number;
  /** Bitcoin's line is drawn in copper; everything else in the neutral ink. */
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
  const rows = useMemo(() => rowsFrom(bars, interval), [bars, interval]);
  const lines = useMemo(() => {
    const closes = rows.map((row) => row.bar[4]);
    return averages.map((period) => ({ period, values: movingAverage(closes, period) }));
  }, [rows, averages]);
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
    const shape = [style, volume, averagesKey, theme, look, digits, bitcoin, inBitcoin].join("|");
    let now = drawn.current;
    if (!now || now.shape !== shape) {
      if (now) for (const series of [now.main, now.volume, ...now.averages.map((line) => line.series)]) if (series) made.removeSeries(series);
      const colors = palette(host.current);
      made.applyOptions({
        layout: { textColor: colors.text, fontFamily: colors.font },
        grid: { vertLines: { color: colors.grid }, horzLines: { color: colors.grid } },
        crosshair: {
          vertLine: { color: colors.text, width: 1, style: LineStyle.Dashed, labelBackgroundColor: colors.label },
          horzLine: { color: colors.text, width: 1, style: LineStyle.Dashed, labelBackgroundColor: colors.label },
        },
        rightPriceScale: { borderColor: colors.edge, scaleMargins: { top: 0.1, bottom: volume ? 0.24 : 0.08 } },
        timeScale: { borderColor: colors.edge },
      });
      const histogram = volume ? made.addSeries(HistogramSeries, { priceFormat: { type: "volume" }, priceScaleId: "", lastValueVisible: false, priceLineVisible: false }) : null;
      histogram?.priceScale().applyOptions({ scaleMargins: { top: 0.84, bottom: 0 } });
      const format = inBitcoin
        ? { priceFormat: { type: "custom" as const, minMove: 1 / 10 ** digits, formatter: (value: number) => bitcoinPrice(value, digits) } }
        : { priceFormat: { type: "price" as const, precision: digits, minMove: 1 / 10 ** digits } };
      const accent = bitcoin || inBitcoin ? colors.bitcoin : colors.neutral;
      const main: ISeriesApi<SeriesType> =
        style === "bars"
          ? made.addSeries(BarSeries, { ...format, upColor: colors.up, downColor: colors.down, openVisible: true, thinBars: false })
          : style === "candles"
            ? made.addSeries(CandlestickSeries, { ...format, upColor: colors.up, downColor: colors.down, wickUpColor: colors.up, wickDownColor: colors.down, borderVisible: false })
            : style === "line"
              ? made.addSeries(LineSeries, { ...format, color: accent, lineWidth: 2 })
              : made.addSeries(AreaSeries, { ...format, lineColor: accent, lineWidth: 2, topColor: alpha(accent, 0.3), bottomColor: alpha(accent, 0) });
      now = drawn.current = {
        shape,
        main,
        volume: histogram,
        averages: averages.map((period, order) => {
          const color = colors.averages[order % colors.averages.length];
          return { period, color, series: made.addSeries(LineSeries, { ...format, color, lineWidth: 1, lastValueVisible: false, priceLineVisible: false, crosshairMarkerVisible: false }) };
        }),
        colors,
        key: "",
        first: 0,
        count: 0,
      };
    }
    made.applyOptions({
      rightPriceScale: { mode: log ? PriceScaleMode.Logarithmic : PriceScaleMode.Normal },
      timeScale: { timeVisible: interval !== "1d" && interval !== "1w" },
    });

    const ohlc = style === "bars" || style === "candles";
    const mainPoint = ({ time, bar }: Row) => (ohlc ? { time, open: bar[1], high: bar[2], low: bar[3], close: bar[4] } : { time, value: bar[4] });
    const volumePoint = ({ time, bar }: Row) => ({ time, value: bar[5], color: alpha(bar[4] >= bar[1] ? now.colors.up : now.colors.down, 0.4) });
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
    for (const line of now.averages) {
      const values = lines.find((entry) => entry.period === line.period)?.values ?? [];
      const point = (at: number) => ({ time: rows[at].time, value: values[at] as number });
      if (follows) {
        for (let at = from; at < rows.length; at++) if (values[at] != null) line.series.update(point(at));
      } else {
        line.series.setData(rows.flatMap((_, at) => (values[at] != null ? [point(at)] : [])));
      }
    }
    if (now.key !== dataKey && rows.length) {
      made.timeScale().applyOptions({ barSpacing: SPACING });
      made.timeScale().scrollToRealTime();
      made.priceScale("right").applyOptions({ autoScale: true });
    }
    indexOf.current = new Map(rows.map((row, at) => [row.time as number, at]));
    total.current = rows.length;
    now.key = rows.length ? dataKey : "";
    now.first = rows[0]?.time ?? 0;
    now.count = rows.length;
  }, [rows, lines, dataKey, interval, style, volume, log, averagesKey, averages, digits, bitcoin, inBitcoin, theme, look]);

  const at = hover !== null && hover < rows.length ? hover : rows.length - 1;
  const shown = rows[at]?.bar;
  const before = rows[at - 1]?.bar[4];
  const move = shown && before ? ((shown[4] - before) / before) * 100 : null;
  const rising = shown ? (move !== null ? move >= 0 : shown[4] >= shown[1]) : true;
  const ohlc = style === "bars" || style === "candles";
  const figure = (value: number) => (inBitcoin ? bitcoinPrice(value, digits) : price(value, digits));
  const resize = (factor: number) => {
    const scale = chart.current?.timeScale();
    if (scale) scale.applyOptions({ barSpacing: Math.min(WIDEST, Math.max(NARROWEST, scale.options().barSpacing * factor)) });
  };
  return (
    <div className="mk-chart">
      <div ref={host} className="mk-canvas" role="img" aria-label="Price chart" />
      {shown && (
        <div className="mk-legend num" aria-hidden="true">
          <span className={rising ? "mk-up" : "mk-down"}>
            {ohlc ? (
              <>
                <i>O</i> {figure(shown[1])} <i>H</i> {figure(shown[2])} <i>L</i> {figure(shown[3])} <i>C</i> {figure(shown[4])}
              </>
            ) : (
              figure(shown[4])
            )}
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
