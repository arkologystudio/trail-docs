# DocCLI Agent Integration Guide

How to integrate doc-nav into AI agent systems for intelligent documentation retrieval.

## Overview

doc-nav is designed specifically for AI agents. This guide shows you how to integrate it into your agent workflows for efficient, citation-backed documentation access.

## Why doc-nav for Agents?

### Traditional Approach Problems
- 📂 Reading entire doc directories is token-expensive
- 🔍 Grep/file search requires multiple rounds of trial-and-error
- 📝 No structured way to cite sources
- 🎯 Hard to get actionable steps from raw documentation

### doc-nav Solution
- ✅ Pre-indexed, fast search (no file I/O spam)
- ✅ Natural language queries with citation-backed answers
- ✅ Confidence scores guide next actions
- ✅ Structured JSON output for easy parsing
- ✅ Related docs suggest exploration paths

## Integration Architecture

```
┌─────────────────┐
│   Your Agent    │
│   (Claude, etc) │
└────────┬────────┘
         │
         │ Shell command or API wrapper
         │
┌────────▼────────┐
│     doc-nav      │
│  (CLI process)  │
└────────┬────────┘
         │
         │ Reads from
         │
┌────────▼────────┐
│ .doc-nav/        │
│  index.json     │
│  doc-nav.json    │
└─────────────────┘
```

### Optional External Research Path

For unknown libraries, add an acquisition phase before query:

1. `doc-nav discover "<library>" ...`
2. `doc-nav fetch "<selector>" ...`
3. `doc-nav build --source-manifest ...`
4. `doc-nav use ...`

This keeps citations tied to pinned external refs (`resolved_ref`) and preserves provenance in JSON outputs.

## Basic Integration Pattern

### 1. Discovery Phase

When an agent first encounters a codebase:

```python
import subprocess
import json

def discover_documentation(project_path):
    """Agent discovers available documentation"""

    # Get index statistics
    result = subprocess.run(
        ['doc-nav', 'stats', '--json'],
        cwd=project_path,
        capture_output=True,
        text=True
    )

    stats = json.loads(result.stdout)

    # Now agent knows:
    # - How many docs exist (stats['docs_count'])
    # - How comprehensive it is (stats['sections_count'])
    # - How fresh it is (stats['built_at'])

    return stats

# Agent decision:
stats = discover_documentation('/path/to/project')
if stats['docs_count'] > 0:
    print(f"📚 Found {stats['docs_count']} documentation files")
    # Proceed with doc-nav-based lookup
else:
    print("⚠️  No documentation index found, falling back to file search")
```

### 2. Query Phase

When an agent needs information:

```python
def query_documentation(library, task, project_path):
    """Agent queries for task-specific guidance"""

    result = subprocess.run(
        [
            'doc-nav', 'use', library, task,
            '--path', f'{project_path}/.doc-nav',
            '--max-results', '5',
            '--json'
        ],
        capture_output=True,
        text=True
    )

    response = json.loads(result.stdout)

    return response

# Example usage:
task = "How do I deploy to production?"
response = query_documentation("MyProject", task, "/path/to/project")

# Agent now has:
# - response['confidence']: 'authoritative' or 'partial'
# - response['steps']: List of citation-backed steps
# - response['related_docs']: Docs for deeper exploration
# - response['citation_details']: Optional provenance per citation
```

### 3. Execution Phase

Agent uses the structured response:

```python
def execute_with_citations(response):
    """Agent executes steps with citation tracking"""

    if response['confidence'] != 'authoritative':
        print("⚠️  Low confidence response, may need human review")

    for step in response['steps']:
        confidence = step['confidence']
        instruction = step['instruction']
        citations = step['citations']

        # High confidence: execute directly
        if confidence > 0.8:
            print(f"✅ [{confidence}] {instruction}")
            if 'command' in step:
                print(f"   Command: {step['command']}")
            # Execute command or follow instruction

        # Medium confidence: suggest to user
        elif confidence > 0.5:
            print(f"💡 [{confidence}] Consider: {instruction}")

        # Low confidence: flag for review
        else:
            print(f"🤔 [{confidence}] Uncertain: {instruction}")

        # Always track citations
        print(f"   Source: {', '.join(citations)}")
```

## Advanced Integration Patterns

### Pattern 1: Iterative Refinement

Agent doesn't understand the first result:

