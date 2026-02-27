# DocCLI Quick Start Guide

Get started with doccli in 5 minutes.

## What is doccli?

doccli is a documentation indexing and retrieval CLI designed for AI agents. It creates searchable indexes of markdown documentation and provides natural language query capabilities with citation-backed answers.

## Installation

```bash
npm install -g doccli
# or use directly with npx
npx doccli --help
```

## Quick Start Workflow

### Step 1: Build Your Documentation Index

Navigate to your project directory and build an index:

```bash
cd /path/to/your/project

doccli build \
  --src . \
  --library "YourProjectName" \
  --version "1.0.0" \
  --out .doccli/index.json
```

This scans all markdown files in your project and creates a searchable index.

**Output:**
```
Built index: .doccli/index.json
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
}' > .doccli/doccli.json
```

### Step 3: Explore Your Documentation

#### Check what's indexed:

```bash
# Summary statistics
doccli stats

# Output:
# YourProjectName@1.0.0
# Docs: 35
# Sections: 229
# Code blocks: 12
# Built at: 2026-02-27T08:00:00.000Z

# List all documents
doccli list | head -20
```

#### Search for topics:

```bash
doccli search "authentication" --max-results 5

# Output:
# Results for "authentication" in YourProjectName@1.0.0:
# - [8.5] docs/auth-guide#oauth-setup :: OAuth Setup
# - [7.2] docs/security#authentication :: Authentication
# - [5.1] README#getting-started :: Getting Started
```

#### Open a specific document section:

```bash
doccli open "docs/auth-guide#oauth-setup"

# Output:
# docs/auth-guide#oauth-setup (docs/auth-guide.md:45)
# OAuth Setup
#
# To configure OAuth authentication:
# 1. Register your application...
```

#### Get a citation:

```bash
doccli cite "docs/auth-guide#oauth-setup"

# Output:
# YourProjectName@1.0.0:docs/auth-guide#oauth-setup:45-67
# docs/auth-guide.md:45
```

### Step 4: Task-Based Queries (The Power Feature)

Ask natural language questions and get citation-backed steps:

```bash
doccli use "YourProjectName" "How do I set up authentication?" \
  --path .doccli \
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

## Common Workflows

### Developer Documentation Lookup

```bash
# 1. What's available?
doccli stats

# 2. Find relevant docs
doccli search "deployment"

# 3. Read the doc
doccli open "docs/deployment-guide"

# 4. Get citation for reference
doccli cite "docs/deployment-guide#production"
```

### AI Agent Integration

```bash
# 1. Understand the corpus
doccli stats --json | jq '.docs_count'

# 2. Natural language query
doccli use "MyProject" "How do I deploy to production?" \
  --path . --json | jq '.steps[0].instruction'

# 3. Follow related docs
doccli open "docs/deployment-guide" --json | jq '.content'
```

### Continuous Documentation

```bash
# Update your docs, rebuild index
doccli build --src . --library "MyProject" --version "1.0.1" --out .doccli/index.json

# Update manifest version
jq '.library_version = "1.0.1"' .doccli/doccli.json > .doccli/doccli.json.tmp
mv .doccli/doccli.json.tmp .doccli/doccli.json
```

## Command Reference

### Core Commands

| Command | Purpose | Example |
|---------|---------|---------|
| `build` | Create searchable index | `doccli build --src . --library "Foo" --version "1.0.0"` |
| `list` | Show all indexed docs | `doccli list` |
| `stats` | Show index statistics | `doccli stats` |
| `search` | Keyword/phrase search | `doccli search "backup"` |
| `open` | View document section | `doccli open "readme#installation"` |
| `cite` | Get citation string | `doccli cite "readme#features"` |
| `use` | Task-based query | `doccli use "Foo" "How do I...?"` |

### Common Flags

| Flag | Description | Default |
|------|-------------|---------|
| `--json` | Output as JSON | Human-readable |
| `--index <file>` | Index file path | `.doccli/index.json` |
| `--path <dir>` | Manifest search path | current dir + node_modules |
| `--max-results <n>` | Limit results | 10 |
| `--max-chars <n>` | Limit content length | 2000 |

## JSON Output

All commands support `--json` for programmatic use:

```bash
# Structured search results
doccli search "api" --json | jq '.results[] | {heading, score}'

