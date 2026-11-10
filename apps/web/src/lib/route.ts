/** Two screens don't need a router: the address after "#" picks which one shows. */
import { useEffect, useState } from "react";

export const CLAUDE_SETUP = "#/claude";

export function useHash(): string {
  const [hash, setHash] = useState(() => window.location.hash);
  useEffect(() => {
    const update = () => setHash(window.location.hash);
    window.addEventListener("hashchange", update);
    return () => window.removeEventListener("hashchange", update);
  }, []);
  return hash;
}
