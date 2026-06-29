jest.mock("dotenv", () => ({ config: jest.fn() }));
jest.mock("discord.js", () => ({
  Client: jest.fn().mockImplementation(() => ({
    on: jest.fn(),
    once: jest.fn(),
    user: { tag: "TestBot#0000" },
    login: jest.fn(),
  })),
  GatewayIntentBits: { Guilds: 1, GuildMessages: 2, MessageContent: 4, GuildPresences: 8, GuildMembers: 16 },
  Partials: { Message: "MESSAGE", Channel: "CHANNEL" },
  ChannelType: { PublicThread: "GUILD_PUBLIC_THREAD" },
}));
const mockGenerateContent = jest.fn();
jest.mock("@google/generative-ai", () => ({
  GoogleGenerativeAI: jest.fn().mockImplementation(() => ({
    getGenerativeModel: jest.fn().mockReturnValue({ generateContent: mockGenerateContent }),
  })),
}));
jest.mock("./db", () => ({
  init: jest.fn().mockResolvedValue(undefined),
  getLastSummaryTime: jest.fn().mockResolvedValue(null),
  saveLastSummary: jest.fn().mockResolvedValue(undefined),
}));

const { formatTimeDiff, splitMessage, buildTranscript, resolveRefs, parseTimeframe } = require("./utils");
const { fetchMissedMessages, generateSummary } = require("./bot");

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

function makeMessage({ id, authorId, username, content, createdAt, bot = false, url }) {
  return {
    id,
    author: { id: authorId, username, bot },
    content,
    createdAt: new Date(createdAt),
    url: url || `https://discord.com/channels/1/2/${id}`,
  };
}

function makeChannel(batches) {
  let callIndex = 0;
  return {
    messages: {
      fetch: jest.fn(() => {
        const batch = batches[callIndex++] || [];
        const map = new Map(batch.map((m) => [m.id, m]));
        map.last = () => batch[batch.length - 1];
        return Promise.resolve(map);
      }),
    },
  };
}

describe("formatTimeDiff", () => {
  test("returns minutes when diff is under an hour", () => {
    const from = new Date(0);
    const to = new Date(45 * MINUTE);
    expect(formatTimeDiff(from, to)).toBe("45m");
  });

  test("returns hours and minutes when diff is under a day", () => {
    const from = new Date(0);
    const to = new Date(2 * HOUR + 30 * MINUTE);
    expect(formatTimeDiff(from, to)).toBe("2h 30m");
  });

  test("returns days and remaining hours when diff is over a day", () => {
    const from = new Date(0);
    const to = new Date(3 * DAY + 5 * HOUR);
    expect(formatTimeDiff(from, to)).toBe("3d 5h");
  });

  test("returns 0m for identical timestamps", () => {
    const now = new Date(1000);
    expect(formatTimeDiff(now, now)).toBe("0m");
  });

  test("returns correct value at exactly 1 hour", () => {
    const from = new Date(0);
    const to = new Date(HOUR);
    expect(formatTimeDiff(from, to)).toBe("1h 0m");
  });

  test("returns correct value at exactly 1 day", () => {
    const from = new Date(0);
    const to = new Date(DAY);
    expect(formatTimeDiff(from, to)).toBe("1d 0h");
  });
});

describe("splitMessage", () => {
  test("returns single chunk when text fits within maxLen", () => {
    const text = "hello world";
    expect(splitMessage(text, 100)).toEqual(["hello world"]);
  });

  test("splits text into multiple chunks when it exceeds maxLen", () => {
    const text = "a".repeat(250);
    const chunks = splitMessage(text, 100);
    expect(chunks.length).toBe(3);
    expect(chunks.every((c) => c.length <= 100)).toBe(true);
    expect(chunks.join("")).toBe(text);
  });

  test("prefers splitting at newlines and consumes the separator", () => {
    const text = "first line\nsecond line\nthird line";
    const chunks = splitMessage(text, 22);
    expect(chunks[0]).toBe("first line\nsecond line");
    expect(chunks[1]).toBe("third line");
  });

  test("falls back to hard cut when no newline is available", () => {
    const text = "a".repeat(150);
    const chunks = splitMessage(text, 100);
    expect(chunks[0].length).toBe(100);
    expect(chunks[1].length).toBe(50);
    expect(chunks.join("")).toBe(text);
  });

  test("handles empty string", () => {
    expect(splitMessage("", 100)).toEqual([]);
  });

  test("handles text exactly equal to maxLen", () => {
    const text = "a".repeat(100);
    expect(splitMessage(text, 100)).toEqual([text]);
  });
});

