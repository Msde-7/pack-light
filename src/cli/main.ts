import { run as demo } from './demo';
import { run as doctor } from './doctor';
import { run as install } from './install';
import { run as pins } from './pins';
import { run as start } from './start';
import { run as status } from './status';
import { run as uninstall } from './uninstall';

type Command = (args: readonly string[]) => Promise<number>;

const COMMANDS: Record<string, Command> = {
  start,
  install,
  uninstall,
  doctor,
  status,
  demo,
  pins,
};

const HELP = `Pack Light shows what fills your Claude Code context window.

Usage
  packlight [start] [--port N] [--no-open]   start the local app
  packlight install [--project] [--statusline] [--yes]
  packlight uninstall [--yes]
  packlight doctor
  packlight status
  packlight demo [--no-open]
  packlight pins list|clear [--session ID]
`;

async function main(argv: readonly string[]): Promise<number> {
  const [first, ...rest] = argv;
  if (first === '--help' || first === '-h' || first === 'help') {
    console.log(HELP);
    return 0;
  }
  if (first === '--version' || first === '-v') {
    console.log(process.env.PACK_LIGHT_VERSION ?? 'dev');
    return 0;
  }
  if (first === undefined || first.startsWith('-')) return start(argv);
  const command = COMMANDS[first];
  if (!command) {
    console.error(`Unknown command "${first}".\n\n${HELP}`);
    return 1;
  }
  return command(rest);
}

main(process.argv.slice(2)).then(
  code => {
    process.exitCode = code;
  },
  (error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  },
);
