/**
 * The public costs page: what this copy of PrepUp costs to run, how much room
 * it has left, and the limits each person gets. Open to anyone, signed in or not.
 */
import { useQuery } from "@tanstack/react-query";
import type { HostStatusView } from "@prepup/contracts";
import { loadHostStatus } from "../lib/api.js";
import { databaseRoom, formatUsd, plural, supportLabel } from "../lib/costs.js";
import { HostLinks } from "./HostLinks.js";

export function Costs() {
  const status = useQuery({ queryKey: ["host-status"], queryFn: loadHostStatus });

  return (
    <div className="page setup">
      <header className="topbar">
        <a className="brand" href="#/">
          PrepUp
        </a>
        <div className="topbar-right">
          <a className="link-btn" href="#/">
            Back to PrepUp
          </a>
        </div>
      </header>

      <div className="setup-head">
        <h1>What PrepUp costs</h1>
        <p>PrepUp is free to use. This page shows what this copy costs to run and how much room it has left.</p>
      </div>

      {status.isLoading ? (
        <p className="muted">Loading…</p>
      ) : status.isError || !status.data ? (
        <p className="error">{(status.error as Error | null)?.message ?? "Could not load this page"}</p>
      ) : (
        <>
          <Running status={status.data} />
          <Room status={status.data} />
          <Limits status={status.data} />
          <section className="panel" aria-labelledby="own-title">
            <h2 id="own-title">Run your own</h2>
            <p className="panel-lead">
              PrepUp is open source under the MIT license. A copy of your own fits on free hosting plans, and your data
              stays in your own database.
            </p>
          </section>
          <HostLinks links={status.data} showCosts={false} />
        </>
      )}
    </div>
  );
}

function Running({ status }: { status: HostStatusView }) {
  const free = status.monthlyCostUsd === 0;
  return (
    <section className="panel" aria-labelledby="running-title">
      <h2 id="running-title">Running costs</h2>
      <div className="cost-row">
        <div>
          <div className="tracker-big">{formatUsd(status.monthlyCostUsd)}</div>
          <div className="tracker-label">a month for hosting</div>
        </div>
        <p className="cost-note">
          {free
            ? "This copy runs on free hosting plans."
            : "Paid by the person who runs this copy. Nobody is charged for using it."}{" "}
          There is no AI bill: tests run in your own Claude app, on your own plan.
        </p>
      </div>
      {status.supportUrl && (
        <div className="cost-support">
          <span>
            {free
              ? "If PrepUp helps you, you can help it move to paid hosting when it outgrows the free plans."
              : "If PrepUp helps you, you can help cover the hosting."}
          </span>
          <a className="btn primary" href={status.supportUrl} target="_blank" rel="noreferrer">
            {supportLabel(status.supportUrl)}
          </a>
        </div>
      )}
    </section>
  );
}

function Room({ status }: { status: HostStatusView }) {
  const room = databaseRoom(status);
  return (
    <section className="panel" aria-labelledby="room-title">
      <h2 id="room-title">Room left</h2>
      {room && (
        <div className="room">
          <div className="room-line">
            <span>Database</span>
            <span className="mono">
              {room.usedLabel} of {room.limitLabel}
            </span>
          </div>
          <div
            className={`room-bar${room.nearlyFull ? " full" : ""}`}
            role="img"
            aria-label={`Database ${room.percent}% full`}
          >
            <span style={{ width: `${Math.max(room.percent, 1)}%` }} />
          </div>
          <p className="note">
            {room.nearlyFull
              ? "Nearly full. This copy needs a bigger plan soon."
              : "The database is the first limit a free plan reaches. Totals only: nobody's topics are shown here."}
          </p>
        </div>
      )}
      <div className="tracker-stats">
        <div>
          <div className="stat-num">{status.usage.people.toLocaleString("en-US")}</div>
          <div className="stat-label">{status.usage.people === 1 ? "person learning" : "people learning"}</div>
        </div>
        <div>
          <div className="stat-num">{status.usage.topics.toLocaleString("en-US")}</div>
          <div className="stat-label">{status.usage.topics === 1 ? "topic tracked" : "topics tracked"}</div>
        </div>
      </div>
    </section>
  );
}

function Limits({ status }: { status: HostStatusView }) {
  const { topicsPerPerson, requestsPerMinute, requestsPerDay } = status.limits;
  return (
    <section className="panel" aria-labelledby="limits-title">
      <h2 id="limits-title">Limits for each person</h2>
      <p className="panel-lead">The host is shared, so these keep one account from crowding out the rest.</p>
      <ul className="steps">
        <li>
          <strong>{plural(topicsPerPerson, "topic", "topics")}</strong> in a deck.
        </li>
        {requestsPerMinute !== null && requestsPerDay !== null && (
          <li>
            <strong>{plural(requestsPerMinute, "request", "requests")} a minute</strong> and{" "}
            <strong>{requestsPerDay.toLocaleString("en-US")} a day</strong>, counting the web app and Claude together.
            A normal test session uses a few dozen.
          </li>
        )}
      </ul>
    </section>
  );
}
