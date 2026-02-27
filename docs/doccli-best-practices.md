# DocCLI Best Practices

Optimization tips and decision guide for using doccli effectively.

## When to Use Which Command

### Decision Tree

```
Need documentation info?
│
├─ Want to know what's available?
│  └─> doccli stats / doccli list
│
├─ Have specific question/task?
│  │
│  ├─ Simple topic lookup? (e.g., "authentication")
│  │  └─> doccli search "authentication"
│  │
│  └─ Complex task? (e.g., "How do I deploy with rollback?")
│     └─> doccli use "MyProject" "How do I deploy with rollback?"
│
├─ Know exact doc location?
│  └─> doccli open "docs/guide#section"
│
└─ Need citation for reference?
   └─> doccli cite "docs/guide#section"
```

### Command Selection Guide

| Scenario | Best Command | Why |
|----------|-------------|-----|
| "What docs are available?" | `list` | Shows complete inventory |
| "How comprehensive is the documentation?" | `stats` | Gives overview metrics |
| "Where is the auth documentation?" | `search "auth"` | Fast keyword lookup |
| "How do I set up OAuth?" | `use "MyProject" "How to set up OAuth?"` | Task-specific guidance |
| "I need the exact deployment steps" | `open "docs/deploy#steps"` | Full content access |
| "Give me a source reference" | `cite "docs/deploy#steps"` | Citation string |

## Search vs. Use: When to Use Each

### Use `search` when:

✅ **Simple keyword lookup**
```bash
# ✓ Good use of search
doccli search "configuration"
doccli search "API endpoints"
doccli search "error codes"
```

✅ **Exploring unfamiliar codebase**
```bash
# First, see what's there
doccli search "architecture"
doccli search "getting started"
```

✅ **Finding specific term occurrences**
```bash
# Find all mentions of a concept
doccli search "rate limiting"
```

### Use `use` when:

✅ **Task-oriented questions**
```bash
# ✓ Good use of 'use'
doccli use "MyProject" "How do I deploy to production?"
doccli use "MyProject" "What are the backup procedures?"
doccli use "MyProject" "How do I troubleshoot connection errors?"
```

✅ **Need actionable steps**
```bash
# When you want citation-backed instructions
doccli use "MyProject" "How do I configure SSL certificates?"
```

✅ **Want related context**
```bash
# 'use' returns related_docs for exploration
doccli use "MyProject" "How does authentication work?"
# Returns related: docs/auth-guide, docs/security, docs/api-reference
```

### ⚠️ Anti-patterns

❌ **Don't use `use` for simple lookups**
```bash
# ✗ Bad: overkill for simple lookup
doccli use "MyProject" "config file"

# ✓ Better: use search
doccli search "config file"
```

❌ **Don't use `search` for complex questions**
```bash
# ✗ Bad: won't get actionable answer
doccli search "how to deploy with zero downtime and rollback capability"

# ✓ Better: use 'use'
doccli use "MyProject" "How do I deploy with zero downtime and rollback?"
```

## Agent Workflow Patterns

### Pattern 1: Discovery → Query → Execute

**Best for:** Autonomous agents executing tasks

```python
# Step 1: Discover (once per session)
stats = run_cmd('doccli stats --json')
if stats['docs_count'] == 0:
    fallback_to_file_search()

# Step 2: Query
response = run_cmd('doccli use "Project" "task description" --json')

# Step 3: Execute based on confidence
for step in response['steps']:
    if step['confidence'] > 0.8:
        execute(step['command'])
    elif step['confidence'] > 0.5:
        suggest_to_user(step['instruction'])
    else:
        flag_for_review(step)
```

### Pattern 2: Search → Open → Synthesize

**Best for:** Agents doing research/analysis

```python
# Step 1: Broad search
results = run_cmd('doccli search "deployment" --json')

# Step 2: Open top results
docs = []
for result in results['results'][:3]:
    doc = run_cmd(f'doccli open "{result["doc_id"]}" --json')
    docs.append(doc)

# Step 3: Synthesize information
# (Agent combines information from multiple docs)
```

### Pattern 3: Use → Related → Deep Dive

**Best for:** Agents building comprehensive understanding

```python
# Step 1: Initial query
response = run_cmd('doccli use "Project" "authentication flow" --json')

# Step 2: Check confidence
if response['confidence'] == 'partial':
    # Step 3: Explore related docs
    for doc_id in response['related_docs']:
        doc = run_cmd(f'doccli open "{doc_id}" --json')
        # Build knowledge graph
```

