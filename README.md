# DocCLI

**Natural language documentation retrieval for AI agents**

doccli turns your markdown documentation into a searchable, citation-backed knowledge base that AI agents can query with natural language.

[![Tests](https://img.shields.io/badge/tests-8%2F8%20passing-brightgreen)]()
[![License](https://img.shields.io/badge/license-MIT-blue)]()
[![Version](https://img.shields.io/badge/version-0.1.0-orange)]()

---

## The Problem

AI agents struggle with documentation:

```python
# Traditional approach: token-expensive, error-prone
agent.read_file("docs/README.md")          # 5000 tokens
agent.read_file("docs/deployment.md")      # 8000 tokens
agent.read_file("docs/architecture.md")    # 12000 tokens
agent.grep_search("backup")                # Trial and error
agent.grep_search("restore")               # More searching...

# Result: 25K+ tokens spent, no clear answer, no citations
```

## The Solution

```bash
# With doccli: fast, precise, citation-backed
$ doccli use "MyProject" "How do I perform a backup and restore?"

MyProject@1.0.0 :: How do I perform a backup and restore? [authoritative]

step_1 [confidence: 1.0] Check your backup mode
  command: ./myctl backup-status
  prerequisites: Backup service must be configured
  cite: MyProject@1.0.0:docs/backup-guide#modes:12-25

step_2 [confidence: 0.95] Trigger backup with restic
  command: ./myctl backup-run
  expected: Backup completes in ~5 minutes
  cite: MyProject@1.0.0:docs/backup-guide#execution:26-40

step_3 [confidence: 0.90] Verify backup integrity
  command: ./myctl backup-verify
  cite: MyProject@1.0.0:docs/backup-guide#verification:41-55

Related docs: docs/backup-guide, docs/disaster-recovery, docs/runbooks
```

**Result:** Actionable steps with confidence scores and citations. Tokens saved: ~90%.

---

## Features

### 🎯 For AI Agents

- **Natural language queries**: Ask "How do I...?" and get citation-backed steps
- **Confidence scores**: Know when to execute autonomously vs. ask for help (0.0 - 1.0 per step)
- **Structured output**: JSON format with commands, prerequisites, and expected results
- **Related documents**: Automatic suggestions for deeper exploration
- **Fast**: Pre-indexed search, no expensive file scanning

### 🛠️ For Developers

- **Simple CLI**: One command to index, one to query
- **Markdown-native**: Works with your existing docs (no special format required)
- **Version-aware**: Track documentation per version
- **Citation format**: `Library@version:doc_id#anchor:lines` for precise references
- **Introspection**: See what's indexed with `list` and `stats` commands

---

## Quick Start

### Installation

```bash
npm install -g doccli
```

### Index Your Documentation

```bash
cd /path/to/your/project

doccli build \
  --src . \
  --library "MyProject" \
  --version "1.0.0" \
  --out .doccli/index.json
```

Output:
```
Built index: .doccli/index.json
Docs: 35, sections: 229
Source hash: sha256:abc123...
```

### Query with Natural Language

```bash
# Create manifest (one-time)
echo '{"schema_version":"1","library":"MyProject","library_version":"1.0.0","index_path":"index.json"}' > .doccli/doccli.json

# Ask questions
doccli use "MyProject" "How do I deploy to production?"
```

---

## Examples

### Example 1: Developer Lookup

```bash
# What documentation exists?
$ doccli stats
MyProject@1.0.0
Docs: 35
Sections: 229
Code blocks: 12

# Find deployment docs
$ doccli search "production deploy"
Results for "production deploy" in MyProject@1.0.0:
- [8.5] docs/deploy-guide#production :: Production Deployment
- [7.2] docs/runbooks#deploy :: Deployment Runbook
- [5.1] README#deployment :: Deployment Overview

# Read the guide
$ doccli open "docs/deploy-guide#production"
docs/deploy-guide#production (docs/deploy-guide.md:45)

Production Deployment
To deploy to production:
1. Run full test suite: ./run-tests.sh
2. Build release: ./build-release.sh
3. Deploy: ./deploy.sh production
...
```

### Example 2: AI Agent Integration

```python
import subprocess
import json

def query_docs(library, task):
    """Agent queries documentation"""
    result = subprocess.run(
        ['doccli', 'use', library, task, '--path', '.doccli', '--json'],
        capture_output=True,
        text=True
    )
    return json.loads(result.stdout)

# Agent receives task: "Deploy to production"
response = query_docs("MyProject", "How do I deploy to production?")

# Agent evaluates confidence
for step in response['steps']:
    if step['confidence'] > 0.8:
        print(f"✅ High confidence: {step['instruction']}")
        if 'command' in step:
            # Agent can execute autonomously
            execute_command(step['command'])
    else:
        print(f"💡 Suggest to user: {step['instruction']}")

# Agent explores related docs if needed
if response['confidence'] == 'partial':
    for doc_id in response['related_docs']:
        explore_document(doc_id)
```

### Example 3: Citation Tracking

```bash
# Get structured citation
$ doccli cite "docs/deploy-guide#production"
MyProject@1.0.0:docs/deploy-guide#production:45-67
docs/deploy-guide.md:45

# Use in commit messages, audit logs, etc.
git commit -m "Implement deployment

Based on documented procedure at:
MyProject@1.0.0:docs/deploy-guide#production:45-67"
```

---

## Commands

| Command | Purpose | Example |
|---------|---------|---------|
| `build` | Create searchable index from markdown files | `doccli build --src . --library "Foo" --version "1.0.0"` |
| `bootstrap` | Generate docs from code + build index | `doccli bootstrap --src . --library "Foo" --version "1.0.0" --emit-manifest` |
| `list` | Show all indexed documents | `doccli list` |
| `stats` | Show index statistics | `doccli stats` |
| `search` | Search by keywords | `doccli search "authentication"` |
| `open` | View document section | `doccli open "readme#installation"` |
| `cite` | Get citation reference | `doccli cite "docs/api#endpoints"` |
| `use` | Natural language task query | `doccli use "Foo" "How do I configure SSL?"` |

All commands support `--json` for structured output.

---

## How It Works

```
┌─────────────────────────────────────────────────────────────┐
│ 1. Build Phase                                              │
│                                                              │
│  docs/*.md  ──┐                                             │
│  README.md  ──┤                                             │
│  *.md       ──┴──> doccli build ──> .doccli/index.json     │
│                         │                                    │
│                         └──> .doccli/doccli.json (manifest) │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│ 2. Query Phase                                              │
│                                                              │
│  "How do I deploy?" ──> doccli use ──> Search index        │
│                              │                               │
│                              ├──> Rank by relevance         │
│                              ├──> Extract actionable steps  │
│                              ├──> Assign confidence scores  │
│                              └──> Return with citations     │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│ 3. Result                                                   │
│                                                              │
│  {                                                           │
│    "confidence": "authoritative",                           │
│    "steps": [                                               │
│      {                                                       │
│        "instruction": "Run deployment script",              │
│        "confidence": 0.95,                                  │
│        "command": "./deploy.sh prod",                       │
│        "citations": ["MyProject@1.0.0:docs/deploy:45-67"]  │
│      }                                                       │
│    ],                                                        │
│    "related_docs": ["docs/deploy", "docs/rollback"]        │
│  }                                                           │
└─────────────────────────────────────────────────────────────┘
```

---

## Documentation

### 📚 Guides

- **[Quick Start Guide](./docs/doccli-quick-start.md)** - Get started in 5 minutes
- **[Agent Integration Guide](./docs/doccli-agent-integration.md)** - Integrate doccli into AI agents
- **[Best Practices](./docs/doccli-best-practices.md)** - Optimization tips and decision guides
- **[JSON Output Schema](./docs/json_output_schema.md)** - Complete API reference

### 🎯 When to Use What

| You want to... | Use this command |
|----------------|------------------|
| Know what docs are available | `doccli stats` or `doccli list` |
| Find docs about a topic | `doccli search "topic"` |
| Get steps for a task | `doccli use "MyProject" "How do I...?"` |
| Read a specific document | `doccli open "doc-id#section"` |
| Get a source reference | `doccli cite "doc-id#section"` |

See [Best Practices](./docs/doccli-best-practices.md) for detailed decision guide.

---

## JSON Output

All commands support `--json` for programmatic use:

```bash
# Search
doccli search "backup" --json
# {
#   "query": "backup",
#   "library": "MyProject",
#   "version": "1.0.0",
#   "results": [
#     {
#       "score": 8.5,
#       "doc_id": "docs/backup-guide",
#       "anchor": "overview",
#       "heading": "Backup Overview",
#       "snippet": "To perform backups, use the backup service...",
#       "source_path": "docs/backup-guide.md",
#       "line_start": 12,
#       "line_end": 25
#     }
#   ]
# }

# Task query
doccli use "MyProject" "How to backup?" --json
# {
#   "task": "How to backup?",
#   "confidence": "authoritative",
#   "steps": [
#     {
#       "id": "step_1",
#       "instruction": "Check backup mode",
#       "confidence": 0.95,
#       "command": "./myctl backup-status",
#       "prerequisites": "Backup service configured",
#       "citations": ["MyProject@1.0.0:docs/backup:12-25"]
#     }
#   ],
#   "related_docs": ["docs/backup-guide", "docs/restore-guide"]
# }

# Stats
doccli stats --json
# {
#   "library": "MyProject",
#   "version": "1.0.0",
#   "docs_count": 35,
#   "sections_count": 229,
#   "code_blocks_count": 12,
#   "built_at": "2026-02-27T10:00:00.000Z"
# }
```

See [JSON Output Schema](./docs/json_output_schema.md) for complete reference.

---

## Use Cases

### 1. Autonomous AI Agents

Agents can query documentation and execute tasks with confidence scores guiding their autonomy level:

- **Confidence ≥ 0.8**: Execute autonomously
- **Confidence 0.5-0.8**: Suggest to user
- **Confidence < 0.5**: Flag for human review

### 2. Developer Documentation Assistant

Quickly find and cite documentation without leaving the terminal:

```bash
# Find, read, cite - all in CLI
doccli search "api" | head -5
doccli open "docs/api-reference"
doccli cite "docs/api-reference#authentication"
```

### 3. Documentation Quality Assurance

Test if common questions are well-documented:

```bash
#!/bin/bash
queries=(
  "How do I install?"
  "How do I deploy?"
  "How do I troubleshoot?"
)

for query in "${queries[@]}"; do
  confidence=$(doccli use "MyProject" "$query" --json | jq -r '.confidence')
  echo "$query: $confidence"
done
```

### 4. CI/CD Integration

Validate documentation completeness in CI:

```bash
# In .github/workflows/docs.yml
- name: Build docs index
  run: doccli build --src . --library "${{ github.repository }}" --version "${{ github.ref_name }}"

- name: Validate coverage
  run: |
    docs_count=$(doccli stats --json | jq '.docs_count')
    if [ "$docs_count" -lt 10 ]; then
      echo "Insufficient documentation coverage"
      exit 1
    fi
```

---

## Why doccli?

### vs. Traditional Grep/Search

| Approach | Tokens Used | Time | Citations | Agent-Friendly |
|----------|-------------|------|-----------|----------------|
| Read all docs | 20,000+ | Slow | Manual | ❌ |
| Grep search | Variable | Multiple rounds | None | ❌ |
| **doccli** | **~500** | **Fast** | **Automatic** | **✅** |

### vs. RAG Solutions

| Feature | RAG (Embeddings) | doccli | Winner |
|---------|------------------|--------|--------|
| Setup complexity | High (vector DB, embeddings) | Low (one command) | doccli |
| Query speed | ~500ms | ~100ms | doccli |
| Citation precision | Approximate | Exact line numbers | doccli |
| Offline usage | Requires API | Fully local | doccli |
| Semantic search | ✅ Better | Basic keyword | RAG |
| Structured output | Depends | Always | doccli |

**doccli sweet spot:** Fast, precise, local, structured citations. For semantic search needs, consider hybrid approach.

---

## Advanced Usage

### Environment Variables

```bash
# Multiple project support
export DOCCLI_PATHS="/path/to/project1/.doccli:/path/to/project2/.doccli"

# Now 'use' finds docs for any library
doccli use "Project1" "task..."
doccli use "Project2" "task..."
```

### Custom Index Locations

```bash
# Build to custom location
doccli build --src . --library "Foo" --version "1.0.0" --out /custom/path/index.json

# Query from custom location
doccli search "query" --index /custom/path/index.json
```

### Bootstrap (Code + Docs)

```bash
# Generate docs from source code + existing markdown
doccli bootstrap \
  --src . \
  --library "MyAPI" \
  --version "1.0.0" \
  --emit-manifest \
  --docs-out .doccli/generated-docs

# Creates:
# - .doccli/generated-docs/bootstrap.md (extracted symbols, routes, etc.)
# - .doccli/index.json (searchable index)
# - .doccli/doccli.json (manifest)
```

---

## Configuration

### .gitignore

```gitignore
# Index can be regenerated
.doccli/index.json

# Keep manifest in version control
!.doccli/doccli.json
```

### package.json Scripts

```json
{
  "scripts": {
    "docs:build": "doccli build --src . --library 'MyProject' --version \"$(cat VERSION)\"",
    "docs:stats": "doccli stats",
    "docs:test": "doccli use 'MyProject' 'How do I test?' --json"
  }
}
```

---

## Roadmap

### Version 0.2 (Planned)

- [ ] Semantic search with embeddings (optional)
- [ ] Multi-document synthesis
- [ ] Code example extraction (`doccli examples "backup" --type bash`)
- [ ] Batch query support
- [ ] Watch mode for auto-rebuild
- [ ] Web UI for documentation exploration

### Future

- [ ] Language support beyond markdown (reStructuredText, AsciiDoc)
- [ ] API server mode
- [ ] Plugin system for custom extractors
- [ ] Collaborative documentation quality scoring

---

## Performance

| Operation | Time | Notes |
|-----------|------|-------|
| Index 35 docs (229 sections) | ~2s | One-time operation |
| `stats` | ~10ms | Cached metadata |
| `search` | ~50ms | Fast keyword search |
| `use` | ~300ms | Includes ranking & extraction |
| `open` | ~100ms | Direct document access |

**Tested on:** M1 Mac, HabitatsOS codebase (35 docs, 229 sections)

---

## Testing

```bash
# Run test suite
npm test

# Output:
# ✔ build generates deterministic index hash
# ✔ search, open, and cite return expected fields
# ✔ list and stats expose index coverage metadata
# ✔ use resolves package manifest and returns citation-backed steps
# ✔ use resolves manifest when --path points at .doccli directory
# ✔ missing reference returns deterministic error code
# ✔ bootstrap generates docs and searchable index from codebase
# ✔ bootstrap emit-manifest enables immediate use resolution
# ℹ tests 8
# ℹ pass 8
```

---

## Contributing

Contributions welcome! Areas of interest:

1. **Semantic search**: Embeddings-based search for natural language queries
2. **Language support**: Support for non-markdown formats
3. **Extractors**: Better code symbol extraction (JSDoc, TypeScript, Go, etc.)
4. **Integrations**: MCP servers, LangChain tools, agent frameworks
5. **Documentation**: More examples, tutorials, case studies

See [CONTRIBUTING.md](./CONTRIBUTING.md) for guidelines.

---

## License

MIT License - see [LICENSE](./LICENSE) for details.

---

## Credits

Built by [Arkology Studio](https://github.com/arkologystudio) for the HabitatsOS project.

Tested and validated by Claude (Anthropic) - an AI agent who provided extensive UX feedback.

---

## Support

- **Documentation**: [/docs](./docs/)
- **Issues**: [GitHub Issues](https://github.com/your-org/doccli/issues)
- **Discussions**: [GitHub Discussions](https://github.com/your-org/doccli/discussions)

---

## Related Projects

- **HabitatsOS** - Deployment and operations layer for AI agent teams
- **OpenClaw** - Agentic gateway for AI workspaces
- **Claude Code** - AI pair programming CLI by Anthropic

---

**Built for agents, by agents.** 🤖

Give your AI agents the documentation access they deserve.

```bash
npm install -g doccli
doccli build --src . --library "YourProject" --version "1.0.0"
doccli use "YourProject" "How do I get started?"
```
