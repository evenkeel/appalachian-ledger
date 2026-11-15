import { Fragment, useEffect, useState } from "react";
import { api } from "../lib/api";
import {
  accountStatement,
  activityTitle,
  activityDetail,
  type AccountActivityData,
} from "../lib/accountActivity";
import { Money } from "./Money";
import { Button } from "./ui/button";
export type { AccountActivityData } from "../lib/accountActivity";

const amountClass = (minor: string) => {
  const amount = BigInt(minor);
  return amount > 0n ? "account-money-in" : amount < 0n ? "account-money-out" : "";
};

const dateLabel = (date: string) =>
  new Date(`${date}T12:00:00`).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
export function AccountActivity({
  accountId,
  revision,
}: {
  accountId: number;
  revision: number;
}) {
  const [data, setData] = useState<AccountActivityData | null>(null);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let alive = true;
    setData(null);
    setError("");
    api<AccountActivityData>(`/accounts/${accountId}/activity`)
      .then((result) => {
        if (alive) setData(result);
      })
      .catch((e: Error) => {
        if (alive) setError(e.message);
      });
    return () => {
      alive = false;
    };
  }, [accountId, revision, retry]);
  const statement = data ? accountStatement(data) : null;
  return (
    <section className="account-activity" aria-label="Account activity">
      <div className="account-activity-heading">
        <h3>Activity</h3>
        {data && (
          <div className="account-activity-balance">
            <span>
              {data.role === "liability" ? "Balance owed" : "Current balance"}
            </span>
            <strong>
              <Money value={data.balance} unit={data.currency} />
            </strong>
          </div>
        )}
      </div>
      {error ? (
        <div className="alert error" role="alert">
          {error}{" "}
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setRetry((n) => n + 1)}
          >
            Retry activity
          </Button>
        </div>
      ) : !data || !statement ? (
        <p className="empty-inline" role="status">
          Loading account activity…
        </p>
      ) : (
        <>
          {!statement.rows.length ? (
            <p className="empty-inline">No posted activity for this account.</p>
          ) : (
            <div className="table-scroll account-activity-scroll">
              <table aria-label="Account balance changes">
                <thead>
                  <tr>
                    <th>Transaction</th>
                    <th className="numeric">
                      {data.role === "liability" ? "Debt change" : "Amount"}
                    </th>
                    <th className="numeric">Balance</th>
                  </tr>
                </thead>
                <tbody>
                  {statement.rows.map((row, index) => (
                    <Fragment key={row.id}>
                      {(index === 0 ||
                        statement.rows[index - 1].date !== row.date) && (
                        <tr className="account-activity-date">
                          <th colSpan={3} scope="rowgroup">
                            <time dateTime={row.date}>
                              {dateLabel(row.date)}
                            </time>
                          </th>
                        </tr>
                      )}
                      <tr>
                        <td>
                          <strong>{activityTitle(row, data.role)}</strong>
                          {activityDetail(row) &&
                            activityDetail(row) !==
                              activityTitle(row, data.role) && (
                              <small>{activityDetail(row)}</small>
                            )}
                          {row.notes && (
                            <details className="account-entry-note">
                              <summary>Note</summary>
                              <p>{row.notes}</p>
                            </details>
                          )}
                        </td>
                        <td
                          className={`numeric nowrap ${amountClass(row.change_minor)}`}
                        >
                          {BigInt(row.change_minor) > 0n ? "+" : ""}
                          <Money value={row.change} unit={data.currency} />
                        </td>
                        <td className="numeric nowrap account-running-balance">
                          <Money value={row.balance} unit={data.currency} />
                        </td>
                      </tr>
                    </Fragment>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {!!statement.corrections.length && (
            <details className="account-corrections">
              <summary>
                Corrections & reversals ({statement.corrections.length})
              </summary>
              <p className="hint">
                Cancelled entries and their reversals offset each other. They
                are kept here for reference.
              </p>
              <div className="table-scroll">
                <table aria-label="Corrections and reversals">
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Recorded entry</th>
                      <th className="numeric">Change</th>
                    </tr>
                  </thead>
                  <tbody>
                    {statement.corrections.map((row) => (
                      <tr key={row.id}>
                        <td className="nowrap">{dateLabel(row.date)}</td>
                        <td>
                          {row.description}
                          <small>
                            {row.reverses_id !== null
                              ? `Cancels entry #${row.reverses_id}`
                              : `Cancelled entry #${row.id}`}
                          </small>
                        </td>
                        <td className={`numeric nowrap ${amountClass(row.change_minor)}`}>
                          {BigInt(row.change_minor) > 0n ? "+" : ""}
                          <Money value={row.change} unit={data.currency} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>
          )}
        </>
      )}
    </section>
  );
}