# Task steps with confidence
doccli use "Foo" "How to deploy?" --json | jq '.steps[] | {confidence, instruction}'

# Index statistics
doccli stats --json | jq '{docs: .docs_count, sections: .sections_count}'
```

See [json_output_schema.md](./json_output_schema.md) for complete schemas.

## Tips & Tricks

### 1. Gitignore Your Index

The index can be regenerated, so keep it out of version control:

```bash
echo ".doccli/index.json" >> .gitignore
```

Keep the manifest in version control:
```bash
git add .doccli/doccli.json
```

### 2. Use Relative Paths in CI

```bash
# In CI, use relative paths
doccli build --src . --library "$PROJECT_NAME" --version "$VERSION"
```

### 3. Search Before Use

The `use` command is powerful but can be overkill for simple lookups:

```bash
# Simple lookup: use search
doccli search "configuration"

# Complex task: use use
doccli use "MyProject" "How do I configure authentication with OAuth?"
```

### 4. Chain Commands

```bash
# Find doc, then open it
DOC_ID=$(doccli search "deploy" --json | jq -r '.results[0].doc_id')
doccli open "$DOC_ID"
```

### 5. Related Docs Are Gold

The `use` command returns related docs - follow them for deeper understanding:

```bash
doccli use "Foo" "How do I backup?" --json | jq -r '.related_docs[]'
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
# Ensure doccli.json exists
ls .doccli/doccli.json

# Or create it:
echo '{"schema_version":"1","library":"MyProject","library_version":"1.0.0","index_path":"index.json"}' > .doccli/doccli.json
```

### "No section found for doc_id"

**Error:**
```
REF_NOT_FOUND: No section found for my-doc#my-section
```

**Solution:**
```bash
# List available docs to find the correct ID
doccli list | grep "my-doc"

# Or search for the topic
doccli search "my topic"
```

### Empty Search Results

```bash
# Check what's indexed
doccli stats

# Rebuild if needed
doccli build --src . --library "MyProject" --version "1.0.0"
```

## Next Steps

- Read the [Agent Integration Guide](./doccli-agent-integration.md) for AI agent workflows
- Read [Best Practices](./doccli-best-practices.md) for optimization tips
- Check [JSON Output Schema](./json_output_schema.md) for programmatic integration

## Examples

### Example 1: Daily Developer Use

```bash
# Morning: check what changed
doccli stats

# Find deployment docs
doccli search "production deploy" --max-results 3

# Read the guide
doccli open "docs/deployment#production"

# Share citation with team
doccli cite "docs/deployment#production"
# Copy: MyProject@1.0.0:docs/deployment#production:45-67
```

### Example 2: AI Agent Assistance

```bash
# Agent receives task: "Deploy to production"

# 1. Find relevant docs
doccli use "MyProject" "How do I deploy to production?" --path .doccli --json

# 2. Extract high-confidence steps
# {
#   "steps": [
#     {"confidence": 1.0, "instruction": "Run ./deploy.sh prod", "command": "./deploy.sh prod"},
#     {"confidence": 0.8, "instruction": "Verify health checks", "command": "curl /health"}
#   ]
# }

# 3. Follow related docs for details
doccli open "docs/deployment-guide" --json
```

### Example 3: Documentation as Code

```bash
#!/bin/bash
# In your CI/CD pipeline

set -e

VERSION=$(cat VERSION)

# Rebuild docs index
doccli build --src . --library "MyProject" --version "$VERSION" --out .doccli/index.json

# Update manifest
cat > .doccli/doccli.json <<EOF
{
  "schema_version": "1",
  "library": "MyProject",
  "library_version": "$VERSION",
  "index_path": "index.json"
}
EOF

# Validate index
doccli stats --json | jq -e '.docs_count > 0'

echo "Documentation index built successfully"
```

## Support

- Documentation: [GitHub Repo](https://github.com/your-org/doccli)
- Issues: [GitHub Issues](https://github.com/your-org/doccli/issues)
- Schema Reference: [json_output_schema.md](./json_output_schema.md)
