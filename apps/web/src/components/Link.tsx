/** A link to another PrepUp screen. A real <a>, so it can be opened in a new tab; a plain click switches screens in place. */
import type { AnchorHTMLAttributes, MouseEvent } from "react";
import { navigate } from "../lib/route.js";

export function Link({ to, onClick, ...rest }: { to: string } & Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "href">) {
  const go = (e: MouseEvent<HTMLAnchorElement>) => {
    onClick?.(e);
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    navigate(to);
  };
  return <a href={to} onClick={go} {...rest} />;
}
