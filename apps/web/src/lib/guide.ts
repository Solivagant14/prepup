/**
 * The guide's table of contents: which pages exist, in what order, and under
 * which heading. The pages themselves are in components/guide.
 */

export type GuideGroup = "Get started" | "Using PrepUp" | "Help";

export interface GuidePage {
  slug: string;
  title: string;
  group: GuideGroup;
  /** One line for the contents list on the guide's first page. */
  summary: string;
}

export const GUIDE: GuidePage[] = [
  { slug: "how-it-works", title: "How PrepUp works", group: "Get started", summary: "What PrepUp is, and what your AI assistant has to do with it." },
  { slug: "connect", title: "Connect your assistant", group: "Get started", summary: "Steps for Claude, ChatGPT, Cursor, VS Code or any other MCP app." },
  { slug: "first-test", title: "Your first test", group: "Get started", summary: "What to say, what happens, and what gets saved." },
  { slug: "scores", title: "Scores and fading", group: "Using PrepUp", summary: "What 1 to 5 mean, and why a score drops when you leave it alone." },
  { slug: "decks", title: "Decks", group: "Using PrepUp", summary: "Group topics by subject, like DSA or System Design." },
  { slug: "links", title: "Linking topics", group: "Using PrepUp", summary: "Topics that build on each other, and the graph view." },
  { slug: "assistant", title: "What your assistant does", group: "Using PrepUp", summary: "What it can read or change, and what never happens without your yes." },
  { slug: "troubleshooting", title: "Troubleshooting", group: "Help", summary: "It won't connect, the deck is empty, the testing style is ignored." },
  { slug: "data", title: "Your data and costs", group: "Help", summary: "What is stored, how to erase it, and who pays." },
];

export const GUIDE_GROUPS: GuideGroup[] = ["Get started", "Using PrepUp", "Help"];

export const guidePath = (slug: string) => `/guide/${slug}`;

/** The page an address shows: the first page for /guide itself, null for a page that doesn't exist. */
export function guidePageFor(pathname: string): GuidePage | null {
  const path = pathname.replace(/\/+$/, "");
  if (path === "/guide") return GUIDE[0]!;
  const slug = path.startsWith("/guide/") ? path.slice("/guide/".length) : null;
  return GUIDE.find((p) => p.slug === slug) ?? null;
}

/** The pages before and after one, for the links at the foot of each page. */
export function neighbours(slug: string): { prev: GuidePage | null; next: GuidePage | null } {
  const i = GUIDE.findIndex((p) => p.slug === slug);
  return { prev: i > 0 ? GUIDE[i - 1]! : null, next: i >= 0 && i < GUIDE.length - 1 ? GUIDE[i + 1]! : null };
}

/** The AI apps the connect page has steps for. Only the ones marked tested have been tried against PrepUp. */
export const APPS = [
  { id: "claude", name: "Claude", tested: true },
  { id: "chatgpt", name: "ChatGPT", tested: false },
  { id: "cursor", name: "Cursor", tested: false },
  { id: "vscode", name: "VS Code", tested: false },
  { id: "other", name: "Another app", tested: false },
] as const;

export type AppId = (typeof APPS)[number]["id"];

/** The app a link asks for (`?app=cursor`), or the first one when it names none we know. */
export function appFor(search: string): AppId {
  const asked = new URLSearchParams(search).get("app");
  return APPS.find((a) => a.id === asked)?.id ?? APPS[0].id;
}

/** What to paste into Cursor's settings file to add PrepUp. */
export function cursorConfig(url: string): string {
  return JSON.stringify({ mcpServers: { prepup: { url } } }, null, 2);
}

/** Things to say to an assistant once it's connected. */
export const PHRASES = {
  check: "Check my PrepUp connection",
  test: "Test me on my PrepUp topics",
  testOne: "Use PrepUp to test me on RAG",
  fading: "Test me on what's fading this week",
  add: "Add vector databases to PrepUp",
  link: "What does RAG build on? Link them in PrepUp",
  deck: "Make a DSA deck in PrepUp and add Arrays and Strings to it",
  testDeck: "Test me on my DSA deck",
} as const;
