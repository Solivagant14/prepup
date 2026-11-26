/**
 * The MCP adapter: how Claude uses PrepUp. The behaviour Claude needs travels
 * with the connector itself (server instructions, tool descriptions and
 * prompts), so anyone who connects gets it without installing anything else.
 * Every tool calls the same core service as the REST API.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  AddTopicInput,
  CreateDeckInput,
  DeleteDeckInput,
  DeleteTopicInput,
  GetTopicInput,
  LinkTopicsInput,
  ListTopicsInput,
  MoveTopicByNameInput,
  RecordReviewInput,
  RenameDeckByNameInput,
  SearchTopicsInput,
  TOPIC_FILTERS,
  type TopicView,
} from "@prepup/contracts";
import {
  buildInstructions,
  DEFAULT_TESTING_STYLE,
  DomainError,
  styleBlock,
  type Actor,
  type PrepUpService,
} from "@prepup/core";
import { z } from "zod";

/**
 * Every tool and prompt, described once. The server registers them from this
 * list and the settings page shows the same list, so what users read is what
 * Claude gets.
 */
export const TOOLS = {
  whoami: {
    title: "Check the PrepUp connection",
    description:
      "Confirms the connection works, counts the user's topics, lists their decks, and returns their current testing style. Call it before the first test in a conversation.",
    readOnly: true,
  },
  add_topic: {
    title: "Add a topic",
    description:
      "Add a term or concept to one of the user's PrepUp decks. When they have more than one deck, pass deck (its name); if they haven't said which, ask. Idempotent: if the deck already has it (even spelled differently), the existing card is returned. Also returns similar topics already in that deck (a plain text match), so you can propose what the new topic builds on. It links nothing itself.",
    readOnly: false,
  },
  list_topics: {
    title: "List topics",
    description:
      "List the user's topics, highest priority first (important, weak, or about to fade), each with its deck and the topics it builds on. Pass deck to list one deck only. With the prep filter, prerequisites come ahead of what builds on them. Use this to choose what to test.",
    readOnly: true,
  },
  get_topic: {
    title: "Read a topic",
    description:
      "Read one topic in full (pass deck if the term is in several decks), including the user's saved explanation, recent test feedback, what it builds on and what it is needed for. During a test, call this only after the user has answered, so you don't prompt them with their own notes.",
    readOnly: true,
  },
  record_review: {
    title: "Record a test result",
    description:
      "Save the result of testing the user on a topic: the score, and optionally the explanation you drafted for their card. Only call after the user has confirmed both. Resets the topic's 14-day fade clock. A score of 5 requires explained: true.",
    readOnly: false,
  },
  search_topics: {
    title: "Search topics",
    description:
      "Find topics by words or part of a term (a plain text match), best match first, across every deck or in one deck. Use it when the deck is too big to list, or to check a topic's score without reading the user's explanation.",
    readOnly: true,
  },
  link_topics: {
    title: "Link a topic to what it builds on",
    description:
      'Record that one topic builds on another: term builds on buildsOnTerm ("RAG" builds on "Embeddings"). Only call after the user has said yes to that link. Both topics must already be in the same deck: links stay inside one deck. A link that would make a loop is refused. Links never change a score or the fade clock. Safe to call twice.',
    readOnly: false,
  },
  unlink_topics: {
    title: "Remove a link",
    description:
      "Remove a \"builds on\" link between two topics: term no longer builds on buildsOnTerm. Only call after the user has confirmed. Both topics stay in the deck, with their scores and history.",
    readOnly: false,
  },
  delete_topic: {
    title: "Delete a topic",
    description:
      "Permanently delete one topic from the user's deck, with its score history, explanation and links. It cannot be undone. Only call after the user has asked to delete this topic and, in chat, you have named it, said it is permanent, and they have said yes; then pass confirmed: true. Never delete on your own initiative. One topic per call.",
    readOnly: false,
  },
  list_decks: {
    title: "List decks",
    description:
      "List the user's decks (named groups of topics, like \"DSA\" or \"System Design\"), oldest first, with how many topics each holds.",
    readOnly: true,
  },
  create_deck: {
    title: "Create a deck",
    description:
      "Create a new, empty deck with the name the user chose. Only call after the user has asked for it or said yes to it in chat. Idempotent: a deck that already exists (even spelled differently) is returned unchanged.",
    readOnly: false,
  },
  rename_deck: {
    title: "Rename a deck",
    description:
      "Rename one of the user's decks. Its topics, scores and history stay as they are. Only call after the user has asked for it or said yes in chat.",
    readOnly: false,
  },
  delete_deck: {
    title: "Delete a deck",
    description:
      "Permanently delete one deck and every topic in it, with their score history, explanations and links. It cannot be undone. Only call after the user has asked to delete this deck and, in chat, you have named it, said how many topics it holds, said it is permanent, and they have said yes; then pass confirmed: true. Never delete on your own initiative.",
    readOnly: false,
  },
  move_topic: {
    title: "Move a topic to another deck",
    description:
      "Move one topic to another of the user's decks. Its score, history and explanation go with it; its \"builds on\" links are removed, because links stay inside one deck. Only call after the user has said yes in chat, and tell them first if it has links. The target deck must already exist and must not already have that term.",
    readOnly: false,
  },
} as const;

