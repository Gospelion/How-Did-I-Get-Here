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

## Conventions

- Document project-specific coding, design, naming, branching, or release conventions here.

## Open Questions

- Track unresolved project facts that future agents should verify before relying on them.
