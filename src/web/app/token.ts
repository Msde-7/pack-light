const TOKEN_KEY = 'packlight.token';

/** Reads `token` from a location hash such as "#token=abc". */
export function tokenFromHash(hash: string): string | undefined {
  const token = new URLSearchParams(hash.replace(/^#/, '')).get('token');
  return token === null || token === '' ? undefined : token;
}

/**
 * Moves the token out of the URL bar into sessionStorage so it does not land in history,
 * screenshots or shared links.
 */
export function takeToken(): string | undefined {
  const fromHash = tokenFromHash(location.hash);
  if (fromHash !== undefined) {
    safeSession(storage => {
      storage.setItem(TOKEN_KEY, fromHash);
    });
    history.replaceState(null, '', location.pathname + location.search);
    return fromHash;
  }
  return safeSession(storage => storage.getItem(TOKEN_KEY) ?? undefined);
}

function safeSession<T>(use: (storage: Storage) => T): T | undefined {
  try {
    return use(sessionStorage);
  } catch {
    return undefined;
  }
}
