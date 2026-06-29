# 0001. Record All Browsing With Sensitive Exclusions

## Status

Accepted

## Context

The MVP should feel automatic: users should not need to start a project before researching. That requires observing normal browsing activity. This also creates privacy risk because browser history can contain sensitive pages.

## Decision

The extension records ordinary browsing by default after installation, but excludes sensitive site categories and user-blacklisted domains from both local research topics and AI payloads.

## Consequences

The product can discover research trails without explicit session setup. The tradeoff is that filtering must be conservative, visible, and easy to override through settings.
