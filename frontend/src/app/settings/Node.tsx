import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { api } from "../../lib/api";
import { Panel } from "../dashboard/panels";
import { btc } from "../lib/format";
import { Note, moment, useAction } from "./controls";
import type { Lists } from "./controls";
import { Private } from "../lib/privacy";

interface Status {
  connected: boolean;
  message?: string;
  chain?: string;
  blocks?: number;
  headers?: number;
  initial_block_download?: boolean;
}
interface Wallet {
  id: number;
  account_id: number;
  wallet: string;
  last_checked: string | null;
}
interface Comparison {
  wallet: string;
  balance_bitcoin: string;
  pending_bitcoin: string;
  ledger_balance: string;
  difference: string;
  checked_at: string;
}

/** Compare a wallet in the ledger with a watch-only wallet on your own Bitcoin Core node. Read only. */
export function Node({ lists }: { lists: Lists | null }) {
  const action = useAction();
  const [status, setStatus] = useState<Status | null>(null);
  const [wallets, setWallets] = useState<Wallet[]>([]);
  const [comparison, setComparison] = useState<Comparison | null>(null);
  const configured = lists?.nodeConfigured ?? false;

  useEffect(() => {
    if (!configured) return;
    let alive = true;
    api<Wallet[]>("/node/wallets")
      .then((rows) => alive && setWallets(rows))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [configured]);

  if (!configured)
    return (
      <Panel name="Your own node" plain="optional, read only" inop>
        <div className="sub">
          {lists
            ? "No Bitcoin Core node is set up on this server. The ledger works fully without one."
            : "Checking whether a node is set up…"}
        </div>
        <div className="hint">
          To compare a wallet here with a watch-only wallet on your node, set <code>BITCOIN_RPC_HOST</code>, <code>PORT</code>, <code>USER</code> and <code>PASSWORD</code> in the server's environment. They never enter
          this browser or the database.
        </div>
      </Panel>
    );

  const bitcoinAccounts = (lists?.accounts ?? []).filter((account) => account.currency === "BITCOIN" && account.role === "asset");
  const check = () =>
    void action.run(async () => {
      setStatus(await api<Status>("/node/status"));
    });
  function connect(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    void action.run(async () => {
      if (!data.get("account_id")) throw new Error("Choose the bitcoin account this wallet belongs to.");
      await api("/node/wallets", "POST", { account_id: Number(data.get("account_id")), wallet: String(data.get("wallet")).trim() });
      setWallets(await api<Wallet[]>("/node/wallets"));
      form.reset();
      return "Watch-only wallet connected.";
    });
  }
  const compare = (wallet: Wallet) =>
    void action.run(async () => {
      const result = await api<Omit<Comparison, "wallet">>(`/node/wallets/${wallet.id}/reconcile`);
      setComparison({ ...result, wallet: wallet.wallet });
    });

  return (
    <Panel name="Your own node" plain="optional, read only">
      <div className="set-actions">
        <button type="button" className="btn sm" disabled={action.busy} onClick={check}>
          Check connection
        </button>
        {status && (
          <span className="sub" role="status">
            {status.connected
              ? `${status.chain} · block ${status.blocks?.toLocaleString("en-US")} of ${status.headers?.toLocaleString("en-US")} · ${status.initial_block_download ? "still syncing" : "in sync"}`
              : status.message}
          </span>
        )}
      </div>
      {wallets.length > 0 && (
        <ul className="set-list">
          {wallets.map((wallet) => (
            <li key={wallet.id}>
              <span className="set-clip">
                <b>{wallet.wallet}</b>
                <small>
                  {lists?.accounts.find((account) => account.id === wallet.account_id)?.name ?? "Closed account"}
                  {wallet.last_checked ? ` · compared ${moment(wallet.last_checked)}` : " · never compared"}
                </small>
              </span>
              <button type="button" className="btn sm" disabled={action.busy} onClick={() => compare(wallet)} aria-label={`Compare ${wallet.wallet} with the ledger`}>
                Compare
              </button>
            </li>
          ))}
        </ul>
      )}
      {comparison && (
        <dl className="kv set-kv" aria-label={`${comparison.wallet} compared with the ledger`}>
          <div>
            <span>On the node</span>
            <b className="btc"><Private>{btc(comparison.balance_bitcoin)}</Private></b>
          </div>
          <div>
            <span>In the ledger</span>
            <b className="btc"><Private>{btc(comparison.ledger_balance)}</Private></b>
          </div>
          <div>
            <span>Difference</span>
            <b><Private>{btc(comparison.difference)}</Private></b>
          </div>
          <div>
            <span>Unconfirmed</span>
            <b><Private>{btc(comparison.pending_bitcoin)}</Private></b>
          </div>
        </dl>
      )}
      <form className="set-form" onSubmit={connect}>
        <div className="set-pair">
          <label className="field">
            <span>Bitcoin account</span>
            <select name="account_id" defaultValue="">
              <option value="">Choose an account</option>
              {bitcoinAccounts.map((account) => (
                <option key={account.id} value={account.id}>
                  {account.name}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Watch-only wallet name</span>
            <input name="wallet" required maxLength={120} placeholder="ledger-watch" />
          </label>
        </div>
        <div className="hint">Only wallets with private keys disabled are accepted. Nothing is recorded automatically: a difference is yours to look into and enter in Transactions.</div>
        <div className="set-actions">
          <button className="btn" disabled={action.busy}>
            Connect wallet
          </button>
        </div>
      </form>
      <Note note={action.note} />
    </Panel>
  );
}
