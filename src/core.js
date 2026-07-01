(function initCore(global) {
  const SEARCH_HOSTS = [
    "google.",
    "bing.com",
    "duckduckgo.com",
    "baidu.com",
    "sogou.com",
    "yahoo.com"
  ];

  const DEFAULT_SETTINGS = {
    aiConsentGranted: false,
    aiEnabled: true,
    localClusteringEnabled: false,
    aiRefreshIntervalMinutes: 10,
    domainBlacklist: [],
    sensitiveCategoryExclusions: [
      "banking",
      "health",
      "mail",
      "cloud_storage",
      "private_social",
      "passwords",
      "government",
      "adult"
    ],
    restoreLimit: 8,
    minTopicPages: 2,
    minTopicConfidence: 0.35,
    minReadableWords: 80
  };

  const RESEARCH_APP_HOSTS = [
    "chatgpt.com",
    "chat.openai.com",
    "claude.ai",
    "perplexity.ai",
    "poe.com"
  ];

  const SITE_TITLE_TOKENS = [
    "chatgpt",
    "openai",
    "google",
    "google search",
    "bing",
    "duckduckgo",
    "baidu",
    "zhihu",
    "知乎",
    "csdn",
    "csdn博客",
    "reddit",
    "perplexity",
    "claude",
    "poe",
    "youtube",
    "bilibili",
    "哔哩哔哩"
  ];

  const SAAS_APP_RULES = [
    {
      category: "saas_app",
      domains: ["app.vercel.com", "dashboard.vercel.com"],
      patterns: []
    },
    {
      category: "saas_app",
      domains: ["vercel.com"],
      patterns: ["/dashboard", "/account", "/teams", "/settings", "/projects", "/deployments", "/usage", "/billing", "/new"]
    },
    {
      category: "saas_app",
      domains: ["app.netlify.com", "dash.cloudflare.com", "dashboard.stripe.com", "portal.azure.com", "console.cloud.google.com"],
      patterns: []
    },
    {
      category: "saas_app",
      domains: ["supabase.com"],
      patterns: ["/dashboard", "/account", "/projects", "/org"]
    },
    {
      category: "saas_app",
      domains: ["linear.app", "trello.com", "asana.com", "airtable.com", "figma.com", "notion.so"],
      patterns: []
    }
  ];

  const SENSITIVE_RULES = [
    {
      category: "banking",
      patterns: ["bank", "paypal.com", "wise.com", "revolut.com", "chase.com", "wellsfargo.com", "citi.com"]
    },
    {
      category: "health",
      patterns: ["health", "clinic", "hospital", "doctor", "patient", "mychart", "medical"]
    },
    {
      category: "mail",
      patterns: ["mail.google.com", "outlook.live.com", "outlook.office.com", "mail.yahoo.com", "proton.me", "mail.qq.com"]
    },
    {
      category: "cloud_storage",
      patterns: ["drive.google.com", "dropbox.com", "onedrive.live.com", "icloud.com", "box.com"]
    },
    {
      category: "private_social",
      patterns: ["messages.google.com", "web.whatsapp.com", "messenger.com", "discord.com", "slack.com", "teams.microsoft.com"]
    },
    {
      category: "passwords",
      patterns: ["1password.com", "lastpass.com", "bitwarden.com", "dashlane.com"]
    },
    {
      category: "government",
      patterns: [".gov", "gov.cn", "irs.gov", "uscis.gov"]
    },
    {
      category: "adult",
      patterns: ["porn", "xxx", "adult"]
    }
  ];

  function normalizeUrl(url) {
    try {
      const parsed = new URL(url);
      parsed.protocol = parsed.protocol.toLowerCase();
      parsed.hostname = parsed.hostname.toLowerCase().replace(/^www\./, "");
      parsed.hash = "";
      if (parsed.pathname !== "/") {
        parsed.pathname = parsed.pathname.replace(/\/(?:index|default)\.(?:html?|php)$/i, "/");
        parsed.pathname = parsed.pathname.replace(/\/+$/, "");
      }
      const removable = [
        "utm_source",
        "utm_medium",
        "utm_campaign",
        "utm_term",
        "utm_content",
        "utm_id",
        "utm_source_platform",
        "utm_creative_format",
        "utm_marketing_tactic",
        "fbclid",
        "gclid",
        "dclid",
        "gbraid",
        "wbraid",
        "mc_cid",
        "mc_eid",
        "igshid",
        "ref",
        "ref_src"
      ];
      removable.forEach((key) => parsed.searchParams.delete(key));
      parsed.searchParams.sort();
      return parsed.toString();
    } catch (_error) {
      return "";
    }
  }

  function getDomain(url) {
    try {
      return new URL(url).hostname.replace(/^www\./, "").toLowerCase();
    } catch (_error) {
      return "";
    }
  }

  function stableId(input) {
    let hash = 5381;
    for (let index = 0; index < input.length; index += 1) {
      hash = (hash * 33) ^ input.charCodeAt(index);
    }
    return `p_${(hash >>> 0).toString(36)}`;
  }

  function mergeSettings(settings) {
    return {
      ...DEFAULT_SETTINGS,
      ...(settings || {}),
      domainBlacklist: Array.isArray(settings?.domainBlacklist) ? settings.domainBlacklist : [],
      sensitiveCategoryExclusions: Array.isArray(settings?.sensitiveCategoryExclusions)
        ? settings.sensitiveCategoryExclusions
        : DEFAULT_SETTINGS.sensitiveCategoryExclusions
    };
  }

  function getSensitiveCategory(url, settings) {
    const normalizedSettings = mergeSettings(settings);
    const domain = getDomain(url);
    const lowerUrl = String(url || "").toLowerCase();
    const blacklisted = normalizedSettings.domainBlacklist.some((entry) => {
      const normalizedEntry = String(entry || "").replace(/^https?:\/\//, "").replace(/^www\./, "").toLowerCase();
      return normalizedEntry && domain.endsWith(normalizedEntry);
    });

    if (blacklisted) {
      return "blacklist";
    }

    for (const rule of SENSITIVE_RULES) {
      if (!normalizedSettings.sensitiveCategoryExclusions.includes(rule.category)) {
        continue;
      }

      if (rule.patterns.some((pattern) => lowerUrl.includes(pattern))) {
        return rule.category;
      }
    }

    return "";
  }

  function isSearchUrl(url) {
    const domain = getDomain(url);
    return SEARCH_HOSTS.some((host) => domain.includes(host));
  }

  function inferEdgeType({ openerUrl, referrerUrl, url }) {
    if (openerUrl || referrerUrl) {
      const source = openerUrl || referrerUrl;
      if (isSearchUrl(source)) {
        return "search_result";
      }
      if (normalizeUrl(source) !== normalizeUrl(url)) {
        return "clicked_from";
      }
    }
    return "";
  }

  function extractSearchTerm(url) {
    try {
      const parsed = new URL(url);
      return parsed.searchParams.get("q") || parsed.searchParams.get("query") || parsed.searchParams.get("wd") || "";
    } catch (_error) {
      return "";
    }
  }

  function keywordize(text) {
    const words = String(text || "")
      .toLowerCase()
      .replace(/https?:\/\/\S+/g, " ")
      .replace(/[^\p{L}\p{N}\s-]/gu, " ")
      .split(/\s+/)
      .filter((word) => word.length >= 3);
    const stopWords = new Set(["www", "com", "docs", "blog", "with", "from", "that", "this", "what", "how", "the", "and"]);
    return words.filter((word) => !stopWords.has(word)).slice(0, 8);
  }

  function buildPageNode(input, existingNode) {
    const url = normalizeUrl(input.url);
    const now = input.timestamp || Date.now();
    const id = stableId(url);
    const title = cleanPageTitle(input.title || "", url) || existingNode?.title || getDomain(url) || "Untitled page";
    const summary = input.summary || existingNode?.summary || "";
    const tags = Array.from(new Set([...(existingNode?.tags || []), ...(input.tags || [])]));
    const readingProgress = Math.max(existingNode?.readingProgress || 0, input.readingProgress || 0);
    const readStatus = readingProgress > 0.7 ? "read" : readingProgress > 0.15 ? "skimmed" : "unread";

    return {
      id,
      url,
      title,
      domain: getDomain(url),
      summary,
      tags,
      visitTime: existingNode?.visitTime || now,
      lastVisitTime: now,
      visitCount: (existingNode?.visitCount || 0) + 1,
      readingProgress,
      importance: input.importance || existingNode?.importance || "medium",
      readStatus,
      topicIds: Array.from(new Set(existingNode?.topicIds || [])),
      contentMetrics: input.contentMetrics || existingNode?.contentMetrics || null,
      sensitiveSkipped: Boolean(input.sensitiveSkipped || existingNode?.sensitiveSkipped)
    };
  }

  function makeEdge(fromPageId, toPageId, relationType, createdAt) {
    if (!fromPageId || !toPageId || fromPageId === toPageId || !relationType) {
      return null;
    }
    return {
      id: `${fromPageId}_${toPageId}_${relationType}`,
      fromPageId,
      toPageId,
      relationType,
      createdAt: createdAt || Date.now()
    };
  }

  function deriveLocalTopics(nodes, edges) {
    const pages = Object.values(nodes || {})
      .filter((node) => !node.sensitiveSkipped && node.url)
      .sort((a, b) => a.visitTime - b.visitTime);
    const groups = new Map();

    for (const page of pages) {
      const pageWords = keywordize(`${page.title} ${page.summary} ${page.domain}`);
      const incoming = (edges || []).filter((edge) => edge.toPageId === page.id);
      const searchSource = incoming
        .map((edge) => nodes[edge.fromPageId])
        .find((source) => source && isSearchUrl(source.url));
      const searchTerm = searchSource ? extractSearchTerm(searchSource.url) : "";
      const primary = keywordize(searchTerm)[0] || pageWords[0] || page.domain.split(".")[0] || "research";
      const timeBucket = new Date(page.visitTime).toISOString().slice(0, 10);
      const groupKey = `${timeBucket}:${primary}`;

      if (!groups.has(groupKey)) {
        groups.set(groupKey, {
          id: `t_${stableId(groupKey)}`,
          name: titleCase(searchTerm || primary),
          summary: "Automatically grouped from recent browsing signals.",
          pageIds: [],
          corePageIds: [],
          todoPageIds: [],
          updatedAt: page.lastVisitTime
        });
      }

      const topic = groups.get(groupKey);
      if (!topic.pageIds.includes(page.id)) {
        topic.pageIds.push(page.id);
      }
      topic.updatedAt = Math.max(topic.updatedAt, page.lastVisitTime);
    }

    const topics = [];
    for (const topic of groups.values()) {
      const sortedPages = topic.pageIds
        .map((id) => nodes[id])
        .filter(Boolean)
        .sort((a, b) => {
          const importanceWeight = { high: 3, medium: 2, low: 1 };
          return (importanceWeight[b.importance] || 0) - (importanceWeight[a.importance] || 0)
            || b.readingProgress - a.readingProgress
            || b.lastVisitTime - a.lastVisitTime;
        });
      topic.corePageIds = sortedPages.slice(0, 3).map((page) => page.id);
      const corePageIdSet = new Set(topic.corePageIds);
      topic.todoPageIds = sortedPages
        .filter((page) => page.readStatus !== "read" && !corePageIdSet.has(page.id))
        .slice(0, 8)
        .map((page) => page.id);
      topic.confidence = calculateTopicConfidence(topic, nodes, edges);
      if (topic.pageIds.length >= DEFAULT_SETTINGS.minTopicPages && topic.confidence >= DEFAULT_SETTINGS.minTopicConfidence) {
        topics.push(topic);
      }
    }

    return topics.sort((a, b) => b.updatedAt - a.updatedAt);
  }

  function calculateTopicConfidence(topic, nodes, edges) {
    const pages = (topic.pageIds || []).map((id) => nodes[id]).filter(Boolean);
    if (pages.length < DEFAULT_SETTINGS.minTopicPages) {
      return 0;
    }

    const topicWords = keywordize(topic.name || topic.summary || "");
    const pageWordSets = pages.map((page) => new Set(keywordize(`${page.title} ${page.summary} ${page.domain}`)));
    const matchedPages = topicWords.length
      ? pageWordSets.filter((words) => topicWords.some((word) => words.has(word))).length
      : 0;
    const largestDomainShare = Math.max(...Object.values(pages.reduce((counts, page) => {
      counts[page.domain] = (counts[page.domain] || 0) + 1;
      return counts;
    }, {}))) / pages.length;
    const cohesionScore = Math.max(
      topicWords.length ? matchedPages / pages.length : 0,
      largestDomainShare >= 0.5 ? largestDomainShare : 0
    );

    const pageIds = new Set(topic.pageIds || []);
    const meaningfulEdges = (edges || []).filter((edge) => (
      edge.relationType !== "same_topic"
      && pageIds.has(edge.fromPageId)
      && pageIds.has(edge.toPageId)
    ));
    const relationScore = Math.min(1, meaningfulEdges.length / Math.max(1, pages.length - 1));

    const engagementScore = pages.reduce((sum, page) => {
      const progress = Math.min(1, Math.max(0, page.readingProgress || 0));
      const importance = page.importance === "high" ? 1 : page.importance === "low" ? 0.35 : 0.65;
      const visits = Math.min(1, (page.visitCount || 1) / 3);
      return sum + (progress * 0.45 + importance * 0.25 + visits * 0.3);
    }, 0) / pages.length;

    return Math.round((cohesionScore * 0.45 + relationScore * 0.25 + engagementScore * 0.3) * 100) / 100;
  }

  function titleCase(value) {
    return String(value || "Research")
      .replace(/[-_]+/g, " ")
      .trim()
      .replace(/\s+/g, " ")
      .replace(/\b\p{L}/gu, (letter) => letter.toUpperCase());
  }

  function cleanPageTitle(title, url) {
    const normalizedTitle = String(title || "")
      .replace(/\s+/g, " ")
      .trim();
    if (!normalizedTitle) {
      return "";
    }

    const domain = getDomain(url);
    const siteTokens = getSiteTitleTokens(domain);
    const titleSeparatorPattern = /\s*(?:[-|·•_]|—|–|｜|：|:)\s*/u;
    if (!titleSeparatorPattern.test(normalizedTitle)) {
      return trimTrailingSiteNoise(normalizedTitle, siteTokens) || normalizedTitle;
    }

    const parts = normalizedTitle
      .split(titleSeparatorPattern)
      .map((part) => trimSiteNoise(part, siteTokens))
      .filter(Boolean);

    const contentParts = parts.filter((part) => !isSiteTitlePart(part, siteTokens));
    if (contentParts.length) {
      return contentParts.join(" - ").slice(0, 180);
    }

    return trimSiteNoise(normalizedTitle, siteTokens) || normalizedTitle;
  }

  function getSiteTitleTokens(domain) {
    const tokens = new Set(SITE_TITLE_TOKENS);
    const domainParts = String(domain || "")
      .split(".")
      .filter((part) => part && !["www", "com", "cn", "net", "org", "app", "io", "ai"].includes(part));
    domainParts.forEach((part) => tokens.add(part));
    return Array.from(tokens).filter(Boolean);
  }

  function trimSiteNoise(value, siteTokens) {
    let next = String(value || "").trim();
    for (const token of siteTokens) {
      const escaped = escapeRegExp(token);
      next = next
        .replace(new RegExp(`^${escaped}\\s*(?:搜索|search|博客)?\\s*$`, "iu"), "")
        .replace(new RegExp(`[_\\s-]*(?:${escaped})(?:\\s*(?:搜索|search|博客))?$`, "iu"), "")
        .replace(new RegExp(`^(?:${escaped})(?:\\s*(?:搜索|search|博客))?[_\\s-]*`, "iu"), "");
    }
    return next.replace(/\s+/g, " ").trim();
  }

  function trimTrailingSiteNoise(value, siteTokens) {
    let next = String(value || "").trim();
    for (const token of siteTokens) {
      const escaped = escapeRegExp(token);
      next = next
        .replace(new RegExp(`[_\\s-]+(?:${escaped})(?:\\s*(?:搜索|search|博客))?$`, "iu"), "")
        .replace(new RegExp(`^${escaped}\\s*(?:搜索|search|博客)?\\s*$`, "iu"), "");
    }
    return next.replace(/\s+/g, " ").trim();
  }

  function isSiteTitlePart(value, siteTokens) {
    const normalized = String(value || "").toLowerCase().replace(/\s+/g, " ").trim();
    return siteTokens.some((token) => {
      const normalizedToken = String(token || "").toLowerCase().trim();
      return normalized === normalizedToken
        || normalized === `${normalizedToken} search`
        || normalized === `${normalizedToken} 搜索`
        || normalized === `${normalizedToken}博客`;
    });
  }

  function escapeRegExp(value) {
    return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  function buildAiPayload(nodes, edges, settings, options = {}) {
    const normalizedSettings = mergeSettings(settings);
    const allowedPageIds = Array.isArray(options.pageIds) ? new Set(options.pageIds) : null;
    const language = String(options.language || "").trim();
    const safePages = Object.values(nodes || {})
      .filter((node) => (
        !node.sensitiveSkipped
        && !getSensitiveCategory(node.url, normalizedSettings)
        && !getExcludedAppCategory(node.url)
        && (!allowedPageIds || allowedPageIds.has(node.id))
      ))
      .slice(-80)
      .map((node) => ({
        id: node.id,
        title: node.title,
        domain: node.domain,
        urlPath: safeUrlPath(node.url),
        summary: node.summary,
        tags: node.tags,
        readingProgress: node.readingProgress,
        readStatus: node.readStatus,
        lastVisitTime: node.lastVisitTime
      }));
    const safeIds = new Set(safePages.map((page) => page.id));
    const safeEdges = (edges || [])
      .filter((edge) => safeIds.has(edge.fromPageId) && safeIds.has(edge.toPageId))
      .map((edge) => ({
        fromPageId: edge.fromPageId,
        toPageId: edge.toPageId,
        relationType: edge.relationType
      }));
    return { language, pages: safePages, edges: safeEdges };
  }

  function safeUrlPath(url) {
    try {
      const parsed = new URL(url);
      return `${parsed.hostname}${parsed.pathname}`.slice(0, 180);
    } catch (_error) {
      return "";
    }
  }

  function normalizeAiTopics(aiTopics, nodes) {
    if (!Array.isArray(aiTopics)) {
      return [];
    }

    return aiTopics.map((topic, index) => {
      const normalizedTopic = sanitizeTopic({
        id: topic.id || `t_ai_${stableId(`${topic.name || "topic"}_${index}`)}`,
        name: String(topic.name || `Research Topic ${index + 1}`).slice(0, 80),
        summary: String(topic.summary || "AI grouped from recent browsing.").slice(0, 240),
        pageIds: topic.pageIds,
        corePageIds: topic.corePageIds,
        todoPageIds: topic.todoPageIds,
        updatedAt: 0,
        confidence: typeof topic.confidence === "number" ? Math.max(0, Math.min(1, topic.confidence)) : 0
      }, { allowedPageIds: Object.keys(nodes || {}), nodes });
      normalizedTopic.updatedAt = normalizedTopic.pageIds.reduce((max, id) => Math.max(max, nodes[id]?.lastVisitTime || 0), 0) || Date.now();
      normalizedTopic.confidence = normalizedTopic.confidence || calculateTopicConfidence(normalizedTopic, nodes, []);
      return normalizedTopic;
    }).filter((topic) => topic.pageIds.length >= DEFAULT_SETTINGS.minTopicPages && topic.confidence >= DEFAULT_SETTINGS.minTopicConfidence);
  }

  function sanitizeTopics(topics, options = {}) {
    return (topics || [])
      .map((topic) => sanitizeTopic(topic, options))
      .filter((topic) => topic.pageIds.length >= Number(options.minTopicPages || DEFAULT_SETTINGS.minTopicPages));
  }

  function sanitizeTopic(topic, options = {}) {
    const allowedPageIds = options.allowedPageIds
      ? new Set(Array.from(options.allowedPageIds))
      : null;
    const nodes = options.nodes || {};
    const pageIds = uniquePageIds(
      topic?.pageIds,
      (id) => !allowedPageIds || allowedPageIds.has(id),
      (id) => normalizePageTitleKey(nodes[id]?.title)
    );
    const pageIdSet = new Set(pageIds);
    const corePageIds = Array.isArray(topic?.corePageIds)
      ? uniquePageIds(topic.corePageIds, (id) => pageIdSet.has(id)).slice(0, 5)
      : pageIds.slice(0, 3);
    const corePageIdSet = new Set(corePageIds);
    const todoPageIds = Array.isArray(topic?.todoPageIds)
      ? uniquePageIds(topic.todoPageIds, (id) => pageIdSet.has(id) && !corePageIdSet.has(id)).slice(0, 10)
      : pageIds.filter((id) => !corePageIdSet.has(id)).slice(0, 8);

    return {
      ...(topic || {}),
      pageIds,
      corePageIds,
      todoPageIds
    };
  }

  function uniquePageIds(pageIds, isAllowed, getDuplicateKey = null) {
    const seen = new Set();
    const seenDuplicateKeys = new Set();
    return (pageIds || []).filter((id) => {
      if (!id || seen.has(id) || !isAllowed(id)) {
        return false;
      }
      const duplicateKey = getDuplicateKey ? getDuplicateKey(id) : "";
      if (duplicateKey && seenDuplicateKeys.has(duplicateKey)) {
        return false;
      }
      seen.add(id);
      if (duplicateKey) {
        seenDuplicateKeys.add(duplicateKey);
      }
      return true;
    });
  }

  function normalizePageTitleKey(title) {
    return String(title || "")
      .toLowerCase()
      .replace(/\s+/g, " ")
      .trim();
  }

  function getExcludedAppCategory(url) {
    const domain = getDomain(url);
    if (!domain || RESEARCH_APP_HOSTS.some((host) => domain === host || domain.endsWith(`.${host}`))) {
      return "";
    }

    let pathname = "";
    try {
      pathname = new URL(url).pathname.toLowerCase();
    } catch (_error) {
      return "";
    }

    for (const rule of SAAS_APP_RULES) {
      const domainMatches = rule.domains.some((host) => domain === host || domain.endsWith(`.${host}`));
      if (!domainMatches) {
        continue;
      }

      if (!rule.patterns.length || rule.patterns.some((pattern) => pathname === pattern || pathname.startsWith(`${pattern}/`))) {
        return rule.category;
      }
    }

    return "";
  }

  function isLikelyResearchContent(url, payload, settings) {
    if (getExcludedAppCategory(url)) {
      return false;
    }

    const domain = getDomain(url);
    if (RESEARCH_APP_HOSTS.some((host) => domain === host || domain.endsWith(`.${host}`))) {
      return true;
    }

    const normalizedSettings = mergeSettings(settings);
    const metrics = payload?.contentMetrics || {};
    const summaryWordCount = countWords(payload?.summary || "");
    const wordCount = Math.max(Number(metrics.wordCount) || 0, summaryWordCount);
    const mediaCount = Number(metrics.mediaCount) || 0;
    const formControlCount = Number(metrics.formControlCount) || 0;
    const articleLike = Boolean(metrics.articleLike);
    const linkCount = Number(metrics.linkCount) || 0;
    const minWords = Number(normalizedSettings.minReadableWords || DEFAULT_SETTINGS.minReadableWords);

    if (articleLike && wordCount >= Math.max(35, Math.floor(minWords * 0.5))) {
      return true;
    }

    if (wordCount >= minWords) {
      return true;
    }

    if (wordCount >= Math.floor(minWords * 0.5) && mediaCount >= 2 && formControlCount <= 12) {
      return true;
    }

    if (wordCount < Math.floor(minWords * 0.5) && formControlCount >= 8) {
      return false;
    }

    return wordCount >= Math.floor(minWords * 0.75) && linkCount < Math.max(40, wordCount);
  }

  function countWords(text) {
    const matches = String(text || "").match(/[\p{L}\p{N}]+/gu);
    return matches ? matches.length : 0;
  }

  const api = {
    DEFAULT_SETTINGS,
    RESEARCH_APP_HOSTS,
    SAAS_APP_RULES,
    SENSITIVE_RULES,
    buildAiPayload,
    buildPageNode,
    calculateTopicConfidence,
    cleanPageTitle,
    deriveLocalTopics,
    getExcludedAppCategory,
    getDomain,
    getSensitiveCategory,
    inferEdgeType,
    isLikelyResearchContent,
    isSearchUrl,
    makeEdge,
    mergeSettings,
    normalizeAiTopics,
    normalizeUrl,
    sanitizeTopic,
    sanitizeTopics,
    stableId
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }

  global.HDIGHCore = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