export const PROMPTS = {
  test_me: { title: "Test me", description: "Run a short test on your PrepUp topics, in your testing style." },
  quick_capture: { title: "Quick capture", description: "Add one or more terms to PrepUp." },
} as const;

/** What the settings page lists under "What Claude can do". */
export function describeConnector() {
  return {
    tools: Object.entries(TOOLS).map(([name, t]) => ({ name, ...t })),
    prompts: Object.entries(PROMPTS).map(([name, p]) => ({ name, ...p })),
  };
}

const meta = (name: keyof typeof TOOLS) => ({ title: TOOLS[name].title, description: TOOLS[name].description });

const toolResult = (summary: string, data: unknown) => ({
  content: [{ type: "text" as const, text: `${summary}\n\n${JSON.stringify(data, null, 2)}` }],
});

const toolError = (message: string) => ({
  content: [{ type: "text" as const, text: message }],
  isError: true,
});

/** Keeps tool output small: Claude needs these fields, not internal ids for display. */
const brief = (t: TopicView) => ({
  term: t.term,
  deck: t.deck.name,
  score: t.score,
  level: t.level,
  importance: t.importance,
  daysUntilDrop: t.daysUntilDrop,
  fadingSoon: t.fadingSoon,
  lastTestedAt: t.lastTestedAt,
  hasExplanation: t.explanation.length > 0,
  buildsOn: t.buildsOn.map((p) => p.term),
});

const WHO = { you: "the user", claude: "the assistant, from an earlier test" } as const;

async function guard<T>(fn: () => Promise<T>) {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof DomainError) return toolError(err.message);
    // Never leak internals (SQL, ids) to the client; log them here instead.
    console.error(err);
    return toolError("PrepUp hit an unexpected error. Please try again.");
  }
}

/**
 * The user's testing style, or the default if it can't be read. A settings
 * hiccup (say, the table isn't migrated yet) must never stop a test.
 */
export async function testingStyleFor(service: PrepUpService, actor: Actor): Promise<string> {
  try {
    return (await service.getSettings(actor)).testingStyle;
  } catch (err) {
    console.error("Could not read the testing style; using the default", err);
    return DEFAULT_TESTING_STYLE;
  }
}

/**
 * A fresh server for one request, bound to one user. `style` goes into the
 * instructions a client reads when it connects; whoami and the test prompt
 * read the current style themselves, for clients that connected earlier.
 */
