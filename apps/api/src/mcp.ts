/**
 * The MCP adapter: how Claude uses PrepUp. The behaviour Claude needs travels
 * with the connector itself (server instructions, tool descriptions and
 * prompts), so anyone who connects gets it without installing anything else.
 * Every tool calls the same core service as the REST API.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { AddTopicInput, ListTopicsInput, RecordReviewInput, TOPIC_FILTERS, type TopicView } from "@prepup/contracts";
import { DomainError, type Actor, type PrepUpService } from "@prepup/core";
import { z } from "zod";

export const SERVER_INSTRUCTIONS = `PrepUp tracks the AI buzzwords the user is preparing for Forward Deployed Engineer interviews.
Each topic has a score from 1 to 5: 1-4 is how well they understand it and can answer questions; 5 means they can explain it clearly.
Scores fade one step every 14 days unless the topic is tested again.

Capturing: when the user mentions a term they want to learn, call add_topic. It is safe to call twice; duplicates merge.

Testing:
1. Pick topics with list_topics (use filter "fading_week" or "prep" unless the user names topics).
2. Ask about one topic at a time, like an interviewer: start open ("explain X"), then one or two follow-ups that probe depth or a real use case.
3. Suggest a score with a one-line reason. Only suggest 5 if they explained it clearly in their own words.
4. Ask the user to confirm or change the score. Never call record_review before they confirm.
5. Call record_review with the confirmed score, then move to the next topic.
Keep feedback short and specific. Do not reveal the user's saved explanation before they answer.`;

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
    { name: "prepup", title: "PrepUp", version: "0.1.0" },
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
        const topics = await service.listTopics(actor, { filter: "all", limit: 100 });
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
    "record_review",
    {
      title: "Record a test result",
      description:
        "Save the result of testing the user on a topic. Only call after the user has confirmed the score. Resets the topic's 14-day fade clock. A score of 5 requires explained: true.",
      inputSchema: RecordReviewInput,
      annotations: { destructiveHint: false, idempotentHint: false },
    },
    async (input) =>
      guard(async () => {
        const topic = await service.recordReview(actor, input);
        return toolResult(`Saved: "${topic.term}" is now ${topic.score}/5 (${topic.level}).`, brief(topic));
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
            text: `Test me on ${count ?? "5"} of my PrepUp topics (filter: ${focus ?? "fading_week"}; if that returns nothing, use "prep", then "all"). Follow the PrepUp testing steps: one topic at a time, interviewer-style follow-ups, suggest a score, wait for my confirmation, then record it.`,
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
