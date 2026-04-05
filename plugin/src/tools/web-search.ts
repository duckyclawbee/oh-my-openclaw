import { Type } from '@sinclair/typebox';

import type { OpenClawPluginApi } from '../types.js';
import { TOOL_PREFIX } from '../constants.js';
import { toolResponse, toolError } from '../utils/helpers.js';

interface WebSearchParams {
  query: string;
  model?: string;
}

export function registerWebSearchTool(api: OpenClawPluginApi) {
  api.registerTool({
    name: `${TOOL_PREFIX}web_search`,
    description:
      'Prepare a grounded web research request using native OpenClaw web tools or a research sub-agent.',
    parameters: Type.Object({
      query: Type.String({ description: 'Search query or question to answer using web search' }),
      model: Type.Optional(
        Type.String({
          description: 'Gemini model to use',
          default: 'gemini-3-flash-preview',
        }),
      ),
    }),
    execute: async (_toolCallId: string, params: WebSearchParams) => {
      const query = params.query?.trim();
      if (!query) {
        return toolError('Query is required and must not be empty');
      }

      const preferredModel = params.model?.trim();
      const instruction = [
        'Perform grounded web research now.',
        '',
        'Preferred execution order:',
        '1. Use a native OpenClaw web search or browser tool if available.',
        '2. If native search is unavailable, call sessions_spawn with agentId "omoc_librarian" and complete the research there.',
        '',
        `Query: ${query}`,
        preferredModel ? `Preferred model hint: ${preferredModel}` : '',
        '',
        'Return a concise answer with source links or citations where available.',
      ].filter(Boolean).join('\n');

      return toolResponse(instruction);
    },
    optional: true,
  });
}