describe("resolveRefs", () => {
  const messages = [
    { url: "https://discord.com/channels/1/2/100" },
    { url: "https://discord.com/channels/1/2/200" },
    { url: "https://discord.com/channels/1/2/300" },
  ];

  test("replaces ref inside parentheses with the message URL", () => {
    const summary = "• Something happened (ref2)";
    expect(resolveRefs(summary, messages)).toBe("• Something happened (https://discord.com/channels/1/2/200)");
  });

  test("replaces multiple refs in the same summary", () => {
    const summary = "• First thing (ref1)\n• Second thing (ref3)";
    expect(resolveRefs(summary, messages)).toBe(
      "• First thing (https://discord.com/channels/1/2/100)\n• Second thing (https://discord.com/channels/1/2/300)"
    );
  });

  test("is case-insensitive for REF", () => {
    const summary = "• Something (REF1)";
    expect(resolveRefs(summary, messages)).toBe("• Something (https://discord.com/channels/1/2/100)");
  });

  test("leaves ref unchanged when index is out of range", () => {
    const summary = "• Something (ref99)";
    expect(resolveRefs(summary, messages)).toBe("• Something (ref99)");
  });

  test("does not replace ref inside longer words", () => {
    const summary = "• refresh the page (ref1)";
    expect(resolveRefs(summary, messages)).toBe("• refresh the page (https://discord.com/channels/1/2/100)");
  });
});

describe("parseTimeframe", () => {
  const MINUTE = 60 * 1000;
  const HOUR = 60 * MINUTE;
  const DAY = 24 * HOUR;

  test("parses minutes with short unit", () => {
    expect(parseTimeframe("@Etaai summarize last 30m")).toBe(30 * MINUTE);
  });

  test("parses minutes with full word", () => {
    expect(parseTimeframe("@Etaai summarize last 45 minutes")).toBe(45 * MINUTE);
  });

  test("parses hours with short unit", () => {
    expect(parseTimeframe("@Etaai summarize last 6h")).toBe(6 * HOUR);
  });

  test("parses hours with full word", () => {
    expect(parseTimeframe("summarize last 12 hours")).toBe(12 * HOUR);
  });

  test("parses days with short unit", () => {
    expect(parseTimeframe("last 1d please")).toBe(1 * DAY);
  });

  test("parses days with full word", () => {
    expect(parseTimeframe("last 1 day")).toBe(1 * DAY);
  });

  test("is case-insensitive", () => {
    expect(parseTimeframe("Last 3 Hours")).toBe(3 * HOUR);
  });

  test("returns null when no timeframe is present", () => {
    expect(parseTimeframe("@Etaai summarize")).toBeNull();
  });

  test("returns null for unrecognised text", () => {
    expect(parseTimeframe("hey what's up")).toBeNull();
  });
});

describe("buildTranscript", () => {
  test("formats messages with ref IDs, timestamps, and a separate URL map", () => {
    const messages = [
      makeMessage({ id: "1", authorId: "u1", username: "alice", content: "hello", createdAt: 0, url: "https://discord.com/msg/1" }),
      makeMessage({ id: "2", authorId: "u2", username: "bob", content: "world", createdAt: MINUTE, url: "https://discord.com/msg/2" }),
    ];
    const result = buildTranscript(messages);
    expect(result).toContain("[ref1]");
    expect(result).toContain("[ref2]");
    expect(result).toContain("alice: hello");
    expect(result).toContain("bob: world");
    expect(result).toContain("ref1: https://discord.com/msg/1");
    expect(result).toContain("ref2: https://discord.com/msg/2");
  });

  test("does not embed URLs in the content lines", () => {
    const url = "https://discord.com/msg/1";
    const messages = [makeMessage({ id: "1", authorId: "u1", username: "alice", content: "hi", createdAt: 0, url })];
    const result = buildTranscript(messages);
    const contentSection = result.split("\n\nMessage URLs")[0];
    expect(contentSection).not.toContain(url);
  });

  test("URL map section lists all message URLs with matching ref IDs", () => {
    const messages = [
      makeMessage({ id: "1", authorId: "u1", username: "alice", content: "a", createdAt: 0, url: "https://discord.com/msg/1" }),
      makeMessage({ id: "2", authorId: "u2", username: "bob", content: "b", createdAt: MINUTE, url: "https://discord.com/msg/2" }),
    ];
    const result = buildTranscript(messages);
    const urlSection = result.split("\n\nMessage URLs (use in bullets):\n")[1];
    expect(urlSection).toBe("ref1: https://discord.com/msg/1\nref2: https://discord.com/msg/2");
  });
});

