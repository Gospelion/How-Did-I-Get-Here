const test = require("node:test");
const assert = require("node:assert/strict");
const core = require("../src/core.js");

test("normalizes URLs and removes tracking parameters", () => {
  assert.equal(
    core.normalizeUrl("https://Example.com/path/?utm_source=x&b=2&a=1#section"),
    "https://example.com/path?a=1&b=2"
  );
  assert.equal(
    core.normalizeUrl("https://www.Example.com/docs/index.html?utm_id=x&ref=y&a=1#section"),
    "https://example.com/docs?a=1"
  );
});

test("detects blacklisted and sensitive domains", () => {
  const settings = core.mergeSettings({ domainBlacklist: ["example.com"] });
  assert.equal(core.getSensitiveCategory("https://docs.example.com/a", settings), "blacklist");
  assert.equal(core.getSensitiveCategory("https://mail.google.com/mail/u/0", settings), "mail");
});

test("defaults local grouping off and AI interval to ten minutes", () => {
  const settings = core.mergeSettings({});
  assert.equal(settings.localClusteringEnabled, false);
  assert.equal(settings.aiRefreshIntervalMinutes, 10);
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

test("cleans site names from captured page titles", () => {
  assert.equal(core.cleanPageTitle("ChatGPT - 股票", "https://chatgpt.com/c/123"), "股票");
  assert.equal(core.cleanPageTitle("股票 - ChatGPT", "https://chatgpt.com/c/123"), "股票");
  assert.equal(core.cleanPageTitle("股票 - Google Search", "https://www.google.com/search?q=%E8%82%A1%E7%A5%A8"), "股票");
  assert.equal(core.cleanPageTitle("量化交易入门 - 知乎", "https://www.zhihu.com/question/123"), "量化交易入门");
  assert.equal(core.cleanPageTitle("Chrome 插件开发_csdn博客", "https://blog.csdn.net/example"), "Chrome 插件开发");
});

test("stores cleaned titles in page nodes", () => {
  const page = core.buildPageNode({
    url: "https://chatgpt.com/c/stock",
    title: "ChatGPT - 股票"
  });

  assert.equal(page.title, "股票");
});

test("builds AI payload only for requested changed pages", () => {
  const oldPage = core.buildPageNode({ url: "https://example.com/old", title: "Old Research" });
  const newPage = core.buildPageNode({ url: "https://example.com/new", title: "New Research" });
  const nodes = { [oldPage.id]: oldPage, [newPage.id]: newPage };
  const payload = core.buildAiPayload(nodes, [], core.DEFAULT_SETTINGS, { pageIds: [newPage.id] });

  assert.equal(payload.pages.length, 1);
  assert.equal(payload.pages[0].id, newPage.id);
});

test("passes requested language through AI payload", () => {
  const page = core.buildPageNode({ url: "https://example.com/research", title: "Research" });
  const payload = core.buildAiPayload({ [page.id]: page }, [], core.DEFAULT_SETTINGS, { language: "zh-CN" });

  assert.equal(payload.language, "zh-CN");
});

test("excludes known SaaS app surfaces while allowing research apps", () => {
  assert.equal(core.getExcludedAppCategory("https://vercel.com/dashboard/projects"), "saas_app");
  assert.equal(core.getExcludedAppCategory("https://app.vercel.com/acme/project"), "saas_app");
  assert.equal(core.getExcludedAppCategory("https://vercel.com/docs/frameworks/nextjs"), "");
  assert.equal(core.getExcludedAppCategory("https://chatgpt.com/c/example"), "");
});

test("classifies likely research content from text and page metrics", () => {
  assert.equal(core.isLikelyResearchContent("https://chatgpt.com/c/example", { summary: "" }, core.DEFAULT_SETTINGS), true);
  assert.equal(core.isLikelyResearchContent(
    "https://vercel.com/dashboard",
    { summary: "Deployment settings", contentMetrics: { wordCount: 2, formControlCount: 20 } },
    core.DEFAULT_SETTINGS
  ), false);
  assert.equal(core.isLikelyResearchContent(
    "https://example.com/article",
    { summary: "One two three", contentMetrics: { wordCount: 90, formControlCount: 2, linkCount: 8 } },
    core.DEFAULT_SETTINGS
  ), true);
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
  assert.ok(topics.every((topic) => topic.todoPageIds.every((id) => !topic.corePageIds.includes(id))));
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

test("deduplicates AI topic page memberships", () => {
  const first = core.buildPageNode({ url: "https://example.com/a", title: "Example A" });
  const second = core.buildPageNode({ url: "https://example.com/b", title: "Example B" });
  const nodes = { [first.id]: first, [second.id]: second };
  const topics = core.normalizeAiTopics([
    {
      name: "Pair",
      pageIds: [first.id, first.id, second.id],
      corePageIds: [first.id, first.id],
      todoPageIds: [first.id, second.id, second.id],
      confidence: 0.9
    }
  ], nodes);

  assert.deepEqual(topics[0].pageIds, [first.id, second.id]);
  assert.deepEqual(topics[0].corePageIds, [first.id]);
  assert.deepEqual(topics[0].todoPageIds, [second.id]);
});

test("sanitizes topic memberships without expanding pageIds", () => {
  const first = core.buildPageNode({ url: "https://example.com/a", title: "Example A" });
  const second = core.buildPageNode({ url: "https://example.com/b", title: "Example B" });
  const third = core.buildPageNode({ url: "https://example.com/c", title: "Example C" });
  const topic = core.sanitizeTopic({
    id: "t_1",
    pageIds: [first.id, first.id, second.id],
    corePageIds: [first.id, third.id],
    todoPageIds: [first.id, second.id, second.id, third.id]
  }, { allowedPageIds: [first.id, second.id, third.id] });

  assert.deepEqual(topic.pageIds, [first.id, second.id]);
  assert.deepEqual(topic.corePageIds, [first.id]);
  assert.deepEqual(topic.todoPageIds, [second.id]);
});