export function createMcpServer(service: PrepUpService, actor: Actor, style: string = DEFAULT_TESTING_STYLE): McpServer {
  const server = new McpServer(
    { name: "prepup", title: "PrepUp", version: "0.6.0" },
    { instructions: buildInstructions(style), capabilities: { tools: {}, prompts: {} } },
  );

  server.registerTool(
    "whoami",
    { ...meta("whoami"), annotations: { readOnlyHint: true } },
    async () =>
      guard(async () => {
        const decks = await service.listDecks(actor);
        const topics = decks.reduce((n, d) => n + d.topicCount, 0);
        const style = await testingStyleFor(service, actor);
        return toolResult(`Connected to PrepUp. ${topics} topic(s) in ${decks.length} deck(s).\n\n${styleBlock(style)}`, {
          userId: actor.userId,
          topics,
          decks: decks.map((d) => ({ name: d.name, topics: d.topicCount })),
        });
      }),
  );

  server.registerTool(
    "add_topic",
    {
      ...meta("add_topic"),
      inputSchema: AddTopicInput.omit({ deckId: true }),
      annotations: { idempotentHint: true, destructiveHint: false },
    },
    async (input) =>
      guard(async () => {
        const { topic, created, similar } = await service.addTopic(actor, input);
        const hint = similar.length
          ? " Similar topics are listed below: if it builds on any of them (or on anything else in the deck), ask the user before linking."
          : "";
        return toolResult(
          (created
            ? `Added "${topic.term}" to the deck "${topic.deck.name}".`
            : `"${topic.term}" was already in the deck "${topic.deck.name}"; nothing changed.`) + hint,
          { ...brief(topic), similarTopics: similar.map((s) => s.term) },
        );
      }),
  );

  server.registerTool(
    "list_topics",
    {
      ...meta("list_topics"),
      inputSchema: ListTopicsInput.omit({ deckId: true }),
      annotations: { readOnlyHint: true },
    },
    async (input) =>
      guard(async () => {
        const topics = await service.listTopics(actor, input);
        return toolResult(`${topics.length} topic(s).`, topics.map(brief));
      }),
  );

  server.registerTool(
    "get_topic",
    {
      ...meta("get_topic"),
      inputSchema: GetTopicInput,
      annotations: { readOnlyHint: true },
    },
    async ({ term, deck }) =>
      guard(async () => {
        const topic = await service.findByTerm(actor, term, deck);
        const history = await service.history(actor, topic.id);
        const lastTests = history
          .filter((e) => e.kind === "claude_test")
          .slice(0, 3)
          .map((e) => ({ at: e.createdAt, score: e.score, feedback: e.feedback }));
        return toolResult(`"${topic.term}" (deck "${topic.deck.name}"): ${topic.score}/5 (${topic.level}).`, {
          ...brief(topic),
          explanation: topic.explanation || null,
          explanationWrittenBy: topic.explanationBy ? WHO[topic.explanationBy] : null,
          neededFor: topic.neededFor.map((t) => t.term),
          recentTests: lastTests,
        });
      }),
  );

  server.registerTool(
    "search_topics",
    {
      ...meta("search_topics"),
      inputSchema: SearchTopicsInput,
      annotations: { readOnlyHint: true },
    },
    async (input) =>
      guard(async () => {
        const topics = await service.searchTopics(actor, input);
        return toolResult(`${topics.length} topic(s) match "${input.query}".`, topics.map(brief));
      }),
  );

  server.registerTool(
    "link_topics",
    {
      ...meta("link_topics"),
      inputSchema: LinkTopicsInput,
      annotations: { idempotentHint: true, destructiveHint: false },
    },
    async (input) =>
      guard(async () => {
        const { topic, created, buildsOn } = await service.linkTopicsByTerm(actor, input);
        return toolResult(
          created
            ? `Linked: "${topic.term}" now builds on "${buildsOn.term}".`
            : `"${topic.term}" already builds on "${buildsOn.term}"; nothing changed.`,
          brief(topic),
        );
      }),
  );

  server.registerTool(
    "unlink_topics",
    {
      ...meta("unlink_topics"),
      inputSchema: LinkTopicsInput,
      annotations: { idempotentHint: true, destructiveHint: true },
    },
    async (input) =>
      guard(async () => {
        const { topic, removed, buildsOn } = await service.unlinkTopicsByTerm(actor, input);
        return toolResult(
          removed
            ? `Unlinked: "${topic.term}" no longer builds on "${buildsOn.term}".`
            : `"${topic.term}" wasn't linked to "${buildsOn.term}"; nothing changed.`,
          brief(topic),
        );
      }),
  );

  server.registerTool(
    "delete_topic",
    {
      ...meta("delete_topic"),
      inputSchema: DeleteTopicInput,
      annotations: { destructiveHint: true, idempotentHint: false },
    },
    async (input) =>
      guard(async () => {
        const { term } = await service.deleteTopicByTerm(actor, input);
        return toolResult(`Deleted "${term}" from PrepUp. This can't be undone.`, { term, deleted: true });
      }),
  );

  server.registerTool(
    "list_decks",
    { ...meta("list_decks"), annotations: { readOnlyHint: true } },
    async () =>
      guard(async () => {
        const decks = await service.listDecks(actor);
        return toolResult(
          `${decks.length} deck(s).`,
          decks.map((d) => ({ name: d.name, topics: d.topicCount })),
        );
      }),
  );

  server.registerTool(
    "create_deck",
    {
      ...meta("create_deck"),
      inputSchema: CreateDeckInput,
      annotations: { idempotentHint: true, destructiveHint: false },
    },
    async (input) =>
      guard(async () => {
        const { deck, created } = await service.createDeck(actor, input);
        return toolResult(
          created ? `Created the deck "${deck.name}".` : `The deck "${deck.name}" already exists; nothing changed.`,
          { name: deck.name, topics: deck.topicCount },
        );
      }),
  );

  server.registerTool(
    "rename_deck",
    {
      ...meta("rename_deck"),
      inputSchema: RenameDeckByNameInput,
      annotations: { idempotentHint: true, destructiveHint: false },
    },
    async (input) =>
      guard(async () => {
        const { from, deck } = await service.renameDeckByName(actor, input);
        return toolResult(`Renamed the deck "${from}" to "${deck.name}".`, { name: deck.name, topics: deck.topicCount });
      }),
  );

  server.registerTool(
    "delete_deck",
    {
      ...meta("delete_deck"),
      inputSchema: DeleteDeckInput,
      annotations: { destructiveHint: true, idempotentHint: false },
    },
    async (input) =>
      guard(async () => {
        const { name, topicCount } = await service.deleteDeckByName(actor, input);
        return toolResult(`Deleted the deck "${name}" and its ${topicCount} topic(s). This can't be undone.`, {
          name,
          deletedTopics: topicCount,
        });
      }),
  );

  server.registerTool(
    "move_topic",
    {
      ...meta("move_topic"),
      inputSchema: MoveTopicByNameInput,
      annotations: { idempotentHint: true, destructiveHint: false },
    },
    async (input) =>
      guard(async () => {
        const { topic, from, removedLinks } = await service.moveTopicByName(actor, input);
        if (from.id === topic.deck.id) {
          return toolResult(`"${topic.term}" is already in the deck "${topic.deck.name}"; nothing changed.`, brief(topic));
        }
        const links = removedLinks ? ` Its ${removedLinks} link(s) were removed, because links stay inside one deck.` : "";
        return toolResult(`Moved "${topic.term}" from "${from.name}" to "${topic.deck.name}".${links}`, brief(topic));
      }),
  );

  server.registerTool(
    "record_review",
    {
      ...meta("record_review"),
      inputSchema: RecordReviewInput,
      annotations: { destructiveHint: false, idempotentHint: false },
    },
    async (input) =>
      guard(async () => {
        const topic = await service.recordReview(actor, input);
        const note = input.explanation ? " Their explanation was updated." : "";
        return toolResult(`Saved: "${topic.term}" is now ${topic.score}/5 (${topic.level}).${note}`, brief(topic));
      }),
  );

  server.registerPrompt(
    "test_me",
    {
      ...PROMPTS.test_me,
      argsSchema: {
        focus: z.enum(TOPIC_FILTERS).optional().describe("Which topics: fading_week, prep, confident or all"),
        count: z.string().optional().describe("How many topics, e.g. 5"),
        deck: z.string().optional().describe("Only this deck, by name, e.g. DSA. Leave empty for every deck"),
      },
    },
    async ({ focus, count, deck }) => ({
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: `Test me on ${count ?? "5"} of my PrepUp topics${deck?.trim() ? ` in the deck "${deck.trim()}"` : ""} (filter: ${focus ?? "fading_week"}; if that returns nothing, use "prep", then "all"). Follow PrepUp's fixed rules: one topic at a time, then suggest a score and a draft of my explanation in my own words, wait for my confirmation, then record both.\n\nHow I want to be tested:\n"""\n${await testingStyleFor(service, actor)}\n"""`,
          },
        },
      ],
    }),
  );

  server.registerPrompt(
    "quick_capture",
    {
      ...PROMPTS.quick_capture,
      argsSchema: { terms: z.string().describe("One or more terms, separated by commas") },
    },
    ({ terms }) => ({
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: `Add these to PrepUp, one add_topic call each: ${terms}. If I have more than one deck and haven't said which, ask me first. Then tell me in one line which were new, and ask me before linking any of them to what they build on.`,
          },
        },
      ],
    }),
  );

  return server;
}
