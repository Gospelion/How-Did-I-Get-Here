const core = window.HDIGHCore;

const elements = {
  acceptAiButton: document.querySelector("#acceptAiButton"),
  aiToggle: document.querySelector("#aiToggle"),
  blacklistInput: document.querySelector("#blacklistInput"),
  consentPanel: document.querySelector("#consentPanel"),
  declineAiButton: document.querySelector("#declineAiButton"),
  refreshButton: document.querySelector("#refreshButton"),
  saveSettingsButton: document.querySelector("#saveSettingsButton"),
  settingsButton: document.querySelector("#settingsButton"),
  settingsPanel: document.querySelector("#settingsPanel"),
  statusPanel: document.querySelector("#statusPanel"),
  topicDetail: document.querySelector("#topicDetail"),
  topicsList: document.querySelector("#topicsList")
};

let appState = null;

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

  elements.refreshButton.addEventListener("click", async () => {
    setStatus("Refreshing topics...");
    await sendMessage({ type: "RUN_CLUSTERING", forceAi: true });
    await loadState();
  });

  elements.settingsButton.addEventListener("click", () => {
    elements.settingsPanel.classList.toggle("hidden");
  });

  elements.saveSettingsButton.addEventListener("click", async () => {
    const domainBlacklist = elements.blacklistInput.value
      .split(/\n|,/)
      .map((item) => item.trim())
      .filter(Boolean);
    await sendMessage({ type: "UPDATE_SETTINGS", payload: { domainBlacklist } });
    await loadState();
  });
}

async function loadState() {
  const state = await sendMessage({ type: "GET_STATE" });
  appState = state;
  elements.aiToggle.checked = Boolean(state.settings.aiEnabled && state.settings.aiConsentGranted);
  elements.blacklistInput.value = (state.settings.domainBlacklist || []).join("\n");
  elements.consentPanel.classList.toggle("hidden", state.settings.aiConsentGranted || state.settings.aiEnabled === false);
  renderTopics();
}

function renderTopics() {
  const topics = appState.topics || [];
  const nodeCount = Object.keys(appState.nodes || {}).length;

  if (!topics.length) {
    setStatus(nodeCount
      ? "Pages are being collected. Refresh to build local topics."
      : "Browse a few research pages, then open this panel again.");
    elements.topicsList.innerHTML = `<div class="empty-state">No research topics yet. Open a few related pages and this panel will turn them into a research trail.</div>`;
    return;
  }

  setStatus(`${topics.length} research ${topics.length === 1 ? "topic" : "topics"} from ${nodeCount} recorded pages.`);
  elements.topicsList.innerHTML = topics.map((topic) => renderTopicCard(topic)).join("");
  elements.topicsList.querySelectorAll("[data-open-topic-id]").forEach((button) => {
    button.addEventListener("click", () => showTopic(button.dataset.openTopicId));
  });
  elements.topicsList.querySelectorAll("[data-delete-topic-id]").forEach((button) => {
    button.addEventListener("click", async () => {
      const topic = appState.topics.find((item) => item.id === button.dataset.deleteTopicId);
      if (!topic || !confirm(`Delete topic "${topic.name}"? Browsing records will be kept.`)) {
        return;
      }
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
  return `
    <article class="topic-card">
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
        <button class="secondary-button compact-button" data-open-topic-id="${escapeHtml(topic.id)}">Open</button>
        <button class="danger-button compact-button" data-delete-topic-id="${escapeHtml(topic.id)}">Delete</button>
      </div>
    </article>
  `;
}

function showTopic(topicId) {
  const topic = appState.topics.find((item) => item.id === topicId);
  if (!topic) {
    return;
  }

  const corePages = topic.corePageIds.map((id) => appState.nodes[id]).filter(Boolean);
  const todoPages = topic.todoPageIds.map((id) => appState.nodes[id]).filter(Boolean);
  const otherPages = topic.pageIds
    .filter((id) => !topic.corePageIds.includes(id) && !topic.todoPageIds.includes(id))
    .map((id) => appState.nodes[id])
    .filter(Boolean);

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
    ${renderPageGroup("Core pages", corePages, topic.id)}
    ${renderPageGroup("To read", todoPages, topic.id)}
    ${renderPageGroup("Related pages", otherPages, topic.id)}
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
    button.addEventListener("click", async () => {
      const page = appState.nodes[button.dataset.openPageId];
      const result = await sendMessage({ type: "OPEN_PAGE", pageId: button.dataset.openPageId });
      setStatus(result.ok ? `Opened ${page?.title || "page"}.` : result.error);
    });
  });
  elements.topicDetail.querySelectorAll("[data-remove-page-id]").forEach((button) => {
    button.addEventListener("click", async () => {
      const page = appState.nodes[button.dataset.removePageId];
      if (!page || !confirm(`Remove "${page.title}" from this topic? The page record will be kept.`)) {
        return;
      }
      const result = await sendMessage({
        type: "REMOVE_PAGE_FROM_TOPIC",
        topicId,
        pageId: button.dataset.removePageId
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
}

function renderPageGroup(title, pages, topicId) {
  if (!pages.length) {
    return "";
  }

  return `
    <section class="page-group">
      <h2>${escapeHtml(title)}</h2>
      <div class="page-list">
        ${pages.map((page) => renderPage(page, topicId)).join("")}
      </div>
    </section>
  `;
}

function renderPage(page, topicId) {
  const edges = appState.edges.filter((edge) => edge.toPageId === page.id || edge.fromPageId === page.id);
  const relations = edges.map((edge) => describeEdge(edge, page.id)).filter(Boolean);
  const tags = [
    page.importance,
    page.readStatus,
    `${Math.round((page.readingProgress || 0) * 100)}%`
  ].concat(page.tags || []).slice(0, 6);

  return `
    <article class="page-item">
      <div class="page-header">
        <div>
          <div class="page-title">${escapeHtml(page.title)}</div>
          <div class="page-domain">${escapeHtml(page.domain)}</div>
        </div>
        <div class="page-actions">
          <button class="open-page-button" data-open-page-id="${escapeHtml(page.id)}" title="Open page">Open</button>
          <button class="remove-page-button" data-remove-page-id="${escapeHtml(page.id)}" data-topic-id="${escapeHtml(topicId)}" title="Remove from topic">Remove</button>
        </div>
      </div>
      <div class="tag-row">${tags.map((tag) => `<span class="tag">${escapeHtml(tag)}</span>`).join("")}</div>
      ${page.summary ? `<p class="topic-summary">${escapeHtml(page.summary).slice(0, 180)}</p>` : ""}
      ${relations.length ? `<ul class="relation-list">${relations.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>` : ""}
    </article>
  `;
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
