# DocCLI Quick Start Guide

Get started with doc-nav in 5 minutes.

## What is doc-nav?

doc-nav is a documentation indexing and retrieval CLI designed for AI agents. It creates searchable indexes of markdown documentation and provides natural language query capabilities with citation-backed answers.

## Installation

```bash
npm install -g doc-nav
# or use directly with npx
npx doc-nav --help
```

## Quick Start Workflow

### Step 1: Build Your Documentation Index

Navigate to your project directory and build an index:

```bash
cd /path/to/your/project

doc-nav build \
  --src . \
  --library "YourProjectName" \
  --version "1.0.0" \
  --out .doc-nav/index.json
```

This scans all markdown files in your project and creates a searchable index.

**Output:**
```
Built index: .doc-nav/index.json
Docs: 35, sections: 229
Source hash: sha256:abc123...
```

### Step 2: Create a Manifest (for `use` command)

Create a manifest file so the `use` command can find your docs:

```bash
echo '{
  "schema_version": "1",
  "library": "YourProjectName",
  "library_version": "1.0.0",
  "index_path": "index.json"
}' > .doc-nav/doc-nav.json
```

### Step 3: Explore Your Documentation

#### Check what's indexed:

```bash
# Summary statistics
doc-nav stats

# Output:
# YourProjectName@1.0.0
# Docs: 35
# Sections: 229
# Code blocks: 12
# Built at: 2026-02-27T08:00:00.000Z

# List all documents
doc-nav list | head -20
```

#### Search for topics:

```bash
doc-nav search "authentication" --max-results 5

# Output:
# Results for "authentication" in YourProjectName@1.0.0:
# - [8.5] docs/auth-guide#oauth-setup :: OAuth Setup
# - [7.2] docs/security#authentication :: Authentication
# - [5.1] README#getting-started :: Getting Started
```

#### Open a specific document section:

```bash
doc-nav open "docs/auth-guide#oauth-setup"

# Output:
# docs/auth-guide#oauth-setup (docs/auth-guide.md:45)
# OAuth Setup
#
# To configure OAuth authentication:
# 1. Register your application...
```

#### Get a citation:

```bash
doc-nav cite "docs/auth-guide#oauth-setup"

# Output:
# YourProjectName@1.0.0:docs/auth-guide#oauth-setup:45-67
# docs/auth-guide.md:45
```

### Step 4: Task-Based Queries (The Power Feature)

Ask natural language questions and get citation-backed steps:

```bash
doc-nav use "YourProjectName" "How do I set up authentication?" \
  --path .doc-nav \
  --max-results 5

# Output:
# YourProjectName@1.0.0 :: How do I set up authentication? [authoritative]
# step_1 [confidence: 1]. Register your OAuth application with the provider...
#   command: oauth-cli register --provider github
#   prerequisites: API credentials from your OAuth provider
#   cite: YourProjectName@1.0.0:docs/auth-guide#registration:12-25
#
# step_2 [confidence: 0.9]. Configure environment variables...
#   command: export OAUTH_CLIENT_ID=your_client_id
#   cite: YourProjectName@1.0.0:docs/auth-guide#configuration:26-40
#
# Related docs: docs/auth-guide, docs/security
```

## Pre-Install Library Research (New)

Use this workflow when the library is not installed locally and you want to research docs first.

### Step A: Discover candidate libraries

```bash
doc-nav discover "axios" --provider npm --max-results 5 --json
```

### Step B: Fetch and pin docs snapshot

```bash
doc-nav fetch "npm:axios" --json
```

The fetch response includes:
- `resolved_ref` (immutable version/ref)
- `docs_dir` (snapshot docs path)
- `source_manifest_path` (provenance metadata)

### Step C: Build index from fetched docs with provenance

```bash
doc-nav build \
  --src /path/to/fetched/docs \
  --library "axios" \
  --version "1.13.6" \
  --source-manifest /path/to/.doc-nav/source.json \
  --out .doc-nav/index.json
```

Then create `.doc-nav/doc-nav.json` and use normal `search/open/cite/use`.

## Common Workflows

### Developer Documentation Lookup

```bash
# 1. What's available?
doc-nav stats

# 2. Find relevant docs
doc-nav search "deployment"

# 3. Read the doc
doc-nav open "docs/deployment-guide"

# 4. Get citation for reference
doc-nav cite "docs/deployment-guide#production"
```

### AI Agent Integration

```bash
# 1. Understand the corpus
doc-nav stats --json | jq '.docs_count'

# 2. Natural language query
doc-nav use "MyProject" "How do I deploy to production?" \
  --path . --json | jq '.steps[0].instruction'

# 3. Follow related docs
doc-nav open "docs/deployment-guide" --json | jq '.content'
```

### Continuous Documentation

```bash
# Update your docs, rebuild index
doc-nav build --src . --library "MyProject" --version "1.0.1" --out .doc-nav/index.json

# Update manifest version
jq '.library_version = "1.0.1"' .doc-nav/doc-nav.json > .doc-nav/doc-nav.json.tmp
mv .doc-nav/doc-nav.json.tmp .doc-nav/doc-nav.json
```

## Command Reference

### Core Commands

