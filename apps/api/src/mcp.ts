/**
 * The MCP adapter: how Claude uses PrepUp. The behaviour Claude needs travels
 * with the connector itself (server instructions, tool descriptions and
 * prompts), so anyone who connects gets it without installing anything else.
 * Every tool calls the same core service as the REST API.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  AddTopicInput,
  GetTopicInput,
  ListTopicsInput,
  RecordReviewInput,
  TOPIC_FILTERS,
  type TopicView,
} from "@prepup/contracts";
import { DomainError, type Actor, type PrepUpService } from "@prepup/core";
import { z } from "zod";

export const SERVER_INSTRUCTIONS = `PrepUp tracks the AI buzzwords the user is preparing for Forward Deployed Engineer interviews.
Each topic has a score from 1 to 5: 1-4 is how well they understand it and can answer questions; 5 means they can explain it clearly.
Scores fade one step every 14 days unless the topic is tested again.

Capturing: when the user mentions a term they want to learn, call add_topic. It is safe to call twice; duplicates merge.

Testing:
1. Pick topics with list_topics (use filter "fading_week" or "prep" unless the user names topics).
2. Ask about one topic at a time, like an interviewer: start open ("explain X"), then one or two follow-ups that probe depth or a real use case.
3. Give short feedback: what was right, what was missing. Suggest a score with a one-line reason. Only suggest 5 if they explained it clearly in their own words.
4. Draft their explanation for the card: call get_topic to read the one they saved (only now, after they answered), then write 2-4 sentences in their voice ("RAG is when I..."), built from their answers plus any corrections they accepted. Keep the correct points from the saved one. Don't add things they didn't say or agree to.
5. Show the score and the draft together and ask them to confirm, or change either. They can also say to keep their old explanation.
6. Call record_review with the confirmed score, and the explanation only if they approved it. Never call it before they confirm. Then move to the next topic.
Keep feedback short and specific. Never reveal the user's saved explanation before they answer.`;

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
  score: t.score,
  level: t.level,
  importance: t.importance,
  daysUntilDrop: t.daysUntilDrop,
  fadingSoon: t.fadingSoon,
  lastTestedAt: t.lastTestedAt,
  hasExplanation: t.explanation.length > 0,
});

const WHO = { you: "the user", claude: "Claude, from an earlier test" } as const;

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

export function createMcpServer(service: PrepUpService, actor: Actor): McpServer {
  const server = new McpServer(
    { name: "prepup", title: "PrepUp", version: "0.2.0" },
    { instructions: SERVER_INSTRUCTIONS, capabilities: { tools: {}, prompts: {} } },
  );

  server.registerTool(
    "whoami",
    {
      title: "Check the PrepUp connection",
      description: "Confirms the connection works and shows how many topics the signed-in user has.",
      annotations: { readOnlyHint: true },
    },
    async () =>
      guard(async () => {
        const topics = await service.listTopics(actor, { filter: "all", limit: 500 });
        return toolResult(`Connected to PrepUp. ${topics.length} topic(s) in your deck.`, {
          userId: actor.userId,
          topics: topics.length,
        });
      }),
  );

  server.registerTool(
    "add_topic",
    {
      title: "Add a topic",
      description:
        "Add a buzzword or concept to the user's PrepUp deck. Idempotent: if it already exists (even spelled differently), the existing card is returned.",
      inputSchema: AddTopicInput,
      annotations: { idempotentHint: true, destructiveHint: false },
    },
    async (input) =>
      guard(async () => {
        const { topic, created } = await service.addTopic(actor, input);
        return toolResult(
          created ? `Added "${topic.term}" to PrepUp.` : `"${topic.term}" was already in PrepUp; nothing changed.`,
          brief(topic),
        );
      }),
  );

  server.registerTool(
    "list_topics",
    {
      title: "List topics",
      description:
        "List the user's topics, highest priority first (important, weak, or about to fade). Use this to choose what to test.",
      inputSchema: ListTopicsInput,
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
      title: "Read a topic",
      description:
        "Read one topic in full, including the user's saved explanation and recent test feedback. During a test, call this only after the user has answered, so you don't prompt them with their own notes.",
      inputSchema: GetTopicInput,
      annotations: { readOnlyHint: true },
    },
    async ({ term }) =>
      guard(async () => {
        const topic = await service.findByTerm(actor, term);
        const history = await service.history(actor, topic.id);
        const lastTests = history
          .filter((e) => e.kind === "claude_test")
          .slice(0, 3)
          .map((e) => ({ at: e.createdAt, score: e.score, feedback: e.feedback }));
        return toolResult(`"${topic.term}": ${topic.score}/5 (${topic.level}).`, {
          ...brief(topic),
          explanation: topic.explanation || null,
          explanationWrittenBy: topic.explanationBy ? WHO[topic.explanationBy] : null,
          recentTests: lastTests,
        });
      }),
  );

  server.registerTool(
    "record_review",
    {
      title: "Record a test result",
      description:
        "Save the result of testing the user on a topic: the score, and optionally the explanation you drafted for their card. Only call after the user has confirmed both. Resets the topic's 14-day fade clock. A score of 5 requires explained: true.",
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
      title: "Test me",
      description: "Run a short interview-style test on your PrepUp topics.",
      argsSchema: {
        focus: z.enum(TOPIC_FILTERS).optional().describe("Which topics: fading_week, prep, confident or all"),
        count: z.string().optional().describe("How many topics, e.g. 5"),
      },
    },
    ({ focus, count }) => ({
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: `Test me on ${count ?? "5"} of my PrepUp topics (filter: ${focus ?? "fading_week"}; if that returns nothing, use "prep", then "all"). Follow the PrepUp testing steps: one topic at a time, interviewer-style follow-ups, then suggest a score and a draft of my explanation in my own words, wait for my confirmation, then record both.`,
          },
        },
      ],
    }),
  );

  server.registerPrompt(
    "quick_capture",
    {
      title: "Quick capture",
      description: "Add one or more buzzwords to PrepUp.",
      argsSchema: { terms: z.string().describe("One or more terms, separated by commas") },
    },
    ({ terms }) => ({
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: `Add these to PrepUp, one add_topic call each: ${terms}. Then tell me in one line which were new.`,
          },
        },
      ],
    }),
  );

  return server;
}
