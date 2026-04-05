import { Type, Static } from '@sinclair/typebox';
import { getPluginConfig, type OpenClawPluginApi, type PluginConfig } from '../types.js';
import { TOOL_PREFIX, LOG_PREFIX } from '../constants.js';
import { isValidCategory } from '../utils/validation.js';
import { CATEGORIES, type Category } from '../constants.js';
import { toolResponse, toolError } from '../utils/helpers.js';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
// dist/tools/ -> plugin root is dist/../.. = plugin/
const PLUGIN_DIST_ROOT = join(__dirname, '..', '..');

type ModelRecommendation = {
  model: string;
  variant?: string;
  alternatives?: string[];
};

type AgentModelRecommendation = {
  primary: string;
  variant?: string;
  fallbacks?: string[];
};

type AgentModelsFile = {
  description?: string;
  agents?: Record<string, AgentModelRecommendation>;
  categories?: Partial<Record<Category, ModelRecommendation>>;
};

// Load agent-models.json at module load time
let AGENT_MODEL_CONFIG: AgentModelsFile = {};
try {
  const configPath = join(PLUGIN_DIST_ROOT, 'config', 'agent-models.json');
  AGENT_MODEL_CONFIG = JSON.parse(readFileSync(configPath, 'utf-8')) as AgentModelsFile;
} catch (err) {
  // Fallback to defaults if config file not found
}

const DEFAULT_CATEGORY_MODELS: Record<Category, ModelRecommendation> = {
  quick: { model: 'openai/gpt-5.4-mini' },
  deep: { model: 'openai/gpt-5.4', variant: 'medium' },
  ultrabrain: { model: 'openai/gpt-5.4', variant: 'xhigh' },
  'visual-engineering': { model: 'zai-coding-plan/glm-5-turbo' },
  multimodal: { model: 'openai/gpt-5.4', variant: 'medium' },
  artistry: { model: 'openai/gpt-5.4', variant: 'xhigh' },
  'unspecified-low': { model: 'openai/gpt-5.4', variant: 'medium' },
  'unspecified-high': { model: 'openai/gpt-5.4', variant: 'medium' },
  writing: { model: 'opencode/gpt-5-nano' },
};

/** Maps each category to its best-fit sub-agent persona */
const DEFAULT_CATEGORY_AGENTS: Record<Category, string> = {
  quick: 'omoc_sisyphus',
  deep: 'omoc_hephaestus',
  ultrabrain: 'omoc_oracle',
  'visual-engineering': 'omoc_frontend',
  multimodal: 'omoc_looker',
  artistry: 'omoc_hephaestus',
  'unspecified-low': 'omoc_sisyphus',
  'unspecified-high': 'omoc_hephaestus',
  writing: 'omoc_sisyphus',
};

const DelegateParamsSchema = Type.Object({
  task_description: Type.String({ description: 'What the sub-agent should do' }),
  category: Type.String({ description: 'Task category for model routing (quick, deep, ultrabrain, etc.)' }),
  agent_id: Type.Optional(Type.String({ description: 'Target agent ID (e.g., omoc_sisyphus, omoc_oracle). Routes to specialized agent config.' })),
  skills: Type.Optional(Type.Array(Type.String(), { description: 'Skill names to load' })),
  background: Type.Optional(Type.Boolean({ description: 'Run in background (default: false)', default: false })),
});

type DelegateParams = Static<typeof DelegateParamsSchema>;

function getCategoryRecommendation(category: Category, config: PluginConfig): ModelRecommendation {
  const override = config.model_routing?.[category];
  if (override?.model) {
    return { model: override.model, alternatives: override.alternatives };
  }

  const categoryConfig = AGENT_MODEL_CONFIG.categories?.[category];
  if (categoryConfig?.model) {
    return categoryConfig;
  }

  return DEFAULT_CATEGORY_MODELS[category];
}

function getRecommendedModelForCategory(
  category: Category,
  agentId: string,
  config: PluginConfig,
): ModelRecommendation {
  // First try agent-specific model from config/agent-models.json
  const agentConfig = AGENT_MODEL_CONFIG.agents?.[agentId];
  if (agentConfig?.primary) {
    return {
      model: agentConfig.primary,
      variant: agentConfig.variant,
      alternatives: agentConfig.fallbacks,
    };
  }

  return getCategoryRecommendation(category, config);
}

export function registerDelegateTool(api: OpenClawPluginApi) {
  api.registerTool({
    name: `${TOOL_PREFIX}delegate`,
    description: 'Delegate a task to an OpenClaw-native sub-agent with category-based model routing',
    parameters: DelegateParamsSchema,
    execute: async (_toolCallId: string, params: DelegateParams) => {
      const validCategories = [...CATEGORIES];

      if (!params.task_description?.trim()) {
         return toolError('Task description is required and cannot be empty');
       }

      if (params.task_description.length > 10000) {
         return toolError('Task description too long (max 10000 chars)');
       }

       if (!isValidCategory(params.category)) {
         return toolError(`Invalid category: ${params.category}. Valid: ${validCategories.join(', ')}`);
       }

      const category = params.category as Category;
      const agentId = params.agent_id || DEFAULT_CATEGORY_AGENTS[category];
      const config = getPluginConfig(api);
      const { model, variant, alternatives } = getRecommendedModelForCategory(category, agentId, config);
      const modelLabel = variant ? `${model} (${variant})` : model;

      api.logger.info(`${LOG_PREFIX} Delegating task:`, { category, model, variant, agentId });

      const instruction = [
        `Category "${category}" → agent "${agentId}" → model "${modelLabel}"`,
        '',
        '⚡ NOW CALL sessions_spawn with these parameters:',
        `  task: "${params.task_description}"`,
        `  mode: "run"`,
        `  agentId: "${agentId}"`,
        `  # recommended model (do NOT pass to sessions_spawn): ${model}`,
        variant ? `  # recommended variant (do NOT pass to sessions_spawn): ${variant}` : '',
        alternatives?.length ? `  Recommended fallback models (informational only): ${alternatives.join(', ')}` : '',
        params.background ? '  (background execution — results will arrive via push notification)' : '',
        '',
        'Do NOT set sessions_spawn model unless explicitly asked by user.',
        'Do NOT just return this metadata. Actually call sessions_spawn NOW.',
        '',
        '⚠️ AFTER the subagent completes:',
        '  1. Check the result immediately',
        '  2. Verify against success criteria',
        '  3. Proceed to next task — do NOT stop',
      ].filter(Boolean).join('\n');

       return toolResponse(instruction);
    },
    optional: true,
  });
}
