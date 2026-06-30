const core = window.HDIGHCore;

const elements = {
  acceptAiButton: document.querySelector("#acceptAiButton"),
  addBlacklistButton: document.querySelector("#addBlacklistButton"),
  aiToggle: document.querySelector("#aiToggle"),
  averageConfidenceText: document.querySelector("#averageConfidenceText"),
  blacklistForm: document.querySelector("#blacklistForm"),
  blacklistInput: document.querySelector("#blacklistInput"),
  blacklistList: document.querySelector("#blacklistList"),
  cancelBlacklistButton: document.querySelector("#cancelBlacklistButton"),
  closeBlacklistButton: document.querySelector("#closeBlacklistButton"),
  consentPanel: document.querySelector("#consentPanel"),
  declineAiButton: document.querySelector("#declineAiButton"),
  lastUpdatedText: document.querySelector("#lastUpdatedText"),
  localToggle: document.querySelector("#localToggle"),
  processedPagesCount: document.querySelector("#processedPagesCount"),
  refreshCooldownText: document.querySelector("#refreshCooldownText"),
  refreshButton: document.querySelector("#refreshButton"),
  refreshIntervalText: document.querySelector("#refreshIntervalText"),
  saveSettingsButton: document.querySelector("#saveSettingsButton"),
  settingsButton: document.querySelector("#settingsButton"),
  settingsPanel: document.querySelector("#settingsPanel"),
  statusPanel: document.querySelector("#statusMessage"),
  topicDetail: document.querySelector("#topicDetail"),
  topicsFoundCount: document.querySelector("#topicsFoundCount"),
  topicsList: document.querySelector("#topicsList")
};

let appState = null;
let pendingDeleteTopicId = "";
let pendingBlacklistPageId = "";
let pendingRemovePageId = "";
let expandedTopicId = "";
let refreshMetaTimer = null;

document.addEventListener("DOMContentLoaded", () => {
  bindEvents();
  loadState();
});

function bindEvents() {
  elements.acceptAiButton.addEventListener("click", async () => {
    await sendMessage({ type: "UPDATE_SETTINGS", payload: { aiConsentGranted: true, aiEnabled: true } });
    await sendMessage({ type: "RUN_CLUSTERING", forceAi: true });
    await loadState();
  });

  elements.declineAiButton.addEventListener("click", async () => {
    await sendMessage({ type: "UPDATE_SETTINGS", payload: { aiConsentGranted: false, aiEnabled: false } });
    await loadState();
  });

  elements.aiToggle.addEventListener("change", async () => {
    await sendMessage({
      type: "UPDATE_SETTINGS",
      payload: {
        aiEnabled: elements.aiToggle.checked,
        aiConsentGranted: elements.aiToggle.checked ? true : appState.settings.aiConsentGranted
      }
    });
    await loadState();
  });

  elements.localToggle.addEventListener("change", async () => {
    await sendMessage({
      type: "UPDATE_SETTINGS",
      payload: {
        localClusteringEnabled: elements.localToggle.checked
      }
    });
    await loadState();
  });

  elements.refreshButton.addEventListener("click", async () => {
    setStatus("Refreshing topics...");
    await sendMessage({ type: "RUN_CLUSTERING", forceAi: true });
    await loadState();
  });

  elements.settingsButton.addEventListener("click", () => {
    showBlacklistPage();
  });

  elements.closeBlacklistButton.addEventListener("click", () => {
    hideBlacklistPage();
  });

  elements.addBlacklistButton.addEventListener("click", () => {
    elements.blacklistForm.classList.remove("hidden");
    elements.addBlacklistButton.classList.add("hidden");
    elements.blacklistInput.value = "";
    elements.blacklistInput.focus();
  });

  elements.cancelBlacklistButton.addEventListener("click", () => {
    resetBlacklistForm();
  });

  elements.saveSettingsButton.addEventListener("click", async () => {
    const domain = normalizeBlacklistDomain(elements.blacklistInput.value);
    if (!domain) {
      setStatus("Enter a domain to add to the blacklist.");
      return;
    }
    await addDomainToBlacklist(domain);
    resetBlacklistForm();
  });

  elements.blacklistInput.addEventListener("keydown", async (event) => {
    if (event.key !== "Enter") {
      return;
    }
    event.preventDefault();
    elements.saveSettingsButton.click();
  });

  elements.topicsList.addEventListener("click", handleTopicsListClick);
  elements.topicsList.addEventListener("keydown", handleTopicsListKeydown);
}