```python
def iterative_lookup(library, initial_task, project_path):
    """Agent refines its search through multiple queries"""

    # First attempt
    response = query_documentation(library, initial_task, project_path)

    # If low confidence or no actionable steps
    if response['confidence'] == 'partial' or len(response['steps']) == 0:

        # Try keyword search instead
        keywords = extract_keywords(initial_task)
        search_result = subprocess.run(
            ['doc-nav', 'search', keywords, '--json'],
            cwd=project_path,
            capture_output=True,
            text=True
        )

        results = json.loads(search_result.stdout)

        # Open top result for more context
        if results['results']:
            top_doc = results['results'][0]
            doc_content = subprocess.run(
                ['doc-nav', 'open', f"{top_doc['doc_id']}#{top_doc['anchor']}", '--json'],
                cwd=project_path,
                capture_output=True,
                text=True
            )

            content = json.loads(doc_content.stdout)
            # Agent now has full content to reason over
            return content

    return response
```

### Pattern 2: Citation-Driven Exploration

Agent follows related docs:

```python
def explore_related(library, initial_task, project_path, max_depth=2):
    """Agent explores related documentation automatically"""

    visited = set()
    to_explore = [(initial_task, 0)]  # (task, depth)

    while to_explore:
        task, depth = to_explore.pop(0)

        if depth >= max_depth:
            continue

        response = query_documentation(library, task, project_path)

        # Extract related docs
        for doc_id in response.get('related_docs', []):
            if doc_id not in visited:
                visited.add(doc_id)

                # Open related doc
                doc_result = subprocess.run(
                    ['doc-nav', 'open', doc_id, '--json'],
                    cwd=project_path,
                    capture_output=True,
                    text=True
                )

                doc = json.loads(doc_result.stdout)

                # Agent can now build a knowledge graph
                print(f"📄 Related: {doc['doc_id']} - {doc['heading']}")

                # Optionally explore deeper
                # to_explore.append((doc['heading'], depth + 1))
```

### Pattern 3: Confidence-Based Action

Agent makes decisions based on confidence scores:

```python
def confidence_based_execution(response):
    """Agent adjusts behavior based on confidence"""

    high_conf_steps = [s for s in response['steps'] if s['confidence'] > 0.8]
    med_conf_steps = [s for s in response['steps'] if 0.5 < s['confidence'] <= 0.8]
    low_conf_steps = [s for s in response['steps'] if s['confidence'] <= 0.5]

    # Strategy 1: High confidence - execute autonomously
    if len(high_conf_steps) >= 2:
        print("✅ Confident answer found, executing autonomously")
        for step in high_conf_steps:
            execute_step(step)
        return "autonomous"

    # Strategy 2: Medium confidence - suggest with context
    elif len(med_conf_steps) > 0:
        print("💡 Partial answer found, suggesting to user")
        for step in med_conf_steps:
            present_suggestion(step)
        return "suggest"

    # Strategy 3: Low confidence - request human guidance
    else:
        print("🤔 Uncertain, requesting human guidance")
        print("Related docs for context:", response.get('related_docs', []))
        return "escalate"
```

## Integration Examples

### Example 1: Claude Code Integration

```python
class DocCLITool:
    """Minimal wrapper for Claude Code-style agents"""

    def __init__(self, project_path, library_name):
        self.project_path = project_path
        self.library_name = library_name

    def query(self, task):
        """Natural language query"""
        result = subprocess.run(
            [
                'doc-nav', 'use', self.library_name, task,
                '--path', f'{self.project_path}/.doc-nav',
                '--json'
            ],
            capture_output=True,
            text=True,
            check=True
        )
        return json.loads(result.stdout)

    def search(self, keywords):
        """Keyword search"""
        result = subprocess.run(
            ['doc-nav', 'search', keywords, '--json'],
            cwd=self.project_path,
            capture_output=True,
            text=True,
            check=True
        )
        return json.loads(result.stdout)

    def get_doc(self, doc_id):
        """Get full document content"""
        result = subprocess.run(
            ['doc-nav', 'open', doc_id, '--json'],
            cwd=self.project_path,
            capture_output=True,
            text=True,
            check=True
        )
        return json.loads(result.stdout)

# Usage in agent:
docs = DocCLITool('/path/to/project', 'MyProject')

# Agent receives user request: "Deploy to production"
response = docs.query("How do I deploy to production?")

# Agent formats response for user:
print(f"Here's how to deploy (confidence: {response['confidence']}):")
for step in response['steps']:
    print(f"{step['id']}. {step['instruction']}")
    if 'command' in step:
        print(f"   Run: {step['command']}")
```

### Example 2: MCP Server Tool Integration

