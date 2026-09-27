import { rmSync } from 'node:fs';
import { paths } from '../core/paths';
import { readServerInfo, writeJsonAtomic } from '../core/store';
import { appUrl, startServer, type PackLightServer } from '../server/index';
import { openBrowser } from '../server/open-browser';
import { isHealthy } from './_server';

interface StartArgs {
  port?: number;
  open: boolean;
}

export function parseStartArgs(args: readonly string[]): StartArgs | string {
  const parsed: StartArgs = { open: true };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i] ?? '';
    if (arg === '--no-open') {
      parsed.open = false;
      continue;
    }
    const inline = /^--port=(.*)$/.exec(arg)?.[1];
    if (arg !== '--port' && inline === undefined) return `Unknown option "${arg}".`;
    const value = inline ?? args[++i];
    const port = Number(value);
    if (!Number.isInteger(port) || port < 0 || port > 65535) return 'The port must be 0 to 65535.';
    parsed.port = port;
  }
  return parsed;
}

function removeServerFile(): void {
  if (readServerInfo()?.pid === process.pid) rmSync(paths.serverInfo(), { force: true });
}

function show(url: string, open: boolean): void {
  console.log(`Your backpack is at ${url}`);
  if (open) openBrowser(url);
}

async function launch(port: number | undefined): Promise<PackLightServer | undefined> {
  try {
    return await startServer(port === undefined ? {} : { port });
  } catch (error) {
    const busy = error instanceof Error && 'code' in error && error.code === 'EADDRINUSE';
    console.error(busy ? `Port ${port ?? 0} is taken. Try another with --port.` : String(error));
    return undefined;
  }
}

export async function run(args: readonly string[]): Promise<number> {
  const options = parseStartArgs(args);
  if (typeof options === 'string') {
    console.error(options);
    return 1;
  }
  const existing = readServerInfo();
  if (existing && (await isHealthy(existing))) {
    console.log('Pack Light is already running.');
    show(appUrl(existing), options.open);
    return 0;
  }

  const server = await launch(options.port);
  if (!server) return 1;
  writeJsonAtomic(paths.serverInfo(), server.info);

  const stop = (): void => {
    removeServerFile();
    void server.close().finally(() => process.exit(0));
  };
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
  process.once('exit', removeServerFile);

  console.log('Pack Light is running. Press Ctrl+C to stop.');
  show(server.url, options.open);
  return 0;
}
