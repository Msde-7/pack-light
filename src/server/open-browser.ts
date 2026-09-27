import { spawn } from 'node:child_process';

interface Launch {
  command: string;
  args: string[];
  verbatim: boolean;
}

export function browserCommand(url: string, platform: NodeJS.Platform = process.platform): Launch {
  // cmd's start treats the first quoted argument as a window title, hence the empty "".
  if (platform === 'win32') {
    return { command: 'cmd', args: ['/c', 'start', '""', `"${url}"`], verbatim: true };
  }
  if (platform === 'darwin') return { command: 'open', args: [url], verbatim: false };
  return { command: 'xdg-open', args: [url], verbatim: false };
}

/** Best effort. A missing opener only means the user clicks the printed link instead. */
export function openBrowser(url: string): void {
  if (!/^http:\/\/(127\.0\.0\.1|localhost):\d+\/[\w#=./-]*$/.test(url)) return;
  const launch = browserCommand(url);
  try {
    const child = spawn(launch.command, launch.args, {
      detached: true,
      stdio: 'ignore',
      windowsVerbatimArguments: launch.verbatim,
      windowsHide: true,
    });
    child.on('error', () => undefined);
    child.unref();
  } catch {
    // Nothing to do, the URL is printed anyway.
  }
}