describe("fetchMissedMessages", () => {
  const USER_ID = "user123";
  const EXCLUDE_ID = "trigger-msg";
  // Pin "now" so startOfYesterday = 2024-01-01T00:00:00Z, keeping test timestamps in range
  const FAKE_NOW = new Date("2024-01-02T00:00:00Z");

  beforeAll(() => {
    jest.useFakeTimers();
    jest.setSystemTime(FAKE_NOW);
  });

  afterAll(() => {
    jest.useRealTimers();
  });

  test("returns messages newer than knownCutoff and preserves cutoffTime", async () => {
    const cutoff = new Date("2024-01-01T10:00:00Z");
    const batch = [
      makeMessage({ id: "3", authorId: "bob", username: "bob", content: "new", createdAt: "2024-01-01T11:00:00Z" }),
      makeMessage({ id: "2", authorId: "bob", username: "bob", content: "old", createdAt: "2024-01-01T09:30:00Z" }),
    ];
    const channel = makeChannel([batch]);
    const { messages, cutoffTime } = await fetchMissedMessages(channel, cutoff, USER_ID, EXCLUDE_ID);
    expect(messages).toHaveLength(1);
    expect(messages[0].id).toBe("3");
    expect(cutoffTime).toEqual(cutoff);
  });

  test("excludes the trigger message from results", async () => {
    const cutoff = new Date("2024-01-01T08:00:00Z");
    const batch = [
      makeMessage({ id: EXCLUDE_ID, authorId: "bob", username: "bob", content: "trigger", createdAt: "2024-01-01T11:00:00Z" }),
      makeMessage({ id: "1", authorId: "alice", username: "alice", content: "hello", createdAt: "2024-01-01T10:00:00Z" }),
    ];
    const channel = makeChannel([batch]);
    const { messages } = await fetchMissedMessages(channel, cutoff, USER_ID, EXCLUDE_ID);
    expect(messages.map((m) => m.id)).not.toContain(EXCLUDE_ID);
    expect(messages[0].id).toBe("1");
  });

  test("discovers cutoff from user's own last message when knownCutoff is null", async () => {
    const batch = [
      makeMessage({ id: "3", authorId: "bob", username: "bob", content: "new msg", createdAt: "2024-01-01T11:00:00Z" }),
      makeMessage({ id: "2", authorId: USER_ID, username: "me", content: "my old msg", createdAt: "2024-01-01T10:00:00Z" }),
    ];
    const channel = makeChannel([batch]);
    const { messages, cutoffTime } = await fetchMissedMessages(channel, null, USER_ID, EXCLUDE_ID);
    expect(messages).toHaveLength(1);
    expect(messages[0].id).toBe("3");
    expect(cutoffTime).toEqual(new Date("2024-01-01T10:00:00Z"));
  });

  test("excludes bot messages from results", async () => {
    const cutoff = new Date("2024-01-01T09:00:00Z");
    const batch = [
      makeMessage({ id: "2", authorId: "bot1", username: "BotUser", content: "bot msg", createdAt: "2024-01-01T10:00:00Z", bot: true }),
      makeMessage({ id: "1", authorId: "human", username: "alice", content: "human msg", createdAt: "2024-01-01T09:30:00Z" }),
    ];
    const channel = makeChannel([batch]);
    const { messages } = await fetchMissedMessages(channel, cutoff, USER_ID, EXCLUDE_ID);
    expect(messages).toHaveLength(1);
    expect(messages[0].id).toBe("1");
  });

  test("returns messages sorted chronologically oldest-first", async () => {
    const cutoff = new Date("2024-01-01T09:00:00Z");
    const batch = [
      makeMessage({ id: "3", authorId: "bob", username: "bob", content: "newest", createdAt: "2024-01-01T11:00:00Z" }),
      makeMessage({ id: "2", authorId: "alice", username: "alice", content: "middle", createdAt: "2024-01-01T10:30:00Z" }),
      makeMessage({ id: "1", authorId: "charlie", username: "charlie", content: "oldest", createdAt: "2024-01-01T09:30:00Z" }),
    ];
    const channel = makeChannel([batch]);
    const { messages } = await fetchMissedMessages(channel, cutoff, USER_ID, EXCLUDE_ID);
    expect(messages[0].id).toBe("1");
    expect(messages[1].id).toBe("2");
    expect(messages[2].id).toBe("3");
  });

  test("returns empty array and preserves knownCutoff when no new messages exist", async () => {
    const cutoff = new Date("2024-01-01T12:00:00Z");
    const batch = [
      makeMessage({ id: "1", authorId: "bob", username: "bob", content: "old", createdAt: "2024-01-01T10:00:00Z" }),
    ];
    const channel = makeChannel([batch]);
    const { messages, cutoffTime } = await fetchMissedMessages(channel, cutoff, USER_ID, EXCLUDE_ID);
    expect(messages).toHaveLength(0);
    expect(cutoffTime).toEqual(cutoff);
  });

  test("stops fetching across multiple batches when cutoff is reached", async () => {
    const cutoff = new Date("2024-01-01T10:00:00Z");
    const batch1 = [
      makeMessage({ id: "3", authorId: "bob", username: "bob", content: "c", createdAt: "2024-01-01T12:00:00Z" }),
    ];
    const batch2 = [
      makeMessage({ id: "2", authorId: "bob", username: "bob", content: "b", createdAt: "2024-01-01T11:00:00Z" }),
      makeMessage({ id: "1", authorId: "bob", username: "bob", content: "a", createdAt: "2024-01-01T09:00:00Z" }),
    ];
    const channel = makeChannel([batch1, batch2]);
    const { messages } = await fetchMissedMessages(channel, cutoff, USER_ID, EXCLUDE_ID);
    expect(messages).toHaveLength(2);
    expect(channel.messages.fetch).toHaveBeenCalledTimes(2);
  });
});