async function loadState() {
  const state = await sendMessage({ type: "GET_STATE" });
  appState = state;
  elements.aiToggle.checked = Boolean(state.settings.aiEnabled && state.settings.aiConsentGranted);
  elements.localToggle.checked = Boolean(state.settings.localClusteringEnabled);
  elements.consentPanel.classList.toggle("hidden", state.settings.aiConsentGranted || state.settings.aiEnabled === false);
  renderRefreshMeta();
  renderStats();
  renderBlacklist();
  renderTopics();
}

function renderRefreshMeta() {
  if (refreshMetaTimer) {
    clearInterval(refreshMetaTimer);
  }
  refreshMetaTimer = setInterval(renderRefreshMetaText, 60000);
  renderRefreshMetaText();
}

function renderRefreshMetaText() {
  const intervalMinutes = Number(appState?.settings?.aiRefreshIntervalMinutes || core.DEFAULT_SETTINGS.aiRefreshIntervalMinutes || 10);
  const lastAiRunAt = Number(appState?.lastAiRunAt || 0);
  const aiOn = Boolean(appState?.settings?.aiEnabled && appState?.settings?.aiConsentGranted);
  const nodeCount = Object.keys(appState?.nodes || {}).length;
  const topicCount = (appState?.topics || []).length;

  elements.refreshCooldownText.textContent = aiOn
    ? lastAiRunAt
      ? `AI refreshed ${formatAgo(lastAiRunAt)}`
      : "AI refresh ready"
    : "AI grouping is off";
  elements.refreshIntervalText.textContent = topicCount
    ? `Grouped ${nodeCount} pages into ${topicCount} topics`
    : `Default AI interval: ${intervalMinutes} min`;
}

function renderStats() {
  const topics = appState?.topics || [];
  const nodeCount = Object.keys(appState?.nodes || {}).length;
  const confidences = topics.map((topic) => Number(topic.confidence || 0)).filter((value) => value > 0);
  const avgConfidence = confidences.length
    ? Math.round(confidences.reduce((sum, value) => sum + value, 0) / confidences.length * 100)
    : 0;
  const latestUpdatedAt = topics.reduce((latest, topic) => Math.max(latest, Number(topic.updatedAt || 0)), 0);

  elements.processedPagesCount.textContent = String(nodeCount);
  elements.topicsFoundCount.textContent = String(topics.length);
  elements.averageConfidenceText.textContent = `${avgConfidence}%`;
  elements.lastUpdatedText.textContent = latestUpdatedAt ? formatRelativeDay(latestUpdatedAt) : "Today";
}

function renderTopics() {
  const topics = appState.topics || [];
  const nodeCount = Object.keys(appState.nodes || {}).length;
  if (pendingDeleteTopicId && !topics.some((topic) => topic.id === pendingDeleteTopicId)) {
    pendingDeleteTopicId = "";
  }

  if (!topics.length) {
    setStatus(nodeCount
      ? "Pages are being collected. Refresh to build topics."
      : "Browse a few research pages, then open this panel again.");
    elements.topicsList.innerHTML = `<div class="empty-state">No research topics yet. Open a few related pages and this panel will turn them into a research trail.</div>`;
    return;
  }

  if (expandedTopicId && !topics.some((topic) => topic.id === expandedTopicId)) {
    expandedTopicId = "";
  }

  setStatus(`${topics.length} research ${topics.length === 1 ? "topic" : "topics"} from ${nodeCount} recorded pages.`);
  elements.topicsList.innerHTML = topics.map((topic, index) => renderTopicCard(topic, index)).join("");
  elements.topicsList.querySelectorAll("[data-open-topic-id]").forEach((card) => {
    card.addEventListener("click", (event) => {
      if (isInteractiveTarget(event.target)) {
        return;
      }
      showTopic(card.dataset.openTopicId);
    });
    card.addEventListener("keydown", (event) => {
      if (isInteractiveTarget(event.target)) {
        return;
      }
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        showTopic(card.dataset.openTopicId);
      }
    });
  });
  elements.topicsList.querySelectorAll("[data-delete-topic-id]").forEach((button) => {
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      const topic = appState.topics.find((item) => item.id === button.dataset.deleteTopicId);
      if (!topic) {
        return;
      }
      pendingDeleteTopicId = topic.id;
      renderTopics();
      elements.topicsList.querySelector(`[data-confirm-delete-topic-id="${cssEscape(topic.id)}"]`)?.focus();
    });
  });
  elements.topicsList.querySelectorAll("[data-cancel-delete-topic-id]").forEach((button) => {
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      pendingDeleteTopicId = "";
      renderTopics();
    });
  });
  elements.topicsList.querySelectorAll("[data-confirm-delete-topic-id]").forEach((button) => {
    button.addEventListener("click", async (event) => {
      event.stopPropagation();
      const topic = appState.topics.find((item) => item.id === button.dataset.confirmDeleteTopicId);
      if (!topic) {
        pendingDeleteTopicId = "";
        renderTopics();
        return;
      }
      pendingDeleteTopicId = "";
      const result = await sendMessage({ type: "DELETE_TOPIC", topicId: topic.id });
      setStatus(result.ok ? `Deleted topic "${topic.name}".` : result.error);
      await loadState();
      elements.topicDetail.classList.add("hidden");
    });
  });
}

