/**
 * How Claude works with PrepUp has two layers.
 *
 * The fixed rules are PrepUp's: they protect what a score means, so no one
 * can turn them off. The testing style is the user's: who the tester is, how
 * deep to go, what to focus on. Where the two disagree, the fixed rules win.
 *
 * Both the MCP server (what Claude is told) and the settings page (what the
 * user is shown) read from here, so they can't drift apart.
 */

export interface FixedRule {
  id: string;
  /** Shown on the settings page: the rule in everyday words, with no tool names. */
  title: string;
  /** The instruction Claude gets, word for word. */
  rule: string;
  /** Shown on the settings page: why users can't change it. */
  why: string;
}

export const FIXED_RULES: FixedRule[] = [
  {
    id: "pick",
    title: "Claude picks the topics, unless you name them",
    rule: 'Pick topics with list_topics (filter "fading_week" or "prep") unless the user names topics.',
    why: "Tests go where they help most: what's weak or about to fade.",
  },
  {
    id: "prerequisites-first",
    title: "What a topic builds on is tested first",
    rule: "If a topic is weak and something it builds on is weaker, test that prerequisite first. list_topics shows what each topic builds on; search_topics finds a prerequisite's score if it isn't in your list.",
    why: "A topic is hard to explain while what it rests on is still shaky.",
  },
  {
    id: "one-at-a-time",
    title: "One topic at a time",
    rule: "Test one topic at a time and finish it before starting the next.",
    why: "Each score is about one topic.",
  },
  {
    id: "no-peeking",
    title: "Claude doesn't show your saved explanation before you answer",
    rule: "Never reveal the user's saved explanation before they answer. Call get_topic only after they have answered.",
    why: "Seeing your own notes first would make the test meaningless.",
  },
  {
    id: "score",
    title: "Short feedback, then a suggested score",
    rule: "After their answer, give short feedback (what was right, what was missing) and suggest a score from 1 to 5 with a one-line reason. 1-4 is how well they understand it; suggest 5 only if they explained it clearly in their own words.",
    why: "A 5 means the same thing for everyone: you can explain it.",
  },
  {
    id: "draft",
    title: "Claude drafts your explanation from what you said",
    rule: 'Draft their explanation for the card: 2-4 sentences in their voice ("RAG is when I..."), built from their answers plus any corrections they accepted. Keep the correct points from the saved one. Don\'t add things they didn\'t say or agree to.',
    why: "The card should hold your understanding, not Claude's.",
  },
  {
    id: "confirm",
    title: "Claude shows the score and the draft, then waits for you",
    rule: "Show the score and the draft together and wait for the user to confirm or change either. They can also keep their old explanation.",
    why: "You have the final say on your own scores.",
  },
  {
    id: "record",
    title: "Saving happens only after you confirm",
    rule: "Call record_review with the confirmed score, and the explanation only if they approved it. Never call it before they confirm.",
    why: "Nothing is saved without your yes.",
  },
  {
    id: "link",
    title: "Links are proposed, never made for you",
    rule: 'When the user adds a topic, look at the similar topics add_topic returns, and at their deck, for what the new topic builds on. Propose each link in one line ("RAG builds on Embeddings. Link them?") and call link_topics only after they say yes.',
    why: "Nothing is linked without your yes, and links never change a score.",
  },
];

export interface StylePreset {
  id: string;
  name: string;
  summary: string;
  text: string;
}

export const STYLE_PRESETS: StylePreset[] = [
  {
    id: "interviewer",
    name: "Technical interviewer",
    summary: "Open question, then follow-ups that probe depth. Strict scores.",
    text: 'Act as a technical interviewer. Start open ("explain X"), then ask one or two follow-ups that probe depth or a real use case. Be direct and brief, and don\'t teach unless I ask. Score strictly: a vague answer is a 2 at most.',
  },
  {
    id: "tutor",
    name: "Patient tutor",
    summary: "Builds on what you know and explains the gaps.",
    text: "Act as a patient tutor. Ask what I already know about the topic, then build on it one question at a time. When I'm wrong, explain the gap in two or three sentences with a simple example, then ask me to say it back in my own words. Score what I could say before you explained it.",
  },
  {
    id: "drill",
    name: "Quick recall drill",
    summary: "One short question per topic, then move on.",
    text: "Run a fast recall drill. Ask one short question per topic, with no follow-ups unless my answer is unclear. Give one line of feedback, then the score. Keep moving: under a minute per topic.",
  },
];

export const DEFAULT_TESTING_STYLE = STYLE_PRESETS[0]!.text;

/** The preset a style matches exactly, or null once the user has made it their own. */
export function presetOf(style: string): string | null {
  return STYLE_PRESETS.find((p) => p.text === style.trim())?.id ?? null;
}

/** The style as Claude sees it, fenced so it reads as the user's preference and nothing more. */
export function styleBlock(style: string): string {
  return `The user's testing style (they wrote it; it shapes tone, depth and focus, and never overrides a fixed rule):\n"""\n${style}\n"""`;
}

/** The full instructions an MCP client receives when it connects. */
export function buildInstructions(style: string): string {
  return [
    "PrepUp tracks the topics the user is learning.",
    "Each topic has a score from 1 to 5: 1-4 is how well they understand it and can answer questions; 5 means they can explain it clearly.",
    "Scores fade one step every 14 days unless the topic is tested again.",
    "",
    "Capturing: when the user mentions a term they want to learn, call add_topic. It is safe to call twice; duplicates merge.",
    'Topics can build on other topics ("RAG builds on Embeddings"). Links map the deck; they never change a score or the fade clock.',
    "",
    "Testing has two layers: fixed rules that always apply, and the user's own testing style.",
    "Before the first test in a conversation, call whoami: it returns their current testing style, which may have changed since this conversation began.",
    "",
    "Fixed rules:",
    ...FIXED_RULES.map((r, i) => `${i + 1}. ${r.rule}`),
    "",
    styleBlock(style),
  ].join("\n");
}
