importScripts("src/core.js");

const {
  buildAiPayload,
  buildPageNode,
  deriveLocalTopics,
  getSensitiveCategory,
  inferEdgeType,
  makeEdge,
  mergeSettings,
  normalizeAiTopics,
  normalizeUrl,
  stableId
} = globalThis.HDIGHCore;

const STORAGE_KEYS = {
  nodes: "pageNodes",
  edges: "pageEdges",
  topics: "researchTopics",
  settings: "userSettings",
  tabPages: "tabPages",
  topicEdits: "topicEdits",
  lastAiRunAt: "lastAiRunAt"
};

const AI_API_KEY = "sk-ws-H.RYXMIDM.HBtr.MEQCIDYJuUAG__LSUiWUsKy0yMdf4chYLZtxN7ks2liozihLAiBCG7nGVuzKsQgRBbj1jm37wz06lLTorusVsdh3Bk7rew";
const AI_MODEL = "qwen3.7-plus";
const AI_ENDPOINT = "https://llm-4hryrnsg5f8wv91v.cn-beijing.maas.aliyuncs.com/compatible-mode/v1/chat/completions";

const tabSources = new Map();
let clusterTimer = null;

chrome.runtime.onInstalled.addListener(async () => {
  await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
  const state = await getState();
  await chrome.storage.local.set({
    [STORAGE_KEYS.settings]: mergeSettings(state.settings),
    [STORAGE_KEYS.nodes]: state.nodes,
    [STORAGE_KEYS.edges]: state.edges,
    [STORAGE_KEYS.topics]: state.topics,
    [STORAGE_KEYS.tabPages]: state.tabPages,
    [STORAGE_KEYS.topicEdits]: state.topicEdits
  });
});

chrome.tabs.onCreated.addListener((tab) => {
  if (tab.openerTabId) {
    tabSources.set(tab.id, { openerTabId: tab.openerTabId });
  }
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.url) {
    const existing = tabSources.get(tabId) || {};
    tabSources.set(tabId, { ...existing, pendingUrl: changeInfo.url });
  }

  if (changeInfo.status === "complete" && tab.url) {
    captureTab(tabId, tab).catch(console.error);
  }
});

chrome.tabs.onRemoved.addListener((tabId) => {
  tabSources.delete(tabId);
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || !message.type) {
    return false;
  }

  if (message.type === "PAGE_CONTEXT" && sender.tab?.id) {
    capturePageContext(sender.tab.id, sender.tab, message.payload).then(sendResponse).catch((error) => {
      console.error(error);
      sendResponse({ ok: false, error: String(error?.message || error) });
    });
    return true;
  }

  if (message.type === "GET_STATE") {
    getState().then(sendResponse).catch((error) => {
      console.error(error);
      sendResponse({ ok: false, error: String(error?.message || error) });
    });
    return true;
  }

  if (message.type === "UPDATE_SETTINGS") {
    updateSettings(message.payload || {}).then(sendResponse).catch((error) => {
      console.error(error);
      sendResponse({ ok: false, error: String(error?.message || error) });
    });
    return true;
  }

  if (message.type === "RUN_CLUSTERING") {
    runClustering({ forceAi: Boolean(message.forceAi) }).then(sendResponse).catch((error) => {
      console.error(error);
      sendResponse({ ok: false, error: String(error?.message || error) });
    });
    return true;
  }

  if (message.type === "RESTORE_TOPIC") {
    restoreTopic(message.topicId).then(sendResponse).catch((error) => {
      console.error(error);
      sendResponse({ ok: false, error: String(error?.message || error) });
    });
    return true;
  }

  if (message.type === "OPEN_PAGE") {
    openPage(message.pageId).then(sendResponse).catch((error) => {
      console.error(error);
      sendResponse({ ok: false, error: String(error?.message || error) });
    });
    return true;
  }

  if (message.type === "DELETE_TOPIC") {
    deleteTopic(message.topicId).then(sendResponse).catch((error) => {
      console.error(error);
      sendResponse({ ok: false, error: String(error?.message || error) });
    });
    return true;
  }

  if (message.type === "REMOVE_PAGE_FROM_TOPIC") {
    removePageFromTopic(message.topicId, message.pageId).then(sendResponse).catch((error) => {
      console.error(error);
      sendResponse({ ok: false, error: String(error?.message || error) });
    });
    return true;
  }

  if (message.type === "MARK_PAGE") {
    markPage(message.pageId, message.patch || {}).then(sendResponse).catch((error) => {
      console.error(error);
      sendResponse({ ok: false, error: String(error?.message || error) });
    });
    return true;
  }

  return false;
});

