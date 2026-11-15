import { useReportingUnit } from "../lib/monetaryLens";
import { formatMoney, subtractMoney, sumMoney } from "../lib/money";
import type { Account, Transaction } from "../lib/types";
import { Money } from "./Money";
import { SegmentBar, StatTile } from "./Visuals";

type Unit = "USD" | "BITCOIN";
const accountValue = (account: Account, unit: Unit) =>
  account.currency === unit
    ? account.balance
    : unit === "USD"
      ? account.usd
      : account.bitcoin;
const transactionValue = (row: Transaction, unit: Unit) =>
  row.currency === unit ? row.amount : unit === "USD" ? row.usd : row.bitcoin;
const size = (value: string) => Math.max(Number(value), 0);
const missingNote = (count: number, noun: string) =>
  count
    ? `${count} ${noun}${count === 1 ? "" : "s"} without a conversion ${count === 1 ? "is" : "are"} left out`
    : undefined;

/** What the everyday accounts hold, by kind, in the reporting currency. */
export function AccountsSummary({ accounts }: { accounts: Account[] }) {
  const unit = useReportingUnit("USD");
  const active = accounts.filter((account) => !account.archived);
  const group = (type: Account["holding_type"]) =>
    sumMoney(
      active
        .filter((account) => account.holding_type === type)
        .map((account) => accountValue(account, unit)),
    );
  const bitcoin = group("bitcoin"),
    dollars = group("dollars"),
    invested = group("valued_asset"),
    debt = group("debt");
  const owned = sumMoney([bitcoin.total, dollars.total, invested.total]);
  const missing =
    bitcoin.missing + dollars.missing + invested.missing + debt.missing;
  if (!active.length) return null;
  return (
    <section className="panel summary-panel" aria-label="Account summary">
      <div className="summary-panel-figures">
        <div>
          <span>In these accounts</span>
          <Money value={owned.total} unit={unit} className="summary-figure" />
        </div>
        <div>
          <span>Card balances owed</span>
          <Money value={debt.total} unit={unit} className="summary-figure" />
        </div>
        <div>
          <span>Net of cards</span>
          <Money
            value={subtractMoney(owned.total, debt.total)}
            unit={unit}
            className="summary-figure"
          />
        </div>
      </div>
      <SegmentBar
        label="Holdings by type"
        segments={[
          {
            key: "bitcoin",
            label: "Bitcoin",
            size: size(bitcoin.total),
            color: "var(--accent)",
            display: formatMoney(bitcoin.total, unit),
          },
          {
            key: "dollars",
            label: "Dollar cash",
            size: size(dollars.total),
            color: "var(--blue)",
            display: formatMoney(dollars.total, unit),
          },
          {
            key: "invested",
            label: "Investments",
            size: size(invested.total),
            color: "var(--amethyst)",
            display: formatMoney(invested.total, unit),
          },
        ]}
      />
      {missing > 0 && (
        <p className="hint">{missingNote(missing, "account")}.</p>
      )}
    </section>
  );
}

/** Totals for exactly the rows the journal is showing. */
export function TransactionsSummary({ rows }: { rows: Transaction[] }) {
  const unit = useReportingUnit("USD");
  const total = (kind: string) =>
    sumMoney(
      rows
        .filter((row) => row.kind === kind)
        .map((row) => transactionValue(row, unit)),
    );
  const income = total("income"),
    expenses = total("expense");
  const net = subtractMoney(income.total, expenses.total);
  const transfers = rows.filter((row) => row.kind === "transfer").length;
  const spentShare =
    Number(income.total) > 0
      ? Math.round((Number(expenses.total) / Number(income.total)) * 100)
      : null;
  return (
    <div className="stat-row" aria-label="Totals for the transactions shown">
      <StatTile
        label="Money in"
        tone="good"
        hint={missingNote(income.missing, "entry")}
      >
        {formatMoney(income.total, unit)}
      </StatTile>
      <StatTile label="Money out" hint={missingNote(expenses.missing, "entry")}>
        {formatMoney(expenses.total, unit)}
      </StatTile>
      <StatTile
        label="Net"
        tone={net?.startsWith("-") ? "bad" : undefined}
        hint={
          spentShare === null
            ? "Income minus expenses"
            : `Spent ${spentShare}% of income`
        }
      >
        {formatMoney(net, unit)}
      </StatTile>
      <StatTile
        label="Entries"
        hint={`${transfers} transfer${transfers === 1 ? "" : "s"} between accounts`}
      >
        {rows.length}
      </StatTile>
    </div>
  );
}

/** Long-term assets against long-term debt, and the equity between them. */
export function EquitySummary({ accounts }: { accounts: Account[] }) {
  const unit = useReportingUnit("USD");
  const active = accounts.filter((account) => !account.archived);
  const side = (role: Account["role"]) =>
    sumMoney(
      active
        .filter((account) => account.role === role)
        .map((account) => accountValue(account, unit)),
    );
  const assets = side("asset"),
    debts = side("liability");
  const equity = subtractMoney(assets.total, debts.total);
  const owned = Number(assets.total),
    owed = Number(debts.total);
  if (!active.length) return null;
  const underwater = owed > owned;
  return (
    <section className="panel summary-panel" aria-label="Equity summary">
      <div className="summary-panel-figures">
        <div>
          <span>Asset value</span>
          <Money value={assets.total} unit={unit} className="summary-figure" />
        </div>
        <div>
          <span>Debt owed</span>
          <Money value={debts.total} unit={unit} className="summary-figure" />
        </div>
        <div>
          <span>Equity</span>
          <Money
            value={equity}
            unit={unit}
            className={`summary-figure${underwater ? " negative" : " positive"}`}
          />
        </div>
      </div>
      {owned > 0 || owed > 0 ? (
        <SegmentBar
          label="Asset value split between equity and debt"
          segments={
            underwater
              ? [
                  {
                    key: "debt",
                    label: "Debt exceeds asset value",
                    size: owed,
                    color: "var(--red)",
                    display: formatMoney(debts.total, unit),
                  },
                ]
              : [
                  {
                    key: "equity",
                    label: "Equity you hold",
                    size: owned - owed,
                    color: "var(--green)",
                    display: formatMoney(equity, unit),
                  },
                  {
                    key: "debt",
                    label: "Still owed",
                    size: owed,
                    color: "color-mix(in srgb, var(--red) 75%, var(--surface))",
                    display: formatMoney(debts.total, unit),
                  },
                ]
          }
        />
      ) : null}
      {assets.missing + debts.missing > 0 && (
        <p className="hint">
          {missingNote(assets.missing + debts.missing, "account")}.
        </p>
      )}
    </section>
  );
}