## Performance Optimization

### 1. Choose Lightweight Commands

| Command | Typical Time | Use When |
|---------|--------------|----------|
| `stats` | ~10ms | Need overview |
| `list` | ~20ms | Need inventory |
| `search` | ~50ms | Keyword lookup |
| `cite` | ~30ms | Just need reference |
| `open` | ~100ms | Need full content |
| `use` | ~300ms | Need task guidance |

**Optimization:** Use faster commands when possible.

```bash
# ✗ Slow: using 'use' just to check if docs exist
doccli use "MyProject" "what is available" --json

# ✓ Fast: use stats
doccli stats --json
```

### 2. Limit Result Sets

```bash
# Faster: limit results
doccli search "deploy" --max-results 3

# Slower: default (10 results)
doccli search "deploy"
```

### 3. Cache Repeated Queries

```python
from functools import lru_cache
import hashlib

@lru_cache(maxsize=128)
def cached_query(library, task):
    # Cache based on task hash
    return query_documentation(library, task)

# First call: ~300ms
result1 = cached_query("MyProject", "How to deploy?")

# Second call: <1ms (cached)
result2 = cached_query("MyProject", "How to deploy?")
```

### 4. Use JSON for Programmatic Access

```bash
# Slower: parse human-readable output
output=$(doccli search "test")
# Parse text output...

# Faster: use JSON
output=$(doccli search "test" --json)
# Parse JSON (structured, predictable)
```

### 5. Batch Related Operations

```bash
# ✗ Inefficient: multiple separate calls
doccli search "backup" --json
doccli search "restore" --json
doccli search "recovery" --json

# ✓ Better: combined query
doccli search "backup restore recovery" --json
# Or use 'use' for related concepts:
doccli use "MyProject" "backup and restore procedures" --json
```

## Confidence Score Interpretation

### Understanding Confidence Values

| Confidence | Meaning | Recommended Action |
|------------|---------|-------------------|
| 1.0 | Direct match, exact answer | Execute autonomously |
| 0.8 - 0.99 | High relevance | Execute with logging |
| 0.5 - 0.79 | Relevant but incomplete | Suggest to user/agent |
| 0.3 - 0.49 | Related context | Use for background info |
| < 0.3 | Tangentially related | Flag for review/ignore |

### Confidence-Based Decision Making

```python
def decide_action(step):
    conf = step['confidence']

    if conf >= 0.8:
        # Autonomous execution
        return {
            'action': 'execute',
            'supervision': 'none',
            'logging': 'standard'
        }

    elif conf >= 0.6:
        # Execute with confirmation
        return {
            'action': 'suggest',
            'supervision': 'user_approval',
            'logging': 'detailed'
        }

    elif conf >= 0.4:
        # Provide context only
        return {
            'action': 'inform',
            'supervision': 'required',
            'logging': 'detailed'
        }

    else:
        # Skip or flag
        return {
            'action': 'skip',
            'supervision': 'n/a',
            'logging': 'minimal'
        }
```

### Overall Response Confidence

```python
response = query_documentation("MyProject", "How to backup?")

if response['confidence'] == 'authoritative':
    # Full answer found with strong citations
    proceed_confidently()

elif response['confidence'] == 'partial':
    # Some information found, but incomplete
    # Check related_docs for more info
    explore_related_docs(response['related_docs'])
```

## Citation Best Practices

### When to Capture Citations

✅ **Always capture when:**
- Making decisions based on documentation
- Executing commands from docs
- Reporting to users
- Auditing agent actions
- Building knowledge bases

### Citation Storage Format

```json
{
  "action": "deploy_to_production",
  "timestamp": "2026-02-27T10:30:00Z",
  "sources": [
    {
      "citation": "MyProject@1.0.0:docs/deploy#production:45-67",
      "confidence": 0.95,
      "doc_path": "docs/deploy.md",
      "line_start": 45
    }
  ],
  "decision": "Executed './deploy.sh prod' based on documented procedure"
}
```

### Using Citations for Debugging

```python
def execute_with_audit_trail(step):
    """Execute step and log citation for debugging"""

    # Execute
    result = subprocess.run(step['command'], shell=True, capture_output=True)

    # Log with citation
    audit_log = {
        'command': step['command'],
        'exit_code': result.returncode,
        'stdout': result.stdout,
        'stderr': result.stderr,
        'source_citation': step['citations'][0],
        'confidence': step['confidence']
    }

    # If failure, citation helps debug:
    # "Command failed, but was documented at docs/deploy.md:45"
    # Can verify if docs are wrong or execution context is different

    return audit_log
```

