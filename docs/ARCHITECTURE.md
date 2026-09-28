# Architecture

```
Claude Code session(s)
   │  command hooks in exec form, one tiny bundled Node script per event
   ▼
hooks ──POST /events──▶ local server on 127.0.0.1 (token, Host and Origin checks)
  │                         │  tails each transcript JSONL for exact sizes, usage and compaction
  │                         │  pure reducer turns hook events and transcript facts into SessionState
  │                         ▼
  │                    SSE /api/stream ──▶ browser app (Canvas 2D trail + DOM panels)
  │                         ▲                    │
  │                         └──── pin, reorder, repack (fetch + token) ◀┘
  │
  └─ SessionStart(compact) and UserPromptSubmit read pins.json and repack.json straight
     from disk and print additionalContext. Re-injection never depends on the server.
```

## Layers

| Folder       | Role                                                                                                                         | IO                                                      |
| ------------ | ---------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| `src/core`   | Types, the wire protocol, size estimation, transcript parsing, the session reducer, trail tips, injection text, window sizes | none, except the atomic pin store and path helpers      |
| `src/hooks`  | One entry per hook event. Read stdin, build a `HookEvent`, POST it within 300 ms, exit 0                                     | stdin, one local POST, pin files for the two sync hooks |
| `src/server` | HTTP routes, SSE fan-out, the session hub, the transcript tailer, static files                                               | sockets, transcript reads, pin writes                   |
| `src/cli`    | `start`, `install`, `uninstall`, `doctor`, `status`, `demo`, `pins`                                                          | settings files, the server, the terminal                |
| `src/web`    | The app shell and panels, the trail scene and all pixel art                                                                  | browser only                                            |

## How a tool call becomes an item

1. Claude Code runs a tool and fires `PostToolUse` in the background.
2. The hook sizes the result with the per-tool rules in `core/estimate.ts` (the Read gutter, image dimensions instead of base64, Edit input instead of the whole original file, the persisted Bash preview) and posts only a label, a path and a token estimate.
3. The hub feeds the event to the reducer, which adds an item with a stable id (a hash of session id and `tool_use_id`) and marks repeat reads in the same leg as duplicates.
4. A moment later the tailer reads the same call from the transcript. The reducer merges it into the same item and replaces the estimate with the exact length of the `tool_result` block Claude saw.
5. The server pushes the new `SessionState` and an `item_added` cue over SSE. The scene throws the icon into the pack and the inventory redraws.

## Context size

The status line JSON is the most trusted source (`context_window_size` and current usage). Without it, the latest assistant `usage` in the transcript gives input plus cache creation plus cache read tokens, which matched `/context` exactly in the real-session check. Fill is measured against the compaction point, the window minus the 33K autocompact buffer, so the hiker tires as camp approaches rather than at a raw percentage.

## Compaction

A compaction shows up three ways, and the reducer reconciles them.

- `PreCompact` puts the hiker into camp.
- The transcript's `compact_boundary` record is authoritative. Items from before it become dropped unless they are pinned, sewn in (files Claude Code re-reads, CLAUDE.md, invoked skills) or inside the preserved message segment the boundary lists.
- The summary record right after the boundary is matched against pins inside the parser, so the summary text never leaves it, and pins get "mentioned in Field Notes" or "not mentioned".
- `PostCompact` confirms. If no boundary appears within a few seconds, the reducer drops without preservation info.

Separately and independently, `SessionStart` with source `compact` reads `pins.json` and injects the Keep List as factual statements, trimmed from the bottom to stay under 9,000 characters.

## Privacy

No tool output, prompt text or summary is written to disk or sent anywhere. Hooks send sizes and labels only. Pins store the label, path, note and the snippet the user chose. The server binds to 127.0.0.1, needs a random token on every API call and rejects foreign Host and Origin headers. The token reaches the page through the URL hash and is moved into session storage.
