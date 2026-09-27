import { readdirSync, statSync } from 'node:fs';
import { basename, join } from 'node:path';

export interface FoundTranscript {
  sessionId: string;
  path: string;
  mtimeMs: number;
}

function entries(dir: string) {
  try {
    return readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
}

function modified(path: string): number | undefined {
  try {
    return statSync(path).mtimeMs;
  } catch {
    return undefined;
  }
}

/** Main-session transcripts under `<projects>/<project>/<id>.jsonl` changed since `sinceMs`. */
export function findRecentTranscripts(projectsDir: string, sinceMs: number): FoundTranscript[] {
  const found: FoundTranscript[] = [];
  for (const project of entries(projectsDir)) {
    if (!project.isDirectory()) continue;
    const dir = join(projectsDir, project.name);
    for (const file of entries(dir)) {
      if (!file.isFile() || !file.name.endsWith('.jsonl')) continue;
      const path = join(dir, file.name);
      const mtimeMs = modified(path);
      if (mtimeMs === undefined || mtimeMs < sinceMs) continue;
      found.push({ sessionId: basename(file.name, '.jsonl'), path, mtimeMs });
    }
  }
  return found.sort((a, b) => b.mtimeMs - a.mtimeMs);
}

/** Where Claude Code keeps a subagent's own transcript, next to the parent's. */
export function subagentTranscriptPath(transcriptPath: string, agentId: string): string {
  const dir = transcriptPath.slice(0, -'.jsonl'.length);
  return join(dir, 'subagents', `agent-${agentId.replace(/[^A-Za-z0-9_-]/g, '')}.jsonl`);
}
