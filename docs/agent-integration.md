# Agent Integration (v2)

`trail-docs` is designed for agent-led navigation: deterministic retrieval, bounded evidence, explicit citations.

## Recommended 3-hop pattern

1. `find` to get start refs + top units.
2. `expand`/`neighbors` to traverse with token budgets.
3. `extract` over explicit refs to produce final evidence pack.

## Python example

```python
import json
import subprocess


def run_cmd(args):
    result = subprocess.run(args, capture_output=True, text=True, check=True)
    return json.loads(result.stdout)


def retrieve(question: str, index_path: str, max_items: int = 6, budget: int = 800):
    hop1 = run_cmd([
        "trail-docs", "find", question,
        "--index", index_path,
        "--max-items", str(max_items),
        "--budget", str(int(budget * 0.35)),
        "--json"
    ])

    refs = [item["ref"] for item in hop1.get("items", [])]
    if not refs:
        return {"ok": False, "evidence": [], "reason": "no-start-points"}

    # optional hop2 expansion on top refs
    expanded = []
    for ref in refs[:3]:
        payload = run_cmd([
            "trail-docs", "expand", ref,
            "--index", index_path,
            "--max-items", "3",
            "--budget", str(int(budget * 0.2)),
            "--json"
        ])
        expanded.extend(payload.get("items", []))

    hop3 = run_cmd([
        "trail-docs", "extract", question,
        "--from", ",".join(refs[:8]),
        "--index", index_path,
        "--max-items", str(max_items),
        "--budget", str(budget),
        "--json"
    ])

    return {
        "ok": True,
        "start_points": hop1.get("items", []),
        "evidence": hop3.get("items", []),
        "budget": {
            "budget_tokens": hop3.get("budget_tokens", 0),
            "spent_tokens": hop3.get("spent_tokens", 0),
            "remaining_tokens": hop3.get("remaining_tokens", 0),
        },
    }
```

## CLI integration notes

- Always pass `--json`.
- Use `--budget` aggressively to cap context growth.
- Keep refs explicit when calling `extract`; this prevents hidden retrieval drift.
- Use `trail` commands if your agent needs resumable notebook state.

## Commands to expose in tool wrappers

- `find`
- `expand`
- `neighbors`
- `extract`
- `open` (for section mode fallback)
- `cite`
- `trail`
