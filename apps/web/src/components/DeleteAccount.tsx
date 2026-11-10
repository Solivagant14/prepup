/** "Delete my data": a quiet link at the foot of the page, with a confirm step before anything is removed. */
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import type { Api } from "../lib/api.js";

export function DeleteAccount({ api, topicCount, onDeleted }: { api: Api; topicCount: number; onDeleted?: () => void }) {
  const qc = useQueryClient();
  const [confirming, setConfirming] = useState(false);
  const remove = useMutation({
    mutationFn: api.deleteAccount,
    onSuccess: () => {
      setConfirming(false);
      void qc.resetQueries();
      onDeleted?.();
    },
  });

  if (!confirming) {
    return (
      <footer className="page-foot">
        <button type="button" className="link-btn delete-link" onClick={() => setConfirming(true)}>
          Delete my data
        </button>
      </footer>
    );
  }
  return (
    <footer className="page-foot">
      <div
        className="confirm-delete"
        role="group"
        aria-label="Confirm deleting your data"
        ref={(el) => el?.scrollIntoView({ block: "nearest" })}
      >
        <span>
          Delete {topicCount === 1 ? "your 1 topic" : `all ${topicCount} topics`}, with every score, explanation and test
          history? This can't be undone.
        </span>
        {remove.isError && <span className="error">{(remove.error as Error).message}</span>}
        <div className="row-end">
          <button type="button" className="btn" onClick={() => setConfirming(false)} disabled={remove.isPending}>
            Cancel
          </button>
          <button type="button" className="btn danger" onClick={() => remove.mutate()} disabled={remove.isPending}>
            {remove.isPending ? "Deleting…" : "Delete everything"}
          </button>
        </div>
      </div>
    </footer>
  );
}