async function captureTab(tabId, tab) {
  if (!tab.url || !isTrackableUrl(tab.url)) {
    return;
  }

  let payload = {
    url: tab.url,
    title: tab.title || "",
    referrerUrl: ""
  };

  try {
    const response = await chrome.tabs.sendMessage(tabId, { type: "REQUEST_PAGE_CONTEXT" });
    if (response?.ok && response.payload) {
      payload = { ...payload, ...response.payload };
    }
  } catch (_error) {
    // Some pages, such as the Chrome Web Store, cannot receive content script messages.
  }

  await capturePageContext(tabId, tab, payload);
}

async function capturePageContext(tabId, tab, payload) {
  const url = normalizeUrl(payload.url || tab.url);
  if (!url || !isTrackableUrl(url)) {
    return { ok: true, skipped: true };
  }

  const state = await getState();
  const settings = mergeSettings(state.settings);
  const sensitiveCategory = getSensitiveCategory(url, settings);
  if (sensitiveCategory) {
    return { ok: true, skipped: true, reason: sensitiveCategory };
  }

  const existingNode = state.nodes[stableId(url)];
  const node = buildPageNode({
    url,
    title: payload.title || tab.title,
    summary: payload.summary || "",
    tags: payload.tags || [],
    readingProgress: payload.readingProgress || 0,
    timestamp: Date.now()
  }, existingNode);

  const source = tabSources.get(tabId) || {};
  let openerUrl = "";
  if (source.openerTabId && state.tabPages[source.openerTabId]) {
    openerUrl = state.nodes[state.tabPages[source.openerTabId]]?.url || "";
  }

  const relationType = inferEdgeType({
    openerUrl,
    referrerUrl: payload.referrerUrl || "",
    url
  });
  const sourceUrl = openerUrl || payload.referrerUrl || "";
  const sourceId = sourceUrl ? stableId(normalizeUrl(sourceUrl)) : "";
  if (sourceUrl && !state.nodes[sourceId] && !getSensitiveCategory(sourceUrl, settings)) {
    state.nodes[sourceId] = buildPageNode({
      url: sourceUrl,
      title: new URL(sourceUrl).hostname,
      timestamp: Date.now()
    }, null);
  }
  const edge = makeEdge(sourceId, node.id, relationType);
  const edges = edge && state.nodes[sourceId] && !state.edges.some((item) => item.id === edge.id)
    ? [...state.edges, edge]
    : state.edges;

  state.nodes[node.id] = node;
  state.tabPages[tabId] = node.id;

  await chrome.storage.local.set({
    [STORAGE_KEYS.nodes]: state.nodes,
    [STORAGE_KEYS.edges]: edges,
    [STORAGE_KEYS.tabPages]: state.tabPages
  });

  scheduleClustering();
  return { ok: true, node };
}

async function getState() {
  const raw = await chrome.storage.local.get([
    STORAGE_KEYS.nodes,
    STORAGE_KEYS.edges,
    STORAGE_KEYS.topics,
    STORAGE_KEYS.settings,
    STORAGE_KEYS.tabPages,
    STORAGE_KEYS.topicEdits,
    STORAGE_KEYS.lastAiRunAt
  ]);

  return {
    ok: true,
    nodes: raw[STORAGE_KEYS.nodes] || {},
    edges: raw[STORAGE_KEYS.edges] || [],
    topics: raw[STORAGE_KEYS.topics] || [],
    settings: mergeSettings(raw[STORAGE_KEYS.settings]),
    tabPages: raw[STORAGE_KEYS.tabPages] || {},
    topicEdits: normalizeTopicEdits(raw[STORAGE_KEYS.topicEdits]),
    lastAiRunAt: raw[STORAGE_KEYS.lastAiRunAt] || 0
  };
}

async function updateSettings(patch) {
  const state = await getState();
  const settings = mergeSettings({ ...state.settings, ...patch });
  await chrome.storage.local.set({ [STORAGE_KEYS.settings]: settings });
  scheduleClustering(100);
  return { ok: true, settings };
}