describe("generateSummary", () => {
  beforeEach(() => {
    mockGenerateContent.mockReset();
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  test("returns text on first successful attempt", async () => {
    mockGenerateContent.mockResolvedValueOnce({ response: { text: () => "• bullet (https://discord.com/msg/1)" } });
    const result = await generateSummary("transcript", "2h 30m");
    expect(result).toBe("• bullet (https://discord.com/msg/1)");
    expect(mockGenerateContent).toHaveBeenCalledTimes(1);
  });

  test("retries on 503 and succeeds on second attempt", async () => {
    const err = Object.assign(new Error("503"), { status: 503 });
    mockGenerateContent
      .mockRejectedValueOnce(err)
      .mockResolvedValueOnce({ response: { text: () => "• retry succeeded (https://discord.com/msg/2)" } });

    const promise = generateSummary("transcript", "1h 0m");
    await jest.runAllTimersAsync();
    const result = await promise;

    expect(result).toBe("• retry succeeded (https://discord.com/msg/2)");
    expect(mockGenerateContent).toHaveBeenCalledTimes(2);
  });

  test("retries on 429 and succeeds on third attempt", async () => {
    const err = Object.assign(new Error("429"), { status: 429 });
    mockGenerateContent
      .mockRejectedValueOnce(err)
      .mockRejectedValueOnce(err)
      .mockResolvedValueOnce({ response: { text: () => "• final attempt (https://discord.com/msg/3)" } });

    const promise = generateSummary("transcript", "45m");
    await jest.runAllTimersAsync();
    const result = await promise;

    expect(result).toBe("• final attempt (https://discord.com/msg/3)");
    expect(mockGenerateContent).toHaveBeenCalledTimes(3);
  });

  test("throws after exhausting all retry attempts on persistent 503", async () => {
    const err = Object.assign(new Error("503"), { status: 503 });
    mockGenerateContent.mockRejectedValue(err);

    const promise = generateSummary("transcript", "3d 5h");
    const assertion = expect(promise).rejects.toMatchObject({ status: 503 });
    await jest.runAllTimersAsync();
    await assertion;
    expect(mockGenerateContent).toHaveBeenCalledTimes(3);
  });

  test("does not retry on 400 bad request", async () => {
    const err = Object.assign(new Error("400"), { status: 400 });
    mockGenerateContent.mockRejectedValueOnce(err);

    await expect(generateSummary("transcript", "1h 0m")).rejects.toMatchObject({ status: 400 });
    expect(mockGenerateContent).toHaveBeenCalledTimes(1);
  });
});
