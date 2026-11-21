import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { api } from "../../lib/api";
import { Panel } from "../dashboard/panels";
import type { Route } from "../lib/router";
import { Note, Switch } from "./controls";
import type { NoteText } from "./controls";
import { SPECS, check, sortServerErrors, toDraft, toPayload } from "./thresholds";
import type { Draft, LightId, Thresholds } from "./thresholds";

/** When each alert light comes on. One save for the whole set; a refused set changes nothing. */
export function AlertLights({ go, onChanged }: { go: (route: Route) => void; onChanged: () => void }) {
  const [saved, setSaved] = useState<Draft | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [loadError, setLoadError] = useState("");
  const [errors, setErrors] = useState<Partial<Record<LightId, string>>>({});
  const [note, setNote] = useState<NoteText | null>(null);
  const [busy, setBusy] = useState(false);
  const [resetting, setResetting] = useState(false);

  useEffect(() => {
    let alive = true;
    api<Thresholds>("/settings/alert-thresholds")
      .then((result) => {
        if (!alive) return;
        setSaved(toDraft(result));
        setDraft(toDraft(result));
      })
      .catch((e: Error) => alive && setLoadError(e.message));
    return () => {
      alive = false;
    };
  }, []);

  async function send(body: Thresholds | Record<string, never>, done: string) {
    setBusy(true);
    setNote(null);
    try {
      const result = toDraft(await api<Thresholds>("/settings/alert-thresholds", "PUT", body));
      setSaved(result);
      setDraft(result);
      setErrors({});
      setNote({ kind: "ok", text: done });
      onChanged();
    } catch (e) {
      const { rows, rest } = sortServerErrors((e as Error).message);
      setErrors(rows);
      setNote({ kind: "error", text: rest || "Nothing was saved. See the marked lights." });
    } finally {
      setBusy(false);
      setResetting(false);
    }
  }

  function save(event: FormEvent) {
    event.preventDefault();
    if (!draft) return;
    const found: Partial<Record<LightId, string>> = {};
    for (const spec of SPECS) {
      const problem = check(spec, draft[spec.id].values);
      if (problem) found[spec.id] = problem;
    }
    setErrors(found);
    if (Object.keys(found).length) {
      setNote({ kind: "error", text: "Nothing was saved. Fix the marked lights first." });
      return;
    }
    void send(toPayload(draft), "Alert settings saved.");
  }

  if (!draft)
    return (
      <Panel className="c7" name="Alert lights" plain="when each one comes on" inop={!loadError}>
        {loadError ? (
          <p className="set-note error" role="alert">
            {loadError}
          </p>
        ) : (
          <div className="sub" aria-busy="true">
            Reading your alert settings…
          </div>
        )}
      </Panel>
    );

  const dirty = JSON.stringify(draft) !== JSON.stringify(saved);
  const edit = (id: LightId, change: Partial<Draft[LightId]>) => {
    setDraft({ ...draft, [id]: { ...draft[id], ...change } });
    setNote(null);
  };

  return (
    <Panel className="c7" name="Alert lights" plain="when each one comes on">
      <form onSubmit={save} noValidate>
        <ul className="set-rules">
          {SPECS.map((spec) => {
            const rule = draft[spec.id];
            const problem = errors[spec.id];
            return (
              <li key={spec.id} className={`set-rule${rule.on ? "" : " off"}`}>
                <Switch checked={rule.on} label={`${spec.name} light`} onChange={(on) => edit(spec.id, { on })} />
                <div className="set-rule-name">
                  <b>{spec.name}</b>
                  <span className="hint">{rule.on ? spec.when : "Switched off. This light stays dark."}</span>
                </div>
                <div className="set-fields">
                  {spec.fields.map((field) => (
                    <label key={field.key} className="set-num">
                      <span>{field.label}</span>
                      <input
                        className="num"
                        inputMode="numeric"
                        autoComplete="off"
                        aria-label={`${spec.name}: ${field.label} (${field.unit})`}
                        aria-invalid={problem ? true : undefined}
                        aria-describedby={problem ? `set-problem-${spec.id}` : undefined}
                        value={rule.values[field.key]}
                        onChange={(event) => edit(spec.id, { values: { ...rule.values, [field.key]: event.target.value } })}
                      />
                      <span>{field.unit}</span>
                    </label>
                  ))}
                </div>
                {problem && (
                  <p className="set-rule-error" id={`set-problem-${spec.id}`} role="alert">
                    {problem}
                  </p>
                )}
              </li>
            );
          })}
        </ul>
        <div className="set-actions">
          <button className="btn primary" disabled={busy || !dirty}>
            Save alert settings
          </button>
          {resetting ? (
            <>
              <span className="sub">Put every light back to its default and save?</span>
              <button type="button" className="btn" disabled={busy} onClick={() => void send({}, "Defaults restored and saved.")}>
                Yes, reset
              </button>
              <button type="button" className="btn ghost" disabled={busy} onClick={() => setResetting(false)}>
                Keep mine
              </button>
            </>
          ) : (
            <button type="button" className="btn ghost" disabled={busy} onClick={() => setResetting(true)}>
              Reset to defaults
            </button>
          )}
          {dirty && !note && <span className="hint">Unsaved changes</span>}
        </div>
        <Note note={note} />
      </form>
      <p className="hint set-foot">
        Card due and Credit use need each card's due day and limit.{" "}
        <button type="button" className="inst-link" onClick={() => go("accounts")}>
          Accounts →
        </button>
      </p>
    </Panel>
  );
}
