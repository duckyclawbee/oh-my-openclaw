import { Type } from '@sinclair/typebox';

import type { OpenClawPluginApi } from '../types.js';
import { TOOL_PREFIX } from '../types.js';
import { toolResponse, toolError } from '../utils/helpers.js';

interface LookAtParams {
  file_path: string;
  goal: string;
  model?: string;
}

export function registerLookAtTool(api: OpenClawPluginApi) {
  api.registerTool({
    name: `${TOOL_PREFIX}look_at`,
    description: 'Prepare a multimodal analysis delegation using native OpenClaw tools and the multimodal looker agent',
    parameters: Type.Object({
      file_path: Type.String({ description: 'Path to the file to analyze' }),
      goal: Type.String({ description: 'What to analyze or look for' }),
      model: Type.Optional(
        Type.String({
          description: 'Gemini model to use',
          default: 'gemini-3-flash-preview',
        }),
      ),
    }),
    execute: async (_toolCallId: string, params: LookAtParams) => {
      const filePath = params.file_path?.trim();
      const goal = params.goal?.trim();

      if (!filePath) {
        return toolError('file_path is required and must not be empty');
      }
      if (!goal) {
        return toolError('goal is required and must not be empty');
      }

      const preferredModel = params.model?.trim();
      const instruction = [
        'Delegate this multimodal analysis now.',
        '',
        'Preferred execution order:',
        '1. Use a native OpenClaw file/browser/image tool if one is available in this session.',
        '2. If broader analysis is needed, call sessions_spawn for agentId "omoc_looker".',
        '',
        `File: ${filePath}`,
        `Goal: ${goal}`,
        preferredModel ? `Preferred model hint: ${preferredModel}` : '',
        '',
        'Do not stop at planning. Perform the analysis and return the findings.',
      ].filter(Boolean).join('\n');

      return toolResponse(instruction);
    },
    optional: true,
  });
}
