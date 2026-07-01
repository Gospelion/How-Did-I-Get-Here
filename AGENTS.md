# AGENTS.md

Project-level instructions and durable memory for Codex agents working in this repository.

## Project Memory

- Add stable, project-specific facts here when they would materially help future agents work safely or faster.
- Prefer concise, verified facts over narrative notes.
- Do not record secrets, transient command output, speculative conclusions, or information already obvious from nearby source files.

## Commands

- `npm test` runs the Node test suite.
- `node --check background.js` and `node --check sidepanel.js` verify extension script syntax.

## Architecture Notes

- Core topic/page logic lives in `src/core.js` so it can be reused by both the MV3 background service worker and Node tests.
- Side panel actions talk to the background service worker through `chrome.runtime.sendMessage`; persistent data is stored in `chrome.storage.local`.
- This repository is a standalone product in the same ecosystem as sibling repository `Where-Was-I`.
- The ecosystem website is being split into standalone repository `D:\Programs\Personal\memory-trails-site`.
- AI topic refreshes are scoped to pages/topics with new visits using `lastAiRunAt` and `lastAiPageIds`; unchanged topics should be preserved.
- Local topic clustering is controlled by `settings.localClusteringEnabled` and defaults to off, so failed/skipped AI refreshes should preserve existing topics instead of silently regenerating local topics.
- Research-content filtering rules, including SaaS app exclusions and readability heuristics, live in `src/core.js`.
- Captured page titles are normalized in `src/core.js` to remove site-brand wrappers before storage, local clustering, and AI payload generation.
- Topic membership sanitization in `src/core.js` deduplicates pages by normalized title within each topic, keeping the first occurrence.

## Conventions

- Document project-specific coding, design, naming, branching, or release conventions here.

## Open Questions

- Track unresolved project facts that future agents should verify before relying on them.
