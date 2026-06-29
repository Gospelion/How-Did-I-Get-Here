# 0003. Temporary Direct AI Key For Internal MVP

## Status

Accepted

## Context

The MVP is a personal/internal prototype. A real public release should not ship a provider API key inside an extension bundle.

## Decision

The internal MVP supports direct AI calls from the extension using a temporary key constant. Public release must replace this with either a thin proxy service or a user-supplied key model.

## Consequences

The prototype can validate AI-assisted clustering quickly. The bundle is not safe for public distribution while a real provider key is embedded.