```typescript
// MCP server exposing doc-nav as a tool
import { McpServer } from '@modelcontextprotocol/sdk';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

const server = new McpServer({
  name: 'doc-nav-mcp-server',
  version: '1.0.0'
});

server.tool('query-docs', {
  description: 'Query project documentation with natural language',
  parameters: {
    library: { type: 'string', description: 'Library name' },
    task: { type: 'string', description: 'Task description or question' },
    max_results: { type: 'number', default: 5 }
  },
  handler: async ({ library, task, max_results }) => {
    const { stdout } = await execAsync(
      `doc-nav use "${library}" "${task}" --path .doc-nav --max-results ${max_results} --json`
    );

    const response = JSON.parse(stdout);

    // Format for agent consumption
    return {
      confidence: response.confidence,
      steps: response.steps.map(s => ({
        instruction: s.instruction,
        confidence: s.confidence,
        command: s.command,
        citations: s.citations
      })),
      related_docs: response.related_docs
    };
  }
});

server.tool('search-docs', {
  description: 'Search documentation by keywords',
  parameters: {
    query: { type: 'string', description: 'Search query' },
    max_results: { type: 'number', default: 10 }
  },
  handler: async ({ query, max_results }) => {
    const { stdout } = await execAsync(
      `doc-nav search "${query}" --max-results ${max_results} --json`
    );

    const response = JSON.parse(stdout);

    return {
      results: response.results.map(r => ({
        doc_id: r.doc_id,
        heading: r.heading,
        score: r.score,
        snippet: r.snippet
      }))
    };
  }
});
```

### Example 3: Autonomous Agent Loop

```python
class AutonomousAgent:
    """Agent that uses doc-nav for self-guided task execution"""

    def __init__(self, project_path, library_name):
        self.docs = DocCLITool(project_path, library_name)
        self.execution_log = []

    def execute_task(self, user_request):
        """Autonomous task execution with documentation guidance"""

        # 1. Query documentation
        response = self.docs.query(user_request)

        self.log(f"User request: {user_request}")
        self.log(f"Confidence: {response['confidence']}")

        # 2. Filter high-confidence steps
        executable_steps = [
            s for s in response['steps']
            if s['confidence'] > 0.7 and 'command' in s
        ]

        if not executable_steps:
            self.log("❌ No high-confidence executable steps found")
            return self.escalate_to_human(response)

        # 3. Execute each step
        for step in executable_steps:
            self.log(f"\n▶️  Executing: {step['instruction']}")
            self.log(f"   Confidence: {step['confidence']}")
            self.log(f"   Citation: {step['citations'][0]}")

            # Check prerequisites
            if 'prerequisites' in step:
                self.log(f"   Prerequisites: {step['prerequisites']}")
                # Verify prerequisites met (implementation-specific)

            # Execute command
            try:
                result = subprocess.run(
                    step['command'],
                    shell=True,
                    capture_output=True,
                    text=True,
                    timeout=30
                )

                if result.returncode == 0:
                    self.log(f"   ✅ Success: {result.stdout[:100]}")
                else:
                    self.log(f"   ❌ Failed: {result.stderr[:100]}")

                    # On failure, check related docs
                    self.explore_troubleshooting(response['related_docs'])
                    break

            except Exception as e:
                self.log(f"   ❌ Exception: {str(e)}")
                break

        return self.execution_log

    def explore_troubleshooting(self, related_docs):
        """When a step fails, explore related docs for help"""
        self.log("\n🔍 Exploring related documentation for troubleshooting...")

        for doc_id in related_docs[:3]:  # Check top 3 related docs
            doc = self.docs.get_doc(doc_id)
            self.log(f"\n📄 {doc['heading']}")
            self.log(f"   {doc['content'][:200]}...")

    def escalate_to_human(self, response):
        """When agent can't proceed, provide human with context"""
        return {
            'status': 'needs_human',
            'reason': 'Low confidence or no executable steps',
            'related_docs': response.get('related_docs', []),
            'partial_steps': response.get('steps', [])
        }

    def log(self, message):
        self.execution_log.append(message)
        print(message)
```

## Best Practices for Agent Integration

### 1. Always Check Index Freshness

```python
def ensure_fresh_index(project_path, max_age_hours=24):
    """Rebuild index if stale"""
    stats_result = subprocess.run(
        ['doc-nav', 'stats', '--json'],
        cwd=project_path,
        capture_output=True,
        text=True
    )

    stats = json.loads(stats_result.stdout)
    built_at = datetime.fromisoformat(stats['built_at'])

    age_hours = (datetime.now(timezone.utc) - built_at).total_seconds() / 3600

    if age_hours > max_age_hours:
        print(f"🔄 Index is {age_hours:.1f}h old, rebuilding...")
        rebuild_index(project_path)
```

### 2. Use Confidence Scores Wisely