function renderTopicCard(topic) {
  const updated = new Date(topic.updatedAt || Date.now()).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
  const confidence = Math.round((topic.confidence || 0) * 100);
  const isConfirmingDelete = pendingDeleteTopicId === topic.id;
  return `
    <article class="topic-card" data-open-topic-id="${escapeHtml(topic.id)}" role="button" tabindex="0" aria-label="Open ${escapeHtml(topic.name)}">
      <div class="topic-title-row">
        <div>
          <h2>${escapeHtml(topic.name)}</h2>
          <p class="topic-summary">${escapeHtml(topic.summary || "Grouped from your browsing path.")}</p>
        </div>
        <span class="count-pill">${topic.pageIds.length} pages</span>
      </div>
      <div class="meta-row">
        <span>${topic.corePageIds.length} core</span>
        <span>${topic.todoPageIds.length} to read</span>
        <span>${confidence}% confidence</span>
        <span>${updated}</span>
      </div>
      <div class="card-actions">
        ${isConfirmingDelete ? `
          <div class="delete-confirm-popover" role="alertdialog" aria-label="Confirm delete topic">
            <span>是否确认删除</span>
            <button class="danger-button compact-button" data-confirm-delete-topic-id="${escapeHtml(topic.id)}">确认</button>
            <button class="secondary-button compact-button" data-cancel-delete-topic-id="${escapeHtml(topic.id)}">取消</button>
          </div>
        ` : `<button class="danger-button compact-button" data-delete-topic-id="${escapeHtml(topic.id)}">Delete</button>`}
      </div>
    </article>
  `;
}