| Command | Purpose | Example |
|---------|---------|---------|
| `build` | Create searchable index | `doc-nav build --src . --library "Foo" --version "1.0.0"` |
| `list` | Show all indexed docs | `doc-nav list` |
| `stats` | Show index statistics | `doc-nav stats` |
| `search` | Keyword/phrase search | `doc-nav search "backup"` |
| `open` | View document section | `doc-nav open "readme#installation"` |
| `cite` | Get citation string | `doc-nav cite "readme#features"` |
| `use` | Task-based query | `doc-nav use "Foo" "How do I...?"` |
| `discover` | Find external docs/library candidates | `doc-nav discover "express" --provider npm` |
| `fetch` | Snapshot external docs with pinned ref | `doc-nav fetch "npm:express"` |

### Common Flags

| Flag | Description | Default |
|------|-------------|---------|
| `--json` | Output as JSON | Human-readable |
| `--index <file>` | Index file path | `.doc-nav/index.json` |
| `--path <dir>` | Manifest search path | current dir + node_modules |
| `--max-results <n>` | Limit results | 5 (`search`/`discover`), 3 (`use`) |
| `--max-chars <n>` | Limit content length | 2000 |
| `--source-manifest <file>` | Attach provenance to build output | none |

## JSON Output

All commands support `--json` for programmatic use:

```bash
# Structured search results
doc-nav search "api" --json | jq '.results[] | {heading, score}'

# Task steps with confidence
doc-nav use "Foo" "How to deploy?" --json | jq '.steps[] | {confidence, instruction}'

# Index statistics
doc-nav stats --json | jq '{docs: .docs_count, sections: .sections_count}'
```

See [json_output_schema.md](./json_output_schema.md) for complete schemas.

## Tips & Tricks

### 1. Gitignore Your Index

The index can be regenerated, so keep it out of version control:

```bash
echo ".doc-nav/index.json" >> .gitignore
```

Keep the manifest in version control:
```bash
git add .doc-nav/doc-nav.json
```

### 2. Use Relative Paths in CI

```bash
# In CI, use relative paths
doc-nav build --src . --library "$PROJECT_NAME" --version "$VERSION"
```

### 3. Search Before Use

The `use` command is powerful but can be overkill for simple lookups:

```bash
# Simple lookup: use search
doc-nav search "configuration"

# Complex task: use use
doc-nav use "MyProject" "How do I configure authentication with OAuth?"
```

### 4. Chain Commands

```bash
# Find doc, then open it
DOC_ID=$(doc-nav search "deploy" --json | jq -r '.results[0].doc_id')
doc-nav open "$DOC_ID"
```

### 5. Related Docs Are Gold

The `use` command returns related docs - follow them for deeper understanding:

```bash
doc-nav use "Foo" "How do I backup?" --json | jq -r '.related_docs[]'
# Output: docs/backup-guide, docs/restore-guide, readme
```

## Troubleshooting

### "Could not locate docs manifest"

**Error:**
```
RESOLUTION_FAILED: Could not locate docs manifest for library MyProject
```

**Solution:**
```bash
# Ensure doc-nav.json exists
ls .doc-nav/doc-nav.json

# Or create it:
echo '{"schema_version":"1","library":"MyProject","library_version":"1.0.0","index_path":"index.json"}' > .doc-nav/doc-nav.json
```

### "No section found for doc_id"

**Error:**
```
REF_NOT_FOUND: No section found for my-doc#my-section
```

**Solution:**
```bash
# List available docs to find the correct ID
doc-nav list | grep "my-doc"

# Or search for the topic
doc-nav search "my topic"
```

### Empty Search Results

```bash
# Check what's indexed
doc-nav stats

# Rebuild if needed
doc-nav build --src . --library "MyProject" --version "1.0.0"
```

## Next Steps

- Read the [Agent Integration Guide](./doc-nav-agent-integration.md) for AI agent workflows
- Read [Best Practices](./doc-nav-best-practices.md) for optimization tips
- Check [JSON Output Schema](./json_output_schema.md) for programmatic integration

## Examples

### Example 1: Daily Developer Use

```bash
# Morning: check what changed
doc-nav stats

# Find deployment docs
doc-nav search "production deploy" --max-results 3

# Read the guide
doc-nav open "docs/deployment#production"

# Share citation with team
doc-nav cite "docs/deployment#production"
# Copy: MyProject@1.0.0:docs/deployment#production:45-67
```

### Example 2: AI Agent Assistance

```bash
# Agent receives task: "Deploy to production"

# 1. Find relevant docs
doc-nav use "MyProject" "How do I deploy to production?" --path .doc-nav --json

# 2. Extract high-confidence steps
# {
#   "steps": [
#     {"confidence": 1.0, "instruction": "Run ./deploy.sh prod", "command": "./deploy.sh prod"},
#     {"confidence": 0.8, "instruction": "Verify health checks", "command": "curl /health"}
#   ]
# }

# 3. Follow related docs for details
doc-nav open "docs/deployment-guide" --json
```

### Example 3: Documentation as Code

```bash
#!/bin/bash
# In your CI/CD pipeline

set -e

VERSION=$(cat VERSION)

# Rebuild docs index
doc-nav build --src . --library "MyProject" --version "$VERSION" --out .doc-nav/index.json

# Update manifest
cat > .doc-nav/doc-nav.json <<EOF
{
  "schema_version": "1",
  "library": "MyProject",
  "library_version": "$VERSION",
  "index_path": "index.json"
}
EOF

# Validate index
doc-nav stats --json | jq -e '.docs_count > 0'

echo "Documentation index built successfully"
```

## Support

- Documentation: [GitHub Repo](https://github.com/your-org/doc-nav)
- Issues: [GitHub Issues](https://github.com/your-org/doc-nav/issues)
- Schema Reference: [json_output_schema.md](./json_output_schema.md)
