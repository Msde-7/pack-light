import { getString } from '../core/json';
import { runObserver } from './_shared';

runObserver(({ input, envelope }) => {
  // Internal agents such as prompt suggestions stop with an empty agent_type.
  if (envelope.agentType === undefined || envelope.agentType === '') return undefined;
  const agentTranscriptPath = getString(input, 'agent_transcript_path');
  return {
    ...envelope,
    event: 'SubagentStop',
    reportChars: getString(input, 'last_assistant_message')?.length ?? 0,
    ...(agentTranscriptPath === undefined ? {} : { agentTranscriptPath }),
  };
});
