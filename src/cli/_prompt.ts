import { createInterface } from 'node:readline/promises';

export type Approver = (question: string) => Promise<boolean>;

async function ask(question: string): Promise<boolean> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = await rl.question(`${question} [y/N] `);
    return /^y(es)?$/i.test(answer.trim());
  } finally {
    rl.close();
  }
}

/**
 * Says yes straight away with --yes, asks on a terminal, and otherwise declines with a hint,
 * because a piped stdin cannot answer.
 */
export function approver(yes: boolean, rerun: string): Approver {
  return question => {
    if (yes) return Promise.resolve(true);
    if (process.stdin.isTTY) return ask(question);
    console.log(`There is no terminal to confirm on. Run \`${rerun}\` to go ahead.`);
    return Promise.resolve(false);
  };
}