function scheduleClustering(delay = 2500) {
  if (clusterTimer) {
    clearTimeout(clusterTimer);
  }
  clusterTimer = setTimeout(() => {
    runClustering({ forceAi: false }).catch(console.error);
  }, delay);
}

async function runClustering({ forceAi = false } = {}) {
  const state = await getState();
  const localTopics = deriveLocalTopics(state.nodes, state.edges);
  let topics = localTopics;

  const canUseAi = state.settings.aiConsentGranted
    && state.settings.aiEnabled
    && AI_API_KEY
    && (forceAi || Date.now() - state.lastAiRunAt > 10 * 60 * 1000);

  if (canUseAi) {
    const aiTopics = await requestAiTopics(state);
    if (aiTopics.length) {
      topics = aiTopics;
    }
    await chrome.storage.local.set({ [STORAGE_KEYS.lastAiRunAt]: Date.now() });
  }

  topics = applyTopicEdits(topics, state.topicEdits);

  const nodesWithMembership = applyTopicMembership(state.nodes, topics);
  const edgesWithTopics = addSameTopicEdges(state.edges, topics);

  await chrome.storage.local.set({
    [STORAGE_KEYS.nodes]: nodesWithMembership,
    [STORAGE_KEYS.edges]: edgesWithTopics,
    [STORAGE_KEYS.topics]: topics
  });
  return { ok: true, topics, aiUsed: canUseAi };
}

async function requestAiTopics(state) {
  const payload = buildAiPayload(state.nodes, state.edges, state.settings);
  if (!payload.pages.length) {
    return [];
  }

  const response = await fetch(AI_ENDPOINT, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${AI_API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: AI_MODEL,
      messages: [
        {
          role: "system",
          content: "Group browsing pages into research topics. Return only valid JSON with a topics array. Each topic has id, name, summary, pageIds, corePageIds, todoPageIds, confidence. Use only supplied page ids. Only create topics with at least two pages. confidence is a 0 to 1 score based on page relatedness and browsing engagement."
        },
        {
          role: "user",
          content: JSON.stringify(payload)
        }
      ],
      response_format: { type: "json_object" }
    })
  });

  if (!response.ok) {
    throw new Error(`AI request failed: ${response.status}`);
  }

  const data = await response.json();
  const text = data.choices?.[0]?.message?.content || "{}";
  const parsed = JSON.parse(text);
  return normalizeAiTopics(parsed.topics, state.nodes);
}

function applyTopicMembership(nodes, topics) {
  const nextNodes = { ...nodes };
  for (const node of Object.values(nextNodes)) {
    node.topicIds = [];
  }
  for (const topic of topics) {
    for (const pageId of topic.pageIds) {
      if (nextNodes[pageId]) {
        nextNodes[pageId] = {
          ...nextNodes[pageId],
          topicIds: Array.from(new Set([...(nextNodes[pageId].topicIds || []), topic.id]))
        };
      }
    }
  }
  return nextNodes;
}

function addSameTopicEdges(edges, topics) {
  const nextEdges = (edges || []).filter((edge) => edge.relationType !== "same_topic");
  const seen = new Set(nextEdges.map((edge) => edge.id));

  for (const topic of topics) {
    const coreId = topic.corePageIds?.[0] || topic.pageIds?.[0];
    if (!coreId) {
      continue;
    }

    for (const pageId of topic.pageIds || []) {
      const edge = makeEdge(coreId, pageId, "same_topic");
      if (edge && !seen.has(edge.id)) {
        nextEdges.push(edge);
        seen.add(edge.id);
      }
    }
  }

  return nextEdges;
}

function normalizeTopicEdits(topicEdits) {
  return {
    deletedTopicIds: Array.isArray(topicEdits?.deletedTopicIds) ? topicEdits.deletedTopicIds : [],
    removedPagesByTopicId: topicEdits?.removedPagesByTopicId && typeof topicEdits.removedPagesByTopicId === "object"
      ? topicEdits.removedPagesByTopicId
      : {}
  };
}