## Index Maintenance

### When to Rebuild Index

1. **After documentation changes**
   ```bash
   # In git hooks or CI
   doccli build --src . --library "MyProject" --version "$(cat VERSION)"
   ```

2. **When stats show staleness**
   ```python
   stats = run_cmd('doccli stats --json')
   built_at = datetime.fromisoformat(stats['built_at'])
   age_hours = (datetime.now(timezone.utc) - built_at).total_seconds() / 3600

   if age_hours > 24:
       rebuild_index()
   ```

3. **Version changes**
   ```bash
   # On release
   NEW_VERSION="1.1.0"
   doccli build --src . --library "MyProject" --version "$NEW_VERSION"
   ```

### Index Size Considerations

| Docs | Sections | Index Size | Build Time |
|------|----------|------------|------------|
| 10 | 50 | ~50KB | <1s |
| 50 | 300 | ~200KB | ~2s |
| 100 | 800 | ~500KB | ~5s |
| 500 | 5000 | ~3MB | ~30s |

**Tip:** Index size is usually negligible. Don't optimize prematurely.

### Incremental Updates

```bash
# Full rebuild (simple, always works)
doccli build --src . --library "MyProject" --version "1.0.0"

# For large repos, consider:
# 1. Only rebuild when docs/ changes (in CI)
# 2. Cache index in CI artifacts
# 3. Distribute pre-built index with releases
```

## Error Handling Strategies

### 1. Graceful Degradation

```python
def query_with_fallback(library, task):
    """Try doccli, fall back to file search"""
    try:
        response = query_documentation(library, task)
        return response
    except Exception as e:
        print(f"⚠️  doccli failed: {e}")
        print("Falling back to file search...")
        return fallback_file_search(task)
```

### 2. Validate Before Use

```python
def validate_index(project_path):
    """Check if index is usable"""
    try:
        stats = run_cmd('doccli stats --json', cwd=project_path)

        if stats['docs_count'] == 0:
            raise ValueError("Index is empty")

        built_at = datetime.fromisoformat(stats['built_at'])
        age_days = (datetime.now(timezone.utc) - built_at).days

        if age_days > 7:
            print(f"⚠️  Index is {age_days} days old")

        return True

    except Exception as e:
        print(f"❌ Index validation failed: {e}")
        return False
```

### 3. Handle Missing References

```python
def safe_open_doc(doc_id):
    """Open document with error handling"""
    try:
        result = run_cmd(f'doccli open "{doc_id}" --json')
        return result
    except subprocess.CalledProcessError as e:
        if 'REF_NOT_FOUND' in e.stderr:
            # Try search as fallback
            search_term = doc_id.split('#')[0]
            results = run_cmd(f'doccli search "{search_term}" --json')
            if results['results']:
                # Return closest match
                return run_cmd(f'doccli open "{results["results"][0]["doc_id"]}" --json')
        raise
```

## Multi-Project Scenarios

### Managing Multiple Libraries

```python
class MultiProjectDocs:
    """Handle multiple project documentation"""

    def __init__(self):
        self.projects = {
            'backend': {
                'path': '/path/to/backend',
                'library': 'BackendAPI'
            },
            'frontend': {
                'path': '/path/to/frontend',
                'library': 'FrontendApp'
            }
        }

    def query(self, project_name, task):
        """Query specific project docs"""
        project = self.projects[project_name]
        return query_documentation(
            project['library'],
            task,
            project['path']
        )

    def search_all(self, keyword):
        """Search across all projects"""
        results = {}
        for name, project in self.projects.items():
            try:
                result = run_cmd(
                    f'doccli search "{keyword}" --json',
                    cwd=project['path']
                )
                results[name] = result
            except Exception as e:
                results[name] = {'error': str(e)}
        return results
```

### Environment Variables for Multiple Projects

```bash
# Set up search paths for multiple projects
export DOCCLI_PATHS="/path/to/project1/.doccli:/path/to/project2/.doccli"

# Now 'use' command can find docs for any library
doccli use "Project1" "task..."
doccli use "Project2" "task..."
```

## Testing Your Documentation

### 1. Validate Documentation Coverage

```bash
# Check stats
doccli stats --json | jq '{
  docs: .docs_count,
  sections: .sections_count,
  avg_sections_per_doc: .sections_per_doc,
  code_blocks: .code_blocks_count
}'

# Low sections_per_doc might indicate sparse docs
```

