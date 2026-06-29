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
    minTopicConfidence: 0.35
  };

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
      parsed.hash = "";
      if (parsed.pathname !== "/") {
        parsed.pathname = parsed.pathname.replace(/\/+$/, "");
      }
      const removable = ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content", "fbclid", "gclid"];
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
    const title = input.title || existingNode?.title || getDomain(url) || "Untitled page";
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
      topic.todoPageIds = sortedPages
        .filter((page) => page.readStatus !== "read")
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

  function buildAiPayload(nodes, edges, settings) {
    const normalizedSettings = mergeSettings(settings);
    const safePages = Object.values(nodes || {})
      .filter((node) => !node.sensitiveSkipped && !getSensitiveCategory(node.url, normalizedSettings))
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
    return { pages: safePages, edges: safeEdges };
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
      const pageIds = Array.isArray(topic.pageIds)
        ? topic.pageIds.filter((id) => nodes[id])
        : [];
      const normalizedTopic = {
        id: topic.id || `t_ai_${stableId(`${topic.name || "topic"}_${index}`)}`,
        name: String(topic.name || `Research Topic ${index + 1}`).slice(0, 80),
        summary: String(topic.summary || "AI grouped from recent browsing.").slice(0, 240),
        pageIds,
        corePageIds: Array.isArray(topic.corePageIds)
          ? topic.corePageIds.filter((id) => nodes[id]).slice(0, 5)
          : pageIds.slice(0, 3),
        todoPageIds: Array.isArray(topic.todoPageIds)
          ? topic.todoPageIds.filter((id) => nodes[id]).slice(0, 10)
          : pageIds.slice(0, 8),
        updatedAt: Date.now(),
        confidence: typeof topic.confidence === "number" ? Math.max(0, Math.min(1, topic.confidence)) : 0
      };
      normalizedTopic.confidence = normalizedTopic.confidence || calculateTopicConfidence(normalizedTopic, nodes, []);
      return normalizedTopic;
    }).filter((topic) => topic.pageIds.length >= DEFAULT_SETTINGS.minTopicPages && topic.confidence >= DEFAULT_SETTINGS.minTopicConfidence);
  }

  const api = {
    DEFAULT_SETTINGS,
    SENSITIVE_RULES,
    buildAiPayload,
    buildPageNode,
    calculateTopicConfidence,
    deriveLocalTopics,
    getDomain,
    getSensitiveCategory,
    inferEdgeType,
    isSearchUrl,
    makeEdge,
    mergeSettings,
    normalizeAiTopics,
    normalizeUrl,
    stableId
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }

  global.HDIGHCore = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