```python
CONFIDENCE_THRESHOLDS = {
    'execute_autonomously': 0.8,
    'suggest_to_user': 0.5,
    'flag_for_review': 0.0
}

def handle_by_confidence(step):
    confidence = step['confidence']

    if confidence >= CONFIDENCE_THRESHOLDS['execute_autonomously']:
        return 'execute'
    elif confidence >= CONFIDENCE_THRESHOLDS['suggest_to_user']:
        return 'suggest'
    else:
        return 'review'
```

### 3. Follow Related Docs Strategically

```python
def should_explore_related(response, current_depth, max_depth=2):
    """Decide if agent should explore related docs"""

    # Don't explore if we have high-confidence answer
    if response['confidence'] == 'authoritative':
        high_conf_count = sum(1 for s in response['steps'] if s['confidence'] > 0.8)
        if high_conf_count >= 2:
            return False

    # Don't exceed depth limit
    if current_depth >= max_depth:
        return False

    # Explore if we have partial answer with related docs
    if response['confidence'] == 'partial' and response.get('related_docs'):
        return True

    return False
```

### 4. Cache Responses

```python
import hashlib
from functools import lru_cache

@lru_cache(maxsize=128)
def cached_query(library, task, project_path):
    """Cache documentation queries to avoid redundant calls"""
    cache_key = hashlib.md5(f"{library}:{task}".encode()).hexdigest()
    # Implementation...
    return query_documentation(library, task, project_path)
```

### 5. Handle Errors Gracefully

```python
def safe_query(library, task, project_path, fallback=None):
    """Query with error handling"""
    try:
        result = subprocess.run(
            ['doc-nav', 'use', library, task, '--path', f'{project_path}/.doc-nav', '--json'],
            capture_output=True,
            text=True,
            timeout=10
        )

        if result.returncode != 0:
            print(f"⚠️  doc-nav error: {result.stderr}")
            return fallback

        return json.loads(result.stdout)

    except subprocess.TimeoutExpired:
        print("⚠️  doc-nav query timed out")
        return fallback
    except json.JSONDecodeError:
        print("⚠️  Invalid JSON response from doc-nav")
        return fallback
    except Exception as e:
        print(f"⚠️  Unexpected error: {e}")
        return fallback
```

## Performance Considerations

### Query Performance

- **Fast**: Search, cite, list, stats (~10-50ms)
- **Medium**: open (~50-200ms)
- **Slower**: use (~200-500ms, does ranking and extraction)

### Optimization Tips

1. **Use `search` for simple lookups** before `use`
2. **Limit `--max-results`** to reduce processing time
3. **Cache query results** for repeated questions
4. **Use `stats` once at startup**, not per query

## Testing Your Integration

```python
def test_doc-nav_integration():
    """Test suite for doc-nav integration"""

    project_path = '/path/to/test/project'
    library = 'TestProject'

    # Test 1: Index exists and is valid
    stats = discover_documentation(project_path)
    assert stats['docs_count'] > 0, "Index should contain docs"

    # Test 2: Search returns results
    search_result = subprocess.run(
        ['doc-nav', 'search', 'test', '--json'],
        cwd=project_path,
        capture_output=True,
        text=True
    )
    results = json.loads(search_result.stdout)
    assert len(results['results']) > 0, "Search should return results"

    # Test 3: Use command works
    response = query_documentation(library, "How do I test?", project_path)
    assert 'steps' in response, "Response should contain steps"
    assert 'confidence' in response, "Response should contain confidence"

    # Test 4: Citations are valid
    if response['steps']:
        first_citation = response['steps'][0]['citations'][0]
        assert library in first_citation, "Citation should reference library"

    print("✅ All integration tests passed")
```

## Troubleshooting Integration Issues

### Issue: "Command not found: doc-nav"

**Solution:** Ensure doc-nav is in PATH or use absolute path:
```python
DOCCLI_PATH = '/usr/local/bin/doc-nav'  # or full path
subprocess.run([DOCCLI_PATH, 'stats', ...])
```

### Issue: JSON parsing errors

**Solution:** Always validate JSON before parsing:
```python
try:
    response = json.loads(result.stdout)
except json.JSONDecodeError as e:
    print(f"Invalid JSON: {result.stdout}")
    print(f"Error: {e}")
```

### Issue: Subprocess hangs

**Solution:** Always set timeout:
```python
subprocess.run([...], timeout=10)  # 10 second timeout
```

## Next Steps

- See [Quick Start Guide](./doc-nav-quick-start.md) for basic usage
- See [Best Practices](./doc-nav-best-practices.md) for optimization tips
- Check [JSON Output Schema](./json_output_schema.md) for response formats