### 2. Test Common Queries

```bash
#!/bin/bash
# test-docs-coverage.sh

common_queries=(
  "How do I install?"
  "How do I deploy?"
  "How do I troubleshoot errors?"
  "What are the configuration options?"
)

for query in "${common_queries[@]}"; do
  echo "Testing: $query"
  result=$(doccli use "MyProject" "$query" --json)
  confidence=$(echo "$result" | jq -r '.confidence')
  steps=$(echo "$result" | jq -r '.steps | length')

  if [ "$confidence" = "authoritative" ] && [ "$steps" -gt 0 ]; then
    echo "  ✅ Good coverage"
  else
    echo "  ⚠️  Weak coverage (confidence: $confidence, steps: $steps)"
  fi
done
```

### 3. Citation Quality Check

```bash
# Verify citations are reachable
doccli use "MyProject" "How to deploy?" --json | \
  jq -r '.steps[].citations[]' | \
  while read citation; do
    # Extract doc_id#anchor from citation
    ref=$(echo "$citation" | cut -d: -f2)
    doccli open "$ref" > /dev/null 2>&1
    if [ $? -eq 0 ]; then
      echo "✅ $ref"
    else
      echo "❌ $ref (broken citation)"
    fi
  done
```

## Common Pitfalls to Avoid

### ❌ Pitfall 1: Over-relying on `use` Command

```python
# ✗ Bad: using 'use' for everything
doccli use "Project" "version"  # Overkill
doccli use "Project" "readme"   # Just open it
doccli use "Project" "config"   # Just search

# ✓ Better: right tool for the job
doccli stats  # version is in stats
doccli open "readme"  # direct access
doccli search "config"  # quick lookup
```

### ❌ Pitfall 2: Ignoring Confidence Scores

```python
# ✗ Bad: blind execution
response = query_docs("MyProject", "How to delete database?")
execute(response['steps'][0]['command'])  # Dangerous!

# ✓ Better: check confidence
response = query_docs("MyProject", "How to delete database?")
if response['steps'][0]['confidence'] < 0.9:
    require_human_confirmation()
```

### ❌ Pitfall 3: Not Following Related Docs

```python
# ✗ Bad: ignoring context
response = query_docs("MyProject", "How to deploy?")
if len(response['steps']) == 0:
    give_up()

# ✓ Better: explore related docs
response = query_docs("MyProject", "How to deploy?")
if len(response['steps']) == 0:
    for doc_id in response['related_docs']:
        explore(doc_id)
```

### ❌ Pitfall 4: Stale Index

```python
# ✗ Bad: never rebuilding
# (index gets stale as docs change)

# ✓ Better: rebuild regularly
if index_age_hours() > 24:
    rebuild_index()
```

### ❌ Pitfall 5: No Error Handling

```python
# ✗ Bad: assuming success
result = subprocess.run(['doccli', 'use', ...])
data = json.loads(result.stdout)

# ✓ Better: handle errors
try:
    result = subprocess.run(['doccli', 'use', ...],
                          capture_output=True,
                          timeout=10,
                          check=True)
    data = json.loads(result.stdout)
except subprocess.CalledProcessError as e:
    handle_doccli_error(e)
except json.JSONDecodeError:
    handle_invalid_json()
except subprocess.TimeoutExpired:
    handle_timeout()
```

## Summary: Quick Decision Guide

### Start Here

```
1. First time with a codebase?
   └─> doccli stats (see what's available)

2. Looking for something specific?
   └─> doccli search "keyword"

3. Need to do a task?
   └─> doccli use "Project" "How to..."

4. Want full document?
   └─> doccli open "doc-id"

5. Need to cite?
   └─> doccli cite "doc-id#section"
```

### Golden Rules

1. ✅ **Use the lightest command** that gives you what you need
2. ✅ **Check confidence scores** before autonomous execution
3. ✅ **Follow related_docs** when initial answer is weak
4. ✅ **Cache repeated queries** for performance
5. ✅ **Handle errors gracefully** with fallbacks
6. ✅ **Rebuild index** when docs change
7. ✅ **Capture citations** for audit trails
8. ✅ **Test documentation coverage** with common queries

## Next Steps

- See [Quick Start Guide](./doccli-quick-start.md) for getting started
- See [Agent Integration Guide](./doccli-agent-integration.md) for AI agent workflows
- Check [JSON Output Schema](./json_output_schema.md) for response formats
