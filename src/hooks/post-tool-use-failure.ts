import { summarizeFailure } from '../core/estimate';
import { getString } from '../core/json';
import { runObserver } from './_shared';

runObserver(({ input, envelope }) => {
  const toolName = getString(input, 'tool_name');
  if (toolName === undefined) return undefined;
  const tool = summarizeFailure({
    toolName,
    toolUseId: getString(input, 'tool_use_id') ?? '',
    input: input.tool_input,
    error: getString(input, 'error') ?? '',
    cwd: envelope.cwd,
  });
  return {
    ...envelope,
    event: 'PostToolUseFailure',
    tool,
    interrupted: input.is_interrupt === true,
  };
});
