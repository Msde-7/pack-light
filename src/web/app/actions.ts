import type { PinRequest } from '../../core/protocol';
import type { Item, Pin, SessionState } from '../../core/types';
import { ApiError } from './api';
import type { Api } from './api';
import type { AppContext } from './context';
import { pinnedIds } from './inventory-model';
import { currentSession } from './store';

/** Runs a mutation against the selected session and turns failures into a friendly toast. */
async function run(
  ctx: AppContext,
  task: (api: Api, session: SessionState) => Promise<void>,
  done?: string,
): Promise<boolean> {
  const session = currentSession(ctx.store.get());
  if (!ctx.api || !session) return false;
  try {
    await task(ctx.api, session);
    if (done !== undefined) ctx.toast(done);
    return true;
  } catch (error) {
    ctx.toast(failureText(error), 'error');
    return false;
  }
}

function failureText(error: unknown): string {
  if (error instanceof ApiError && error.status === 401) {
    return 'The server did not accept the token.';
  }
  if (error instanceof ApiError) return `The server said no (${error.status}).`;
  return 'Could not reach the backpack server.';
}

export function pinFor(session: SessionState, itemId: string): Pin | undefined {
  return session.pins.find(pin => pin.itemId === itemId);
}

/** Pins with the given changes while keeping the parts of an existing pin that were not touched. */
export function pinItem(ctx: AppContext, item: Item, changes: PinRequest = {}): Promise<boolean> {
  return run(
    ctx,
    (api, session) => {
      const existing = pinFor(session, item.id);
      const body: PinRequest = {
        note: existing?.note ?? item.note,
        snippet: existing?.snippet ?? item.pinnedSnippet,
        ...changes,
      };
      return api.pin(session.sessionId, item.id, body);
    },
    'Pinned. It comes back after camp.',
  );
}

export function unpinItem(ctx: AppContext, itemId: string): Promise<boolean> {
  return run(ctx, (api, session) => api.unpin(session.sessionId, itemId), 'Unpinned.');
}

export function togglePin(ctx: AppContext, item: Item): Promise<boolean> {
  const session = currentSession(ctx.store.get());
  if (session && pinnedIds(session).has(item.id)) return unpinItem(ctx, item.id);
  return pinItem(ctx, item);
}

/** Reorders locally first so a drag does not snap back while the request is in flight. */
export function reorderPins(ctx: AppContext, itemIds: string[]): Promise<boolean> {
  const state = ctx.store.get();
  const session = currentSession(state);
  if (!session) return Promise.resolve(false);
  const byId = new Map(session.pins.map(pin => [pin.itemId, pin]));
  const pins = itemIds.flatMap(id => byId.get(id) ?? []);
  const updated = { ...session, pins };
  ctx.store.set({
    sessions: state.sessions.map(s => (s.sessionId === session.sessionId ? updated : s)),
  });
  return run(ctx, (api, s) => api.orderPins(s.sessionId, itemIds));
}

export async function repackItems(ctx: AppContext, itemIds: string[]): Promise<void> {
  const ok = await run(
    ctx,
    (api, session) => api.repack(session.sessionId, itemIds),
    itemIds.length === 1
      ? 'Queued. It rides along with your next prompt.'
      : 'Queued. They ride along with your next prompt.',
  );
  if (ok) ctx.store.set({ lostSelection: [] });
}

export function selectItem(
  ctx: AppContext,
  itemId: string | undefined,
  highlightIds: string[] = [],
): void {
  ctx.store.set({ itemId, highlightIds });
}
