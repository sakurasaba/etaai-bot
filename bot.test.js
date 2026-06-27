const { formatTimeDiff, splitMessage } = require("./utils");

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

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

  test("prefers splitting at newlines over mid-word cuts", () => {
    const text = "first line\nsecond line\nthird line";
    const chunks = splitMessage(text, 22);
    expect(chunks[0]).toBe("first line\nsecond line");
    expect(chunks[1]).toBe("\nthird line");
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
