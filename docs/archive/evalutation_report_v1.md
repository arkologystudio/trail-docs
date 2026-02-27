DocCLI Evaluation Report (v 0.1.0)

  Executive Summary

  doccli is a documentation indexing and retrieval CLI tool designed to help AI agents efficiently access project documentation. After
  rebuilding the HabitatsOS index (35 docs, 229 sections) and testing all commands, I've identified both strengths and areas for
  improvement.

  What Works Well ✅

  1. Search Functionality

  - Fast, scored search results with relevance ranking
  - Clean output showing doc_id, anchor, heading, and score
  - JSON mode provides rich metadata (snippets, line ranges)
  - Handles "no results" gracefully

  2. Citation System

  - Compact, precise citation format: library@version:doc_id#anchor:line_start-line_end
  - Easy to trace back to source files
  - Citations include both logical ID and physical file path

  3. Document Opening

  - Direct access to specific sections via anchor references
  - Configurable character limits for content preview
  - Clear source attribution with line numbers

  4. Build Process

  - Fast indexing (35 docs processed quickly)
  - Reproducible with source hash verification
  - Clean separation of concerns (build vs bootstrap)

  ---
  Technical Improvements Needed

  Critical Issues

  1. Manifest Naming Confusion ⚠️
    - Bootstrap creates manifest.json but use command looks for doccli.json
    - Impact: "use" command fails immediately after bootstrap without manual file rename
    - Fix: Standardize on one filename or have bootstrap create both
  2. Use Command Content Truncation ⚠️
    - Steps often show incomplete content: "1." or "Use this exact sequence..." without the actual sequence
    - Example: When asking "What is the operator?", got truncated text instead of explanation
    - Root cause: Appears to extract section headers rather than content
    - Fix: Implement better content extraction that includes full paragraphs/code blocks, not just opening lines
  3. Bootstrap vs Build Confusion
    - Bootstrap only scanned "3 files, 2 symbols" for a 35-document repository
    - Build command properly indexed all 35 docs with 229 sections
    - Issue: Unclear when to use bootstrap vs build, and bootstrap seems incomplete
    - Fix: Better documentation of use cases, or merge functionality

  API/Interface Issues

  4. Path Resolution Logic
    - --path parameter behavior is non-intuitive
    - When passed .doccli, still looks for doccli/doccli.json instead of .doccli/doccli.json
    - Fix: Improve path resolution to check for manifest in the exact path provided
  5. Missing Index Auto-detection
    - Commands like search, open, cite default to .doccli/index.json
    - use command requires explicit path/DOCCLI_PATHS setup
    - Inconsistency: Why doesn't use default to .doccli/ like other commands?
    - Fix: Make all commands use consistent default paths

  Error Messages

  6. Generic Resolution Errors
    - Error: "RESOLUTION_FAILED: Could not locate docs manifest for library HabitatsOS"
    - Issue: Doesn't show which paths were checked
    - Fix: List all searched paths in error message for debugging

  ---
  Developer UX Improvements

  Documentation Gaps

  1. Workflow Documentation Missing
  # This workflow isn't documented anywhere:
  doccli build --src . --library "MyLib" --version "1.0.0" --out .doccli/index.json
  echo '{"schema_version":"1","library":"MyLib","library_version":"1.0.0","index_path":"index.json"}' > .doccli/doccli.json
  doccli use "MyLib" "How do I...?" --path .doccli
  1. Need: Quick start guide showing full workflow from scratch
  2. Command Purpose Unclear
    - When should I use bootstrap vs build?
    - What does bootstrap actually do with "generated-docs"?
    - What is the "use" command's intended use case vs. "search"?

  Fix: Add clear command descriptions and examples in --help
  3. No Validation Feedback
    - After build, no way to verify index quality
    - No command to list indexed docs or check coverage

  Fix: Add doccli list or doccli stats command

  CLI Ergonomics

  4. Verbose Flag Names
  # Current
  --max-results
  --max-chars

  # Better
  -n, --max-results
  -c, --max-chars
  5. No Interactive Mode
    - For quick exploration, an interactive REPL would be helpful:
  doccli shell HabitatsOS
  > search backup
  > open docs/runbook-backup-restore
  > use "How do I restore?"
  6. No Piping Support
    - Can't easily pipe results to other tools
    - JSON mode helps but could be better:
  doccli search "backup" --json | jq -r '.results[].doc_id'

  ---
  Agent UX Improvements (Critical for AI Agents)

  High Priority for Agents Like Me

  1. "Use" Command Needs Major Improvement 🤖

  1. Current Problems:
    - Returns truncated content that's not actionable
    - Steps are often just fragments: "1." or partial sentences
    - Doesn't synthesize information from multiple sources well
    - No confidence scoring on individual steps

  What Agents Need:
    - Complete, actionable instructions with full commands/code
    - Context-aware responses that understand the question type (how-to vs. what-is vs. why)
    - Prioritized results with confidence scores
    - Related documents suggestions for follow-up

  Example of Ideal Output:
  Task: "How do I perform a backup?"

  step_1 [confidence: 0.95] Check your backup mode
    Command: ./habitatsctl backup-status
    Expected: Shows provider_snapshot or restic mode
    cite: HabitatsOS@0.1.3:docs/runbook-backup-restore#backup-modes:3-14

  step_2 [confidence: 0.90] For restic mode, trigger backup
    Command: ./habitatsctl backup-run
    Prerequisites: Backup sidecar must be running
    cite: HabitatsOS@0.1.3:docs/runbook-backup-restore#restic-backup:15-30

  Related: docs/runbook-backup-restore (full guide)
  2. Search Results Need Better Snippets 🤖
    - Current snippets are often truncated mid-sentence: "Built-in ti..."
    - Need intelligent snippet extraction around query terms
    - Should show context before and after match

  Fix: Extract full sentences/paragraphs containing the query term
  3. No Multi-Doc Synthesis 🤖
    - Agents often need to combine information from multiple docs
    - Current commands return single docs or simple lists
    - No way to say "give me everything about X across all docs"

  New Command Idea:
  doccli synthesize "operator reconciliation" --depth 2
  # Returns: Combined view of all mentions with deduplicated info
  4. Missing Semantic Understanding 🤖
    - Search is keyword-based, not semantic
    - "How do I make a backup?" should match "backup creation", "running backups", "backup procedures"
    - Agents use natural language, not exact keywords

  Fix: Consider embedding-based search or query expansion
  5. No Dependency/Relationship Mapping 🤖
    - Docs often reference each other but relationships aren't exposed
    - Would be helpful to know: "If you're reading about upgrades, you should also know about backups"

  New Feature: doccli related <doc_id> showing linked concepts
  6. No Progressive Disclosure 🤖
    - Agents should be able to drill down: overview → details → implementation
    - Current structure is flat

  Enhancement: Add document hierarchy to index with --depth parameter:
  doccli open readme --depth 0  # Overview only
  doccli open readme --depth 1  # Sections
  doccli open readme --depth 2  # Full detail
  7. JSON Output Inconsistencies 🤖
    - Some commands have --json, others don't document it clearly
    - JSON structure varies between commands
    - No JSON schema provided for parsing

  Fix:
    - Document JSON schema for all outputs
    - Consistent structure across commands
    - Include version info in JSON for compatibility
  8. No Caching/Performance Hints 🤖
    - Agents might query the same docs repeatedly
    - No indication of index freshness
    - No way to know if index is stale

  Enhancement:
    - Add doccli status showing index age and source changes
    - Built-in result caching for repeated queries
    - Watch mode: doccli watch --rebuild-on-change

  Agent-Specific Features Needed

  9. Batch Query Support 🤖
  # Agents often need multiple related queries
  doccli batch << EOF
  search "backup"
  search "restore"
  open docs/runbook-backup-restore#backup-modes
  EOF
  10. Code Example Extraction 🤖
    - Agents specifically need code blocks and commands
    - Current tool treats all content equally
  doccli examples "backup" --type bash
  # Returns only bash code blocks related to backup
  11. Structured Command Output 🤖
    - When docs contain commands, extract them as structured data
  {
    "commands": [
      {
        "command": "./habitatsctl backup-status",
        "description": "Check backup mode",
        "required_before": ["backup-run"]
      }
    ]
  }

  ---
  Recommendations by Priority

  Immediate Fixes (Do First)

  1. Fix manifest naming: bootstrap should create doccli.json
  2. Fix "use" command content truncation - this is the killer feature for agents
  3. Make path resolution consistent across all commands
  4. Add searched paths to resolution errors

  High Priority (Agent Experience)

  1. Improve snippet extraction (full sentences, not fragments)
  2. Add semantic/natural language query support to "use"
  3. Add confidence scores to "use" command results
  4. Create doccli list command to see what's indexed
  5. Document the complete workflow with examples

  Medium Priority (Developer Experience)

  1. Add interactive shell mode
  2. Add doccli related <doc_id> for discovering linked content
  3. Add doccli stats showing index coverage/quality
  4. Provide JSON schemas for all output formats
  5. Add short flags (-n, -c, etc.)

  Nice to Have (Future)

  1. Embedding-based semantic search
  2. Multi-doc synthesis command
  3. Batch query support
  4. Code example extraction
  5. Watch mode for auto-rebuild
  6. Progressive disclosure (depth levels)

  ---
  Agent-Specific Assessment

  As an AI agent, here's what I really need from doccli:

  ✅ What's Useful Now:

  - Fast keyword search with citations
  - Direct document access by ID
  - Structured output for parsing (JSON)
  - Compact citations for referencing

  ❌ What's Blocking Adoption:

  - "Use" command returns incomplete/truncated content
  - Can't reliably get actionable steps from queries
  - No semantic understanding of questions
  - Setup workflow is confusing (bootstrap vs build)

  🎯 What Would Make This Indispensable:

  1. Reliable "use" command that returns complete, actionable steps
  2. Semantic search that understands intent, not just keywords
  3. Code extraction to get commands/examples directly
  4. Relationship mapping to discover related concepts
  5. Confidence scoring so I know when to dig deeper

  ---
  Summary

  doccli has a solid foundation with good search, citations, and structure. However, the "use" command (the most agent-focused feature)
  needs significant work to be truly useful. The content truncation and fragment issues make it unreliable for real-world agent tasks.

  Bottom line: Fix the "use" command's content extraction, improve semantic understanding, and provide complete examples - then this
  becomes a game-changer for agent-documentation interaction.