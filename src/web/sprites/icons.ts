import type { ItemKind } from '../../core/types';

export const ITEM_ICON: Record<ItemKind, string> = {
  file_read: 'scroll_file',
  search: 'magnifier_search',
  bash_output: 'terminal_bash',
  web: 'globe_web',
  mcp: 'gear_mcp',
  subagent_report: 'letter_subagent',
  edit: 'hammer_edit',
  user_prompt: 'speech_prompt',
  instructions: 'map_instructions',
  other: 'bundle_other',
};

/** 8x8 icon for the same kind, sized for the scene. */
export function miniIcon(kind: ItemKind): string {
  return `mini_${ITEM_ICON[kind]}`;
}
