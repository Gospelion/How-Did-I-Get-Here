(function initContentScript() {
  function collectPageContext() {
    const title = document.title || "";
    const selection = String(window.getSelection?.() || "").trim().slice(0, 600);
    const mainText = getReadableText().slice(0, 1600);
    const readingProgress = getReadingProgress();
    const tags = getMetaKeywords();
    const contentMetrics = getContentMetrics();

    return {
      url: location.href,
      title,
      referrerUrl: document.referrer || "",
      summary: selection || mainText,
      readingProgress,
      tags,
      contentMetrics
    };
  }

  function getReadableText() {
    const candidates = [
      document.querySelector("article"),
      document.querySelector("main"),
      document.body
    ].filter(Boolean);
    const source = candidates[0];
    return String(source.innerText || "")
      .replace(/\s+/g, " ")
      .trim();
  }

  function getReadingProgress() {
    const scrollable = Math.max(
      document.documentElement.scrollHeight,
      document.body?.scrollHeight || 0
    ) - window.innerHeight;
    if (scrollable <= 0) {
      return 0;
    }
    return Math.max(0, Math.min(1, window.scrollY / scrollable));
  }

  function getMetaKeywords() {
    const keywords = document.querySelector('meta[name="keywords"]')?.getAttribute("content") || "";
    const description = document.querySelector('meta[name="description"]')?.getAttribute("content") || "";
    return `${keywords},${description}`
      .split(/[,，]/)
      .map((tag) => tag.trim())
      .filter(Boolean)
      .slice(0, 8);
  }

  function getContentMetrics() {
    const readableText = getReadableText();
    const words = readableText.match(/[\p{L}\p{N}]+/gu) || [];
    const articleLike = Boolean(
      document.querySelector("article")
      || document.querySelector("main")
      || document.querySelector('[role="main"]')
    );

    return {
      wordCount: words.length,
      mediaCount: document.querySelectorAll("img, video, audio, canvas, iframe").length,
      linkCount: document.querySelectorAll("a[href]").length,
      formControlCount: document.querySelectorAll("input, textarea, select, button").length,
      articleLike
    };
  }

  if (canUseRuntimeMessaging()) {
    chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
      if (message?.type === "REQUEST_PAGE_CONTEXT") {
        sendResponse({ ok: true, payload: collectPageContext() });
        return true;
      }
      return false;
    });
  }

  function canUseRuntimeMessaging() {
    return typeof chrome !== "undefined"
      && Boolean(chrome.runtime)
      && typeof chrome.runtime.sendMessage === "function";
  }

  function sendPageContext() {
    if (!canUseRuntimeMessaging()) {
      return;
    }

    try {
      chrome.runtime.sendMessage({
        type: "PAGE_CONTEXT",
        payload: collectPageContext()
      }).catch(() => {});
    } catch (_error) {
      // The extension context can disappear while a page is unloading or after reload.
    }
  }

  window.addEventListener("pagehide", () => {
    sendPageContext();
  });

  setTimeout(() => {
    sendPageContext();
  }, 1200);
})();
