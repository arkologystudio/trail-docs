# DocCLI for Agents — Project Overview Pitch (Core Narrative)

## What it is

DocCLI turns documentation into a small, navigable command-line tool that AI coding agents can use like a filesystem: search, open, extract examples, pull signatures, and cite sources—without loading entire docs into context.

It’s dev tooling designed for agents, shipped by developers.

---

## The problem we keep hitting

Coding agents are already good at using tools—especially the terminal.
But documentation is still distributed as long web pages and markdown that agents can’t reliably hold in a context window. The result is familiar:

- agents guess APIs they didn’t actually verify
- integrations drift across versions
- “docs” becomes a hallucination surface instead of a source of truth
- teams spend time debugging avoidable mistakes

As agents become primary consumers of software (and increasingly influence purchasing), documentation needs an interface that agents can use directly, step by step.

---

## The idea

Instead of pushing docs into prompts, we give agents a tool-shaped interface to docs.

Developers run DocCLI locally against their docs and generate an official docs CLI for their project—something like:

```bash
myapi-docs search "webhooks signature"
myapi-docs open auth/oauth#refresh
myapi-docs examples webhooks
myapi-docs signature createCharge
myapi-docs cite auth/oauth#refresh
```

Agents use it to navigate and verify only what they need, when they need it.

---

## Why CLI-first

Most agent runtimes already work well with shell tools. A CLI is:

- universal across agent environments
- naturally iterative (search → open → refine)
- easy to keep compact and token-budgeted
- simple to version-pin alongside releases

We don’t need a heavyweight protocol or a fleet of servers just to make docs usable.

---

## How it works (v1)

DocCLI is local-first and deliberately lightweight.

1. Ingest docs (Markdown, static docs builds, optionally OpenAPI)
2. Build a single index file (headings, anchors, snippets, code blocks, link graph, version metadata)
3. Expose a stable CLI contract with compact outputs and an optional `--json` mode for deterministic agent parsing

No auth. No hosted infra. No vector database required for the first iteration.

---

## Who it’s for

**Primary customer:** developers and teams who maintain software and want an agent-ready documentation interface as part of their product surface.

They ship the docs CLI because it:

- reduces integration errors and support load
- makes their API easier for agent-driven workflows
- becomes a trust signal: “agents can verify this”

**Secondary user:** the AI agent consuming the CLI to ground decisions in authoritative, versioned documentation.

---

## What success looks like

- maintainers ship an official docs CLI with releases
- agents consistently cite docs instead of guessing
- fewer broken integrations, fewer repetitive support threads
- “agent usability” becomes a real product differentiator

---

## Why it matters

Documentation has always been written for humans skimming web pages.
But agents don’t skim—they iterate, query, and execute.

DocCLI is a small shift: treat docs as an executable interface.
That makes agents more reliable, version-correct, and grounded—without asking developers to rebuild their stack.

