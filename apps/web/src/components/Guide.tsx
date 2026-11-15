/**
 * The guide: a contents list beside (or, on a phone, above) one page at a
 * time, with links to the pages before and after. Open to anyone, signed in
 * or not, and every page has its own address.
 */
import { useEffect } from "react";
import type { HostLinkTargets } from "../lib/api.js";
import { GUIDE, GUIDE_GROUPS, guidePageFor, guidePath, neighbours, type GuidePage } from "../lib/guide.js";
import { navigate, PATHS, usePath } from "../lib/route.js";
import { PAGES } from "./guide/pages.js";
import { Link } from "./Link.js";

function Contents({ current }: { current: GuidePage }) {
  return (
    <nav aria-label="Guide contents">
      {GUIDE_GROUPS.map((group) => (
        <div key={group} className="guide-group-list">
          <p>{group}</p>
          <ul>
            {GUIDE.filter((p) => p.group === group).map((p) => (
              <li key={p.slug}>
                <Link to={guidePath(p.slug)} aria-current={p.slug === current.slug ? "page" : undefined}>
                  {p.title}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </nav>
  );
}

export function Guide({ links }: { links: HostLinkTargets }) {
  const page = guidePageFor(usePath());
  // A guide address that doesn't exist opens the guide's first page.
  useEffect(() => {
    if (!page) navigate(PATHS.guide, { replace: true });
  }, [page]);
  useEffect(() => {
    if (page) document.title = `${page.title} · PrepUp guide`;
  }, [page]);
  if (!page) return null;

  const { prev, next } = neighbours(page.slug);
  const Body = PAGES[page.slug]!;
  return (
    <div className="page guide">
      {/* On a phone the contents fold into one row; a new key closes it again after each move. */}
      <details className="guide-toc" key={page.slug}>
        <summary>
          <span className="guide-toc-label">Guide</span>
          <span className="guide-toc-title">{page.title}</span>
        </summary>
        <Contents current={page} />
      </details>
      <aside className="guide-side">
        <Contents current={page} />
      </aside>

      <article className="guide-body">
        <p className="guide-group">{page.group}</p>
        <h1>{page.title}</h1>
        <Body links={links} />

        <nav className="guide-next" aria-label="Previous and next page">
          {prev ? (
            <Link to={guidePath(prev.slug)} className="guide-step">
              <span>Previous</span>
              {prev.title}
            </Link>
          ) : (
            <span />
          )}
          {next && (
            <Link to={guidePath(next.slug)} className="guide-step forward">
              <span>Next</span>
              {next.title}
            </Link>
          )}
        </nav>
      </article>
    </div>
  );
}
