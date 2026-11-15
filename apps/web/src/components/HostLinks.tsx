/** The quiet links at the foot of a screen: what this copy costs, its code, and how to chip in. */
import type { HostLinkTargets } from "../lib/api.js";
import { supportLabel } from "../lib/costs.js";
import { PATHS } from "../lib/route.js";
import { Link } from "./Link.js";

export function HostLinks({
  links,
  showCosts = true,
  showGuide = false,
}: {
  links: HostLinkTargets;
  showCosts?: boolean;
  /** For screens with no tab bar to reach the guide from. */
  showGuide?: boolean;
}) {
  return (
    <nav className="host-links" aria-label="About this copy of PrepUp">
      {showGuide && (
        <Link className="link-btn" to={PATHS.guide}>
          How it works
        </Link>
      )}
      {showCosts && (
        <Link className="link-btn" to={PATHS.costs}>
          Costs
        </Link>
      )}
      <a className="link-btn" href={links.sourceUrl} target="_blank" rel="noreferrer">
        Source
      </a>
      {links.supportUrl && (
        <a className="link-btn" href={links.supportUrl} target="_blank" rel="noreferrer">
          {supportLabel(links.supportUrl)}
        </a>
      )}
    </nav>
  );
}