function showTopic(topicId) {
  const topic = appState.topics.find((item) => item.id === topicId);
  if (!topic) {
    return;
  }
  if (pendingBlacklistPageId && !(topic.pageIds || []).includes(pendingBlacklistPageId)) {
    pendingBlacklistPageId = "";
  }
  if (pendingRemovePageId && !(topic.pageIds || []).includes(pendingRemovePageId)) {
    pendingRemovePageId = "";
  }

  const pageGroups = getTopicPageGroups(topic);

  elements.topicDetail.innerHTML = `
    <div class="detail-header">
      <div>
        <p class="eyebrow">Topic tree</p>
        <h1>${escapeHtml(topic.name)}</h1>
        <p class="topic-summary">${escapeHtml(topic.summary || "")}</p>
      </div>
      <button class="icon-button" id="closeDetailButton" aria-label="Close topic" title="Close">Close</button>
    </div>
    <div class="detail-actions">
      <button class="primary-button" id="restoreTopicButton">Continue research</button>
      <button class="secondary-button" id="refreshTopicButton">Regroup</button>
    </div>
    <div class="confidence-row">
      <span>Confidence</span>
      <strong>${Math.round((topic.confidence || 0) * 100)}%</strong>
    </div>
    ${renderPageGroup("Core pages", pageGroups.corePages, topic.id)}
    ${renderPageGroup("To read", pageGroups.todoPages, topic.id)}
    ${renderPageGroup("Related pages", pageGroups.otherPages, topic.id)}
  `;

  elements.topicDetail.classList.remove("hidden");
  document.querySelector("#closeDetailButton").addEventListener("click", () => elements.topicDetail.classList.add("hidden"));
  document.querySelector("#restoreTopicButton").addEventListener("click", async () => {
    const result = await sendMessage({ type: "RESTORE_TOPIC", topicId });
    setStatus(result.ok ? `Opened ${result.opened} pages for ${topic.name}.` : result.error);
  });
  document.querySelector("#refreshTopicButton").addEventListener("click", async () => {
    await sendMessage({ type: "RUN_CLUSTERING", forceAi: true });
    await loadState();
    elements.topicDetail.classList.add("hidden");
  });
  elements.topicDetail.querySelectorAll("[data-open-page-id]").forEach((button) => {
    button.addEventListener("click", async (event) => {
      if (isInteractiveTarget(event.target)) {
        return;
      }
      const page = appState.nodes[button.dataset.openPageId];
      const result = await sendMessage({ type: "OPEN_PAGE", pageId: button.dataset.openPageId });
      setStatus(result.ok ? `Opened ${page?.title || "page"}.` : result.error);
    });
    button.addEventListener("keydown", async (event) => {
      if (isInteractiveTarget(event.target)) {
        return;
      }
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        const page = appState.nodes[button.dataset.openPageId];
        const result = await sendMessage({ type: "OPEN_PAGE", pageId: button.dataset.openPageId });
        setStatus(result.ok ? `Opened ${page?.title || "page"}.` : result.error);
      }
    });
  });
  elements.topicDetail.querySelectorAll("[data-remove-page-id]").forEach((button) => {
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      const pageId = button.dataset.removePageId;
      if (!pageId) {
        return;
      }
      pendingRemovePageId = pageId;
      pendingBlacklistPageId = "";
      showTopic(topicId);
      elements.topicDetail.querySelector(`[data-confirm-remove-page-id="${cssEscape(pageId)}"]`)?.focus();
    });
  });
  elements.topicDetail.querySelectorAll("[data-cancel-remove-page-id]").forEach((button) => {
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      pendingRemovePageId = "";
      showTopic(topicId);
    });
  });
  elements.topicDetail.querySelectorAll("[data-confirm-remove-page-id]").forEach((button) => {
    button.addEventListener("click", async (event) => {
      event.stopPropagation();
      const pageId = button.dataset.confirmRemovePageId;
      const page = appState.nodes[pageId];
      pendingRemovePageId = "";
      if (!page) {
        showTopic(topicId);
        return;
      }
      const result = await sendMessage({
        type: "REMOVE_PAGE_FROM_TOPIC",
        topicId,
        pageId
      });
      setStatus(result.ok
        ? result.topicRemoved
          ? `Removed page and deleted "${topic.name}" because it had fewer than 2 pages.`
          : `Removed "${page.title}" from "${topic.name}".`
        : result.error);
      await loadState();
      if (result.topicRemoved) {
        elements.topicDetail.classList.add("hidden");
      } else {
        showTopic(topicId);
      }
    });
  });
  elements.topicDetail.querySelectorAll("[data-blacklist-domain]").forEach((button) => {
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      const pageId = button.dataset.blacklistPageId;
      if (!pageId) {
        return;
      }
      pendingBlacklistPageId = pageId;
      pendingRemovePageId = "";
      showTopic(topicId);
      elements.topicDetail.querySelector(`[data-confirm-blacklist-page-id="${cssEscape(pageId)}"]`)?.focus();
    });
  });
  elements.topicDetail.querySelectorAll("[data-cancel-blacklist-page-id]").forEach((button) => {
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      pendingBlacklistPageId = "";
      showTopic(topicId);
    });
  });
  elements.topicDetail.querySelectorAll("[data-confirm-blacklist-page-id]").forEach((button) => {
    button.addEventListener("click", async (event) => {
      event.stopPropagation();
      const pageId = button.dataset.confirmBlacklistPageId;
      const domain = normalizeBlacklistDomain(button.dataset.blacklistDomain);
      pendingBlacklistPageId = "";
      if (!pageId || !domain) {
        showTopic(topicId);
        return;
      }
      await addDomainToBlacklist(domain);
      const stillExists = appState.topics.some((item) => item.id === topicId);
      if (stillExists) {
        showTopic(topicId);
      } else {
        elements.topicDetail.classList.add("hidden");
      }
    });
  });
}

