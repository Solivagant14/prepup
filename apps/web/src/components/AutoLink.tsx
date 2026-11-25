/**
 * The "automatic linking" switch: whether the user's assistant may link new
 * topics to what they build on without asking first. Off until they turn it on.
 */
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { Api, TestingSetup } from "../lib/api.js";

export function AutoLink({ api, on }: { api: Api; on: boolean }) {
  const qc = useQueryClient();
  const save = useMutation({
    mutationFn: (autoLink: boolean) => api.saveSettings({ autoLink }),
    onSuccess: (settings) => {
      qc.setQueryData<TestingSetup>(["testing-setup"], (old) => (old ? { ...old, settings } : old));
    },
  });
  const checked = save.isPending ? Boolean(save.variables) : on;

  return (
    <section className="panel" aria-labelledby="autolink-title">
      <h2 id="autolink-title">Build my graph automatically</h2>
      <label className="switch-row">
        <input
          type="checkbox"
          role="switch"
          checked={checked}
          disabled={save.isPending}
          onChange={(e) => save.mutate(e.target.checked)}
        />
        <span>
          <strong>Let my assistant link new topics without asking</strong>
          <span className="note">
            When you add a topic through your assistant, it links it straight away to what it builds on among the
            topics already in that deck, then tells you what it linked. Topics you add here get linked the next time you
            talk to it. It never adds topics, and you can remove any link from the card. When this is off, it asks first.
          </span>
        </span>
      </label>
      {save.isError && (
        <p className="error" role="alert">
          {(save.error as Error).message}
        </p>
      )}
    </section>
  );
}
