import { open, stat } from 'node:fs/promises';
import { StringDecoder } from 'node:string_decoder';

export interface TailerOptions {
  path: string;
  onText: (text: string) => void;
  /** The file shrank or was replaced, so everything read so far is void. */
  onReset: () => void;
  chunkBytes?: number;
}

export interface Tailer {
  /** Reads whatever was appended since the last poll. Safe to call while a poll runs. */
  poll: () => Promise<void>;
  /** Starts again from byte 0 on the next poll. */
  rewind: () => void;
}

const DEFAULT_CHUNK = 4 * 1024 * 1024;

/** Follows an append-only JSONL file by byte offset, surviving partial writes and rotation. */
export function createTailer(options: TailerOptions): Tailer {
  const chunkBytes = options.chunkBytes ?? DEFAULT_CHUNK;
  let offset = 0;
  let decoder = new StringDecoder('utf8');
  /** Inode and birth time, which change when the file is replaced rather than appended to. */
  let identity: string | undefined;
  let running: Promise<void> | undefined;

  function rewind(): void {
    identity = undefined;
    offset = 0;
    decoder = new StringDecoder('utf8');
  }

  async function readTo(size: number): Promise<void> {
    const handle = await open(options.path, 'r');
    try {
      const buffer = Buffer.allocUnsafe(Math.min(chunkBytes, size - offset));
      while (offset < size) {
        const length = Math.min(buffer.length, size - offset);
        const { bytesRead } = await handle.read(buffer, 0, length, offset);
        if (bytesRead === 0) break;
        offset += bytesRead;
        const text = decoder.write(buffer.subarray(0, bytesRead));
        if (text !== '') options.onText(text);
      }
    } finally {
      await handle.close();
    }
  }

  async function pollOnce(): Promise<void> {
    const info = await stat(options.path).catch(() => undefined);
    if (!info?.isFile()) return;
    const current = `${info.ino}:${info.birthtimeMs}`;
    if ((identity !== undefined && identity !== current) || info.size < offset) {
      rewind();
      options.onReset();
    }
    identity = current;
    if (info.size > offset) await readTo(info.size).catch(() => undefined);
  }

  return {
    poll() {
      running ??= pollOnce().finally(() => {
        running = undefined;
      });
      return running;
    },
    rewind,
  };
}
