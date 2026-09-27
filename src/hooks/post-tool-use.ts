import { summarizeTool } from '../core/estimate';
import { getString } from '../core/json';
import { runObserver } from './_shared';

runObserver(({ input, envelope }) => {
  const toolName = getString(input, 'tool_name');
  if (toolName === undefined) return undefined;
  const tool = summarizeTool({
    toolName,
    toolUseId: getString(input, 'tool_use_id') ?? '',
    input: input.tool_input,
    response: input.tool_response,
    cwd: envelope.cwd,
  });
  return { ...envelope, event: 'PostToolUse', tool };
});