function applyTopicEdits(topics, topicEdits) {
  const edits = normalizeTopicEdits(topicEdits);
  const deletedTopicIds = new Set(edits.deletedTopicIds);

  return (topics || [])
    .filter((topic) => !deletedTopicIds.has(topic.id))
    .map((topic) => {
      const removedPageIds = new Set(edits.removedPagesByTopicId[topic.id] || []);
      const pageIds = (topic.pageIds || []).filter((id) => !removedPageIds.has(id));
      const pageIdSet = new Set(pageIds);
      return {
        ...topic,
        pageIds,
        corePageIds: (topic.corePageIds || []).filter((id) => pageIdSet.has(id)),
        todoPageIds: (topic.todoPageIds || []).filter((id) => pageIdSet.has(id))
      };
    })
    .filter((topic) => topic.pageIds.length >= 2);
}

async function deleteTopic(topicId) {
  const state = await getState();
  const topic = state.topics.find((item) => item.id === topicId);
  if (!topic) {
    return { ok: false, error: "Topic not found" };
  }

  const topicEdits = normalizeTopicEdits(state.topicEdits);
  topicEdits.deletedTopicIds = Array.from(new Set([...topicEdits.deletedTopicIds, topicId]));
  const topics = state.topics.filter((item) => item.id !== topicId);
  const nodes = applyTopicMembership(state.nodes, topics);
  const edges = addSameTopicEdges(state.edges, topics);

  await chrome.storage.local.set({
    [STORAGE_KEYS.topicEdits]: topicEdits,
    [STORAGE_KEYS.nodes]: nodes,
    [STORAGE_KEYS.edges]: edges,
    [STORAGE_KEYS.topics]: topics
  });
  return { ok: true };
}

async function removePageFromTopic(topicId, pageId) {
  const state = await getState();
  const topic = state.topics.find((item) => item.id === topicId);
  if (!topic) {
    return { ok: false, error: "Topic not found" };
  }
  if (!topic.pageIds.includes(pageId)) {
    return { ok: false, error: "Page is not in topic" };
  }

  const topicEdits = normalizeTopicEdits(state.topicEdits);
  const removedPageIds = new Set(topicEdits.removedPagesByTopicId[topicId] || []);
  removedPageIds.add(pageId);
  topicEdits.removedPagesByTopicId = {
    ...topicEdits.removedPagesByTopicId,
    [topicId]: Array.from(removedPageIds)
  };

  let topics = applyTopicEdits(state.topics, topicEdits);
  if (!topics.some((item) => item.id === topicId)) {
    topicEdits.deletedTopicIds = Array.from(new Set([...topicEdits.deletedTopicIds, topicId]));
    topics = topics.filter((item) => item.id !== topicId);
  }

  const nodes = applyTopicMembership(state.nodes, topics);
  const edges = addSameTopicEdges(state.edges, topics);

  await chrome.storage.local.set({
    [STORAGE_KEYS.topicEdits]: topicEdits,
    [STORAGE_KEYS.nodes]: nodes,
    [STORAGE_KEYS.edges]: edges,
    [STORAGE_KEYS.topics]: topics
  });
  return { ok: true, topicRemoved: !topics.some((item) => item.id === topicId) };
}

async function restoreTopic(topicId) {
  const state = await getState();
  const topic = state.topics.find((item) => item.id === topicId);
  if (!topic) {
    return { ok: false, error: "Topic not found" };
  }

  const limit = Number(state.settings.restoreLimit || 8);
  const pageIds = Array.from(new Set([...(topic.corePageIds || []), ...(topic.todoPageIds || [])])).slice(0, limit);
  const urls = pageIds.map((id) => state.nodes[id]?.url).filter(Boolean);

  for (const url of urls) {
    await chrome.tabs.create({ url, active: false });
  }

  return { ok: true, opened: urls.length };
}

async function openPage(pageId) {
  const state = await getState();
  const page = state.nodes[pageId];
  if (!page?.url) {
    return { ok: false, error: "Page not found" };
  }

  await chrome.tabs.create({ url: page.url, active: true });
  return { ok: true, url: page.url };
}

async function markPage(pageId, patch) {
  const state = await getState();
  if (!state.nodes[pageId]) {
    return { ok: false, error: "Page not found" };
  }

  state.nodes[pageId] = {
    ...state.nodes[pageId],
    ...patch,
    lastVisitTime: Date.now()
  };

  await chrome.storage.local.set({ [STORAGE_KEYS.nodes]: state.nodes });
  scheduleClustering(100);
  return { ok: true, node: state.nodes[pageId] };
}

function isTrackableUrl(url) {
  return /^https?:\/\//i.test(url || "");
}
