/**
 * Who is signed in, signing out, and erasing your data: the actions that
 * belong to the person, not to the deck, in one place.
 */
import type { TopicView } from "@prepup/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import type { Api } from "../lib/api.js";
import { signedInLabel, type AccountInfo } from "../lib/account.js";

export function Account({ api, account, onSignOut }: { api: Api; account: AccountInfo | null; onSignOut?: () => void }) {
  return (
    <div className="page setup">
      <div className="setup-head">
        <h1>Account</h1>
      </div>

      <section className="panel" aria-labelledby="who-title">
        <h2 id="who-title">{signedInLabel(account)}</h2>
        <div className="account-row">
          <p className="account-email">{account?.email ?? "No sign-in on this copy: it runs in development mode."}</p>
          {onSignOut && (
            <button type="button" className="btn" onClick={onSignOut}>
              Sign out
            </button>
          )}
        </div>
        {account && (
          <p className="note">Use this same account when you connect Claude, so your tests land in this deck.</p>
        )}
      </section>

      <YourData api={api} />
    </div>
  );
}

function YourData({ api }: { api: Api }) {
  const qc = useQueryClient();
  const topics = useQuery({ queryKey: ["topics"], queryFn: api.listTopics });
  const [asking, setAsking] = useState(false);
  const [erased, setErased] = useState(false);
  const erase = useMutation({
    mutationFn: api.deleteAccount,
    onSuccess: () => {
      setAsking(false);
      setErased(true);
      // Every cached answer described data that no longer exists.
      qc.setQueryData<TopicView[]>(["topics"], []);
      void qc.invalidateQueries();
    },
  });
  const count = topics.data?.length ?? 0;

  return (
    <section className="panel" aria-labelledby="data-title">
      <h2 id="data-title">Your data</h2>
      <p className="panel-lead">
        PrepUp keeps your topics, scores, explanations, test answers and testing style. Only you can see them.
      </p>
      <div className="danger-zone">
        <div>
          <h3>Erase all my data</h3>
          <p>
            Removes everything PrepUp keeps for you, for good. Your sign-in stays, so you can start again with an empty
            deck.
          </p>
        </div>
        <button
          type="button"
          className="btn danger-outline"
          onClick={() => {
            erase.reset();
            setErased(false);
            setAsking(true);
          }}
        >
          Erase all my data
        </button>
      </div>
      <p className="note" role="status">
        {erased ? "Your data was erased. Your deck is empty." : ""}
      </p>
      {asking && (
        <ConfirmErase
          count={count}
          busy={erase.isPending}
          error={erase.isError ? (erase.error as Error).message : null}
          onCancel={() => setAsking(false)}
          onConfirm={() => erase.mutate()}
        />
      )}
    </section>
  );
}

function ConfirmErase({
  count,
  busy,
  error,
  onCancel,
  onConfirm,
}: {
  count: number;
  busy: boolean;
  error: string | null;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (d && !d.open) d.showModal();
  }, []);
  const what = count === 0 ? "your testing style and history" : count === 1 ? "your 1 topic" : `all ${count} topics`;
  return (
    <dialog ref={ref} className="sheet confirm" aria-labelledby="erase-title" onClose={onCancel}>
      <div className="sheet-body">
        <h2 id="erase-title" className="confirm-title">
          Erase all your data?
        </h2>
        <p className="confirm-text">
          This removes {what}, with every score, explanation and test answer. It can't be undone.
        </p>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <div className="row-end">
          {/* Cancel comes first, so Enter and a stray tap land on the safe choice. */}
          <button type="button" className="btn" autoFocus onClick={onCancel} disabled={busy}>
            Cancel
          </button>
          <button type="button" className="btn danger" onClick={onConfirm} disabled={busy}>
            {busy ? "Erasing…" : "Erase everything"}
          </button>
        </div>
      </div>
    </dialog>
  );
}
