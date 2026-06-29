const test = require("node:test");
const assert = require("node:assert/strict");
const core = require("../src/core.js");

test("normalizes URLs and removes tracking parameters", () => {
  assert.equal(
    core.normalizeUrl("https://Example.com/path/?utm_source=x&b=2&a=1#section"),
    "https://example.com/path?a=1&b=2"
  );
});

test("detects blacklisted and sensitive domains", () => {
  const settings = core.mergeSettings({ domainBlacklist: ["example.com"] });
  assert.equal(core.getSensitiveCategory("https://docs.example.com/a", settings), "blacklist");
  assert.equal(core.getSensitiveCategory("https://mail.google.com/mail/u/0", settings), "mail");
});

test("infers source edge types", () => {
  assert.equal(core.inferEdgeType({
    openerUrl: "https://www.google.com/search?q=chrome+extension",
    url: "https://developer.chrome.com/docs/extensions"
  }), "search_result");
  assert.equal(core.inferEdgeType({
    referrerUrl: "https://developer.chrome.com/docs/extensions",
    url: "https://developer.chrome.com/docs/extensions/mv3"
  }), "clicked_from");
});

test("builds AI payload without sensitive pages", () => {
  const safe = core.buildPageNode({ url: "https://developer.chrome.com/docs/extensions", title: "Chrome Extensions" });
  const mail = core.buildPageNode({ url: "https://mail.google.com/mail/u/0", title: "Inbox" });
  const nodes = { [safe.id]: safe, [mail.id]: mail };
  const payload = core.buildAiPayload(nodes, [], core.DEFAULT_SETTINGS);
  assert.equal(payload.pages.length, 1);
  assert.equal(payload.pages[0].id, safe.id);
});

test("derives local topics and core pages", () => {
  const first = core.buildPageNode({
    url: "https://developer.chrome.com/docs/extensions",
    title: "Chrome Extension Docs",
    readingProgress: 0.8,
    timestamp: 1000
  });
  const second = core.buildPageNode({
    url: "https://developer.chrome.com/docs/webstore",
    title: "Chrome Web Store",
    readingProgress: 0.2,
    timestamp: 2000
  });
  const topics = core.deriveLocalTopics({ [first.id]: first, [second.id]: second }, []);
  assert.ok(topics.length >= 1);
  assert.ok(topics.some((topic) => topic.corePageIds.includes(first.id)));
  assert.ok(topics.every((topic) => topic.pageIds.length >= 2));
  assert.ok(topics.every((topic) => topic.confidence >= core.DEFAULT_SETTINGS.minTopicConfidence));
});

test("does not derive one-page topics", () => {
  const page = core.buildPageNode({
    url: "https://example.com/one",
    title: "Standalone Example",
    timestamp: 1000
  });
  const topics = core.deriveLocalTopics({ [page.id]: page }, []);
  assert.deepEqual(topics, []);
});

test("filters AI topics with fewer than two pages", () => {
  const first = core.buildPageNode({ url: "https://example.com/a", title: "Example A" });
  const second = core.buildPageNode({ url: "https://example.com/b", title: "Example B" });
  const topics = core.normalizeAiTopics([
    { name: "Single", pageIds: [first.id], confidence: 1 },
    { name: "Pair", pageIds: [first.id, second.id], confidence: 0.8 }
  ], { [first.id]: first, [second.id]: second });

  assert.equal(topics.length, 1);
  assert.equal(topics[0].name, "Pair");
});