function renderPageGroup(title, pages, topicId) {
  if (!pages.length) {
    return "";
  }

  return `
    <section class="page-group">
      <h2>${escapeHtml(title)}</h2>
      <div class="page-list">
        ${pages.map((page) => renderPage(page, topicId, getOtherTopicNames(page.id, topicId))).join("")}
      </div>
    </section>
  `;
}

function renderPage(page, topicId, otherTopicNames = []) {
  const edges = appState.edges.filter((edge) => edge.toPageId === page.id || edge.fromPageId === page.id);
  const relations = edges.map((edge) => describeEdge(edge, page.id)).filter(Boolean);
  const isConfirmingBlacklist = pendingBlacklistPageId === page.id;
  const isConfirmingRemove = pendingRemovePageId === page.id;
  const tags = [
    page.importance,
    page.readStatus,
    `${Math.round((page.readingProgress || 0) * 100)}%`
  ].concat(page.tags || []).slice(0, 6);

  return `
    <article class="page-item" data-open-page-id="${escapeHtml(page.id)}" role="button" tabindex="0" aria-label="Open ${escapeHtml(page.title)}">
      <div class="page-header">
        <div>
          <div class="page-title">${escapeHtml(page.title)}</div>
          <div class="page-domain">${escapeHtml(page.domain)}</div>
        </div>
        <div class="page-actions">
          ${isConfirmingBlacklist ? `
            <div class="delete-confirm-popover" role="alertdialog" aria-label="Confirm blacklist domain">
              <span>Block ${escapeHtml(page.domain)}?</span>
              <button class="danger-button compact-button" data-confirm-blacklist-page-id="${escapeHtml(page.id)}" data-blacklist-domain="${escapeHtml(page.domain)}">Confirm</button>
              <button class="secondary-button compact-button" data-cancel-blacklist-page-id="${escapeHtml(page.id)}">Cancel</button>
            </div>
          ` : isConfirmingRemove ? `
            <div class="delete-confirm-popover" role="alertdialog" aria-label="Confirm remove page">
              <span>Remove from topic?</span>
              <button class="danger-button compact-button" data-confirm-remove-page-id="${escapeHtml(page.id)}">Confirm</button>
              <button class="secondary-button compact-button" data-cancel-remove-page-id="${escapeHtml(page.id)}">Cancel</button>
            </div>
          ` : `
            <button class="blacklist-page-button" data-blacklist-page-id="${escapeHtml(page.id)}" data-blacklist-domain="${escapeHtml(page.domain)}" title="Add domain to blacklist">Blacklist</button>
            <button class="remove-page-button" data-remove-page-id="${escapeHtml(page.id)}" data-topic-id="${escapeHtml(topicId)}" title="Remove from topic">Remove</button>
          `}
        </div>
      </div>
      <div class="tag-row">${tags.map((tag) => `<span class="tag">${escapeHtml(tag)}</span>`).join("")}</div>
      ${otherTopicNames.length ? `<p class="also-in-topic">还收录于 ${otherTopicNames.map((name) => escapeHtml(name)).join("、")} 话题</p>` : ""}
      ${page.summary ? `<p class="topic-summary">${escapeHtml(page.summary).slice(0, 180)}</p>` : ""}
      ${relations.length ? `<ul class="relation-list">${relations.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>` : ""}
    </article>
  `;
}

function getTopicPageGroups(topic) {
  const sanitizedTopic = core.sanitizeTopic(topic, { allowedPageIds: Object.keys(appState.nodes || {}) });
  const coreIds = sanitizedTopic.corePageIds;
  const todoIds = sanitizedTopic.todoPageIds;
  const usedIds = new Set([...coreIds, ...todoIds]);
  const otherIds = sanitizedTopic.pageIds.filter((id) => !usedIds.has(id));

  return {
    corePages: idsToPages(coreIds),
    todoPages: idsToPages(todoIds),
    otherPages: idsToPages(otherIds)
  };
}

function getOtherTopicNames(pageId, currentTopicId) {
  return (appState.topics || [])
    .filter((topic) => topic.id !== currentTopicId && (topic.pageIds || []).includes(pageId))
    .map((topic) => topic.name)
    .filter(Boolean)
    .slice(0, 3);
}

function idsToPages(pageIds) {
  return pageIds.map((id) => appState.nodes[id]).filter(Boolean);
}

function describeEdge(edge, currentPageId) {
  const otherId = edge.fromPageId === currentPageId ? edge.toPageId : edge.fromPageId;
  const other = appState.nodes[otherId];
  if (!other) {
    return "";
  }
  const direction = edge.toPageId === currentPageId ? "From" : "To";
  const label = edge.relationType === "search_result"
    ? "search result"
    : edge.relationType === "clicked_from"
      ? "clicked path"
      : edge.relationType;
  return `${direction} ${other.title || other.domain} - ${label}`;
}

function showBlacklistPage() {
  renderBlacklist();
  elements.settingsPanel.classList.remove("hidden");
}

function hideBlacklistPage() {
  elements.settingsPanel.classList.add("hidden");
  resetBlacklistForm();
}

function renderBlacklist() {
  const domainBlacklist = appState?.settings?.domainBlacklist || [];
  elements.blacklistList.innerHTML = domainBlacklist.length
    ? domainBlacklist.map((domain) => `
      <div class="blacklist-item">
        <span>${escapeHtml(domain)}</span>
        <button class="danger-button compact-button" data-remove-blacklist-domain="${escapeHtml(domain)}">Remove</button>
      </div>
    `).join("")
    : `<div class="empty-state">No blacklisted domains yet.</div>`;

  elements.blacklistList.querySelectorAll("[data-remove-blacklist-domain]").forEach((button) => {
    button.addEventListener("click", async () => {
      const domain = button.dataset.removeBlacklistDomain;
      const domainBlacklist = (appState.settings.domainBlacklist || []).filter((item) => item !== domain);
      await updateDomainBlacklist(domainBlacklist, `Removed "${domain}" from the blacklist.`);
    });
  });
}

async function addDomainToBlacklist(domain) {
  const domainBlacklist = Array.from(new Set([...(appState.settings.domainBlacklist || []), domain])).sort();
  await updateDomainBlacklist(domainBlacklist, `"${domain}" is now blacklisted.`);
}

async function updateDomainBlacklist(domainBlacklist, statusMessage) {
  const result = await sendMessage({ type: "UPDATE_SETTINGS", payload: { domainBlacklist } });
  if (!result.ok) {
    setStatus(result.error || "Could not update blacklist.");
    return;
  }
  await sendMessage({ type: "RUN_CLUSTERING", forceAi: false });
  await loadState();
  setStatus(statusMessage);
}

function resetBlacklistForm() {
  elements.blacklistInput.value = "";
  elements.blacklistForm.classList.add("hidden");
  elements.addBlacklistButton.classList.remove("hidden");
}

function normalizeBlacklistDomain(value) {
  const raw = String(value || "").trim();
  if (!raw) {
    return "";
  }
  try {
    const parsed = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
    return parsed.hostname.replace(/^www\./, "").toLowerCase();
  } catch (_error) {
    return raw
      .replace(/^https?:\/\//i, "")
      .replace(/^www\./i, "")
      .split("/")[0]
      .trim()
      .toLowerCase();
  }
}

function renderTopicCard(topic, index) {
  const updated = new Date(topic.updatedAt || Date.now()).toLocaleString([], { month: "short", day: "numeric", year: "numeric" });
  const confidence = Math.round((topic.confidence || 0) * 100);
  const isConfirmingDelete = pendingDeleteTopicId === topic.id;
  const expanded = expandedTopicId === topic.id;

  return `
    <article class="topic-card ${expanded ? "is-expanded" : ""}" data-open-topic-id="${escapeHtml(topic.id)}" role="button" tabindex="0" aria-label="Open ${escapeHtml(topic.name)}">
      <div class="topic-title-row">
        <div class="topic-number topic-number-${(index % 3) + 1}" aria-hidden="true">${index + 1}</div>
        <div class="topic-main">
          <h2>${escapeHtml(topic.name)}</h2>
          <p class="topic-summary">${escapeHtml(topic.summary || "Grouped from your browsing path.")}</p>
          <div class="meta-row">
            <span class="meta-chip"><i class="dot dot-blue"></i>Core ${topic.corePageIds.length}</span>
            <span class="meta-chip"><i class="dot dot-yellow"></i>To read ${topic.todoPageIds.length}</span>
            <span class="meta-chip">Confidence <strong>${confidence}%</strong></span>
          </div>
        </div>
        <div class="topic-controls">
          <span class="count-pill">${topic.pageIds.length} pages</span>
          <span class="chevron ${expanded ? "is-open" : ""}" aria-hidden="true"></span>
          ${isConfirmingDelete ? `
            <div class="delete-confirm-popover" role="alertdialog" aria-label="Confirm delete topic">
              <span>Confirm delete?</span>
              <button class="danger-button compact-button" data-confirm-delete-topic-id="${escapeHtml(topic.id)}">Confirm</button>
              <button class="secondary-button compact-button" data-cancel-delete-topic-id="${escapeHtml(topic.id)}">Cancel</button>
            </div>
          ` : `<button class="danger-button compact-button icon-only-button" data-delete-topic-id="${escapeHtml(topic.id)}" aria-label="Delete topic"><span aria-hidden="true"></span></button>`}
        </div>
      </div>
      <div class="topic-date"><span aria-hidden="true">▣</span>${updated}</div>
      ${expanded ? renderInlineTopicDetail(topic) : ""}
    </article>
  `;
}

function renderInlineTopicDetail(topic) {
  const pageGroups = getTopicPageGroups(topic);
  const confidence = Math.round((topic.confidence || 0) * 100);
  const tags = getTopicTags(topic, pageGroups);

  return `
    <div class="inline-topic-detail" data-inline-topic-id="${escapeHtml(topic.id)}">
      <div class="detail-actions">
        <button class="secondary-button detail-action-button" data-restore-topic-id="${escapeHtml(topic.id)}">
          <span class="button-icon" aria-hidden="true">↗</span>
          <span><strong>Continue research</strong><small>Open next core page</small></span>
        </button>
        <button class="secondary-button detail-action-button" data-refresh-topic-id="${escapeHtml(topic.id)}">
          <span class="button-icon" aria-hidden="true">⌘</span>
          <span><strong>Regroup</strong><small>Re-analyze this topic</small></span>
        </button>
        <div class="confidence-card">
          <span>Confidence</span>
          <strong>${confidence}%</strong>
        </div>
      </div>
      ${renderPageGroup("Core pages", pageGroups.corePages, topic.id, 4)}
      ${renderPageGroup("To read", pageGroups.todoPages, topic.id, 1)}
      ${renderPageGroup("Related pages", pageGroups.otherPages, topic.id, 1)}
      ${tags.length ? `
        <section class="page-group tag-section">
          <h2>Tags</h2>
          <div class="tag-row">${tags.map((tag) => `<span class="tag">${escapeHtml(tag)}</span>`).join("")}</div>
        </section>
      ` : ""}
      <section class="page-group clue-section">
        <h2>Relationship clues</h2>
        <ul class="clue-list">
          ${renderRelationshipClues(topic)}
        </ul>
      </section>
    </div>
  `;
}

function renderPageGroup(title, pages, topicId, limit = Infinity) {
  if (!pages.length) {
    return "";
  }
  const visiblePages = pages.slice(0, limit);

  return `
    <section class="page-group">
      <div class="page-group-header">
        <h2>${escapeHtml(title)} (${pages.length})</h2>
        ${pages.length > visiblePages.length ? `<button class="text-button view-all-button" type="button">View all</button>` : ""}
      </div>
      <div class="page-list">
        ${visiblePages.map((page) => renderPage(page, topicId)).join("")}
      </div>
    </section>
  `;
}

function renderPage(page) {
  return `
    <article class="page-item" data-open-page-id="${escapeHtml(page.id)}" role="button" tabindex="0" aria-label="Open ${escapeHtml(page.title)}">
      <div class="page-header">
        <span class="page-favicon" aria-hidden="true">${getPageIcon(page)}</span>
        <div>
          <div class="page-title">${escapeHtml(page.title)}</div>
          <div class="page-domain">${escapeHtml(page.domain)}</div>
        </div>
        <span class="external-link-icon" aria-hidden="true">↗</span>
      </div>
    </article>
  `;
}

function showTopic(topicId) {
  expandedTopicId = expandedTopicId === topicId ? "" : topicId;
  renderTopics();
}

async function handleTopicsListClick(event) {
  const target = event.target;
  if (!(target instanceof Element)) {
    return;
  }

  const restoreButton = target.closest("[data-restore-topic-id]");
  if (restoreButton) {
    event.stopPropagation();
    const topic = appState.topics.find((item) => item.id === restoreButton.dataset.restoreTopicId);
    const result = await sendMessage({ type: "RESTORE_TOPIC", topicId: restoreButton.dataset.restoreTopicId });
    setStatus(result.ok ? `Opened ${result.opened} pages for ${topic?.name || "topic"}.` : result.error);
    return;
  }

  const refreshButton = target.closest("[data-refresh-topic-id]");
  if (refreshButton) {
    event.stopPropagation();
    await sendMessage({ type: "RUN_CLUSTERING", forceAi: true });
    await loadState();
    return;
  }

  const pageItem = target.closest("[data-open-page-id]");
  if (pageItem) {
    event.stopPropagation();
    const page = appState.nodes[pageItem.dataset.openPageId];
    const result = await sendMessage({ type: "OPEN_PAGE", pageId: pageItem.dataset.openPageId });
    setStatus(result.ok ? `Opened ${page?.title || "page"}.` : result.error);
  }
}

function handleTopicsListKeydown(event) {
  const target = event.target;
  if (!(target instanceof Element) || !target.matches("[data-open-page-id]")) {
    return;
  }
  if (event.key !== "Enter" && event.key !== " ") {
    return;
  }
  event.preventDefault();
  target.click();
}

function getTopicTags(topic, pageGroups) {
  const seen = new Set();
  const tags = [];
  const pages = [...pageGroups.corePages, ...pageGroups.todoPages, ...pageGroups.otherPages];
  pages.forEach((page) => {
    (page.tags || []).forEach((tag) => {
      const normalized = normalizeTagLabel(tag);
      if (normalized && !seen.has(normalized)) {
        seen.add(normalized);
        tags.push(normalized);
      }
    });
  });

  if (!tags.length) {
    return topic.name
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((part) => part.length > 2)
      .slice(0, 5)
      .map((tag) => normalizeTagLabel(tag))
      .filter(Boolean);
  }

  return tags.slice(0, 5);
}

function normalizeTagLabel(value) {
  const label = String(value || "")
    .trim()
    .replace(/[。！？.!?].*$/u, "")
    .replace(/\s+/g, " ");
  if (!label) {
    return "";
  }
  return label.length > 18 ? `${label.slice(0, 17)}...` : label;
}

function renderRelationshipClues(topic) {
  const topicPages = new Set(topic.pageIds || []);
  const edges = (appState.edges || [])
    .filter((edge) => topicPages.has(edge.fromPageId) && topicPages.has(edge.toPageId))
    .slice(0, 3);

  if (!edges.length) {
    return `
      <li><span aria-hidden="true">⌁</span>These pages frequently appear together in your sessions.</li>
      <li><span aria-hidden="true">⌘</span>Core pages formed the strongest browsing path for this topic.</li>
      <li><span aria-hidden="true">▤</span>Recently read pages are kept close to the topic root.</li>
    `;
  }

  return edges.map((edge) => {
    const from = appState.nodes[edge.fromPageId]?.title || "One page";
    const to = appState.nodes[edge.toPageId]?.title || "another page";
    return `<li><span aria-hidden="true">⌁</span>${escapeHtml(from)} connects to ${escapeHtml(to)}.</li>`;
  }).join("");
}

function getPageIcon(page) {
  return /chrome|google/i.test(page.domain || "") ? "◈" : "▱";
}

function formatAgo(timestamp) {
  const minutes = Math.max(0, Math.round((Date.now() - timestamp) / 60000));
  if (minutes < 1) {
    return "just now";
  }
  if (minutes < 60) {
    return `${minutes} min ago`;
  }
  const hours = Math.round(minutes / 60);
  return `${hours} hr ago`;
}

function formatRelativeDay(timestamp) {
  const date = new Date(timestamp);
  const today = new Date();
  const startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
  const startOfDate = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  const dayDiff = Math.round((startOfToday - startOfDate) / 86400000);
  if (dayDiff === 0) {
    return "Today";
  }
  if (dayDiff === 1) {
    return "Yesterday";
  }
  return date.toLocaleString([], { month: "short", day: "numeric" });
}

function setStatus(message) {
  elements.statusPanel.textContent = message;
}

function sendMessage(message) {
  return chrome.runtime.sendMessage(message);
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function cssEscape(value) {
  return globalThis.CSS?.escape ? globalThis.CSS.escape(String(value)) : String(value).replace(/"/g, "\\\"");
}

function isInteractiveTarget(target) {
  return target instanceof Element && Boolean(target.closest("button, a, input, textarea, select, [role='alertdialog'], [data-open-page-id], [data-restore-topic-id], [data-refresh-topic-id]"));
}
