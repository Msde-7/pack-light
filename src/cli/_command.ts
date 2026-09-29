/** The command as the user launched it, so hints can be pasted back as they are. */
export function command(args = ''): string {
  const base = process.env.npm_command === 'exec' ? 'npx pack-light' : 'packlight';
  return args === '' ? base : `${base} ${args}`;
}
