import {
  Layer,
  Rectangle,
  ResponsiveContainer,
  Sankey,
  Tooltip,
} from "recharts";
import { useReportingUnit } from "../lib/monetaryLens";
import { formatMoney, subtractMoney, sumMoney } from "../lib/money";
import type { Report } from "../lib/types";

type Side =
  "income" | "hub" | "expense" | "stacked" | "moved" | "kept" | "drawn";
interface FlowNode {
  name: string;
  side: Side;
  /** Exact decimal in the reporting unit; sizes the ribbon. */
  exact: string;
  /** Shown instead of `exact`, e.g. the bitcoin actually received. */
  label?: string;
}
const colors: Record<Side, string> = {
  income: "var(--green)",
  hub: "var(--blue)",
  expense: "var(--amethyst)",
  stacked: "var(--accent)",
  moved: "var(--blue)",
  kept: "var(--muted)",
  drawn: "var(--red)",
};

/** Income flowing through the month into spending, bitcoin stacked, other transfers, and cash left over. */
export function CashFlowDiagram({ report }: { report: Report }) {
  const unit = useReportingUnit("USD");
  const flow = report.dual?.[unit];
  const positive = (rows: { name: string; value: string | null }[] = []) =>
    rows.filter((row) => row.value != null && Number(row.value) > 0) as {
      name: string;
      value: string;
    }[];
  const sources = positive(flow?.income_categories),
    uses = positive(flow?.categories);
  // Bitcoin and other transfers are known in dollars; the bitcoin lens values them in bitcoin.
  const stacked = report.stacked;
  const stackedValue =
    unit === "USD" ? (stacked?.usd ?? "0") : (stacked?.bitcoin ?? "0");
  const movedValue = unit === "USD" ? (stacked?.other_usd ?? "0") : "0";
  const totalOut = sumMoney([flow?.expenses ?? null, stackedValue, movedValue]);
  const out = totalOut.missing ? null : totalOut.total;
  const net = subtractMoney(flow?.income, out);
  const missing =
    (flow?.income_categories?.length ?? 0) +
    (flow?.categories.length ?? 0) -
    sources.length -
    uses.length;
  if (!flow || (!sources.length && !uses.length))
    return (
      <p className="empty-inline">
        Record income or expenses this month to see where the money went.
      </p>
    );
  // Floats size the ribbons only; every label shows the exact recorded amount.
  const nodes: FlowNode[] = [];
  const links: { source: number; target: number; value: number }[] = [];
  const add = (node: FlowNode) => nodes.push(node) - 1;
  const hub = add({
    name: "This month",
    side: "hub",
    exact:
      net && net.startsWith("-")
        ? (flow.expenses ?? "0")
        : (flow.income ?? "0"),
  });
  for (const row of sources)
    links.push({
      source: add({ name: row.name, side: "income", exact: row.value }),
      target: hub,
      value: Number(row.value),
    });
  if (net && net.startsWith("-"))
    links.push({
      source: add({
        name: "From cash on hand",
        side: "drawn",
        exact: net.slice(1),
      }),
      target: hub,
      value: Number(net.slice(1)),
    });
  for (const row of uses)
    links.push({
      source: hub,
      target: add({ name: row.name, side: "expense", exact: row.value }),
      value: Number(row.value),
    });
  if (Number(stackedValue) > 0)
    links.push({
      source: hub,
      target: add({
        name: "Bitcoin stacked",
        side: "stacked",
        exact: stackedValue,
        label: formatMoney(stacked?.bitcoin ?? null, "BITCOIN"),
      }),
      value: Number(stackedValue),
    });
  if (Number(movedValue) > 0)
    links.push({
      source: hub,
      target: add({
        name: "Other transfers out",
        side: "moved",
        exact: movedValue,
      }),
      value: Number(movedValue),
    });
  if (net && Number(net) > 0)
    links.push({
      source: hub,
      target: add({ name: "Left in cash", side: "kept", exact: net }),
      value: Number(net),
    });
  return (
    <>
      <div
        className="cash-flow-diagram"
        role="img"
        aria-label={`Cash flow for ${report.month}: ${nodes
          .filter((node) => node.side !== "hub")
          .map(
            (node) =>
              `${node.name} ${node.label ?? formatMoney(node.exact, unit)}`,
          )
          .join(", ")}`}
        style={{ height: Math.max(300, nodes.length * 34) }}
      >
        <ResponsiveContainer width="100%" height="100%">
          <Sankey
            data={{ nodes, links }}
            nodePadding={18}
            nodeWidth={12}
            iterations={32}
            margin={{ top: 12, right: 220, bottom: 12, left: 170 }}
            link={{ stroke: "var(--muted)", strokeOpacity: 0.22 }}
            node={(props) => {
              const { x, y, width, height } = props;
              const payload = props.payload as unknown as FlowNode;
              const left =
                payload.side === "income" || payload.side === "drawn";
              const center = payload.side === "hub";
              return (
                <Layer>
                  <Rectangle
                    x={x}
                    y={y}
                    width={width}
                    height={Math.max(height, 2)}
                    radius={3}
                    fill={colors[payload.side]}
                  />
                  {!center && (
                    <text
                      x={left ? x - 10 : x + width + 10}
                      y={y + height / 2}
                      textAnchor={left ? "end" : "start"}
                      dominantBaseline="middle"
                      fontSize={13}
                      fill="var(--text)"
                    >
                      {payload.name}
                      <tspan fill="var(--muted)">
                        {"  "}
                        {payload.label ?? formatMoney(payload.exact, unit)}
                      </tspan>
                    </text>
                  )}
                </Layer>
              );
            }}
          >
            <Tooltip
              content={({ active, payload }) => {
                const item = payload?.[0]?.payload as
                  | {
                      payload?: {
                        source?: FlowNode;
                        target?: FlowNode;
                        name?: string;
                        exact?: string;
                        label?: string;
                      };
                    }
                  | undefined;
                const data = item?.payload;
                if (!active || !data) return null;
                const end =
                  data.source?.side === "hub" ? data.target : data.source;
                const name = end?.name ?? data.name;
                const shown =
                  end?.label ??
                  data.label ??
                  formatMoney(end?.exact ?? data.exact, unit);
                return name ? (
                  <div className="chart-tooltip">
                    <strong>{name}</strong>
                    <div>
                      <span>{report.month}</span>
                      <span>{shown}</span>
                    </div>
                  </div>
                ) : null;
              }}
            />
          </Sankey>
        </ResponsiveContainer>
      </div>
      {missing > 0 && (
        <p className="hint cash-flow-note">
          {missing} {missing === 1 ? "category is" : "categories are"} left out
          because a conversion is unavailable.
        </p>
      )}
    </>
  );
}
