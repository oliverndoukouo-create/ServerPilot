import type { SetupPlan, SetupType } from '../setup/types.js';
import type { SetupIntent } from '../setup/planner.js';

export type AiPlanInput = {
  type: SetupType;
  description: string;
  intent: SetupIntent;
  fallbackPlan: SetupPlan;
};

export interface SetupAiProvider {
  generatePlan(input: AiPlanInput): Promise<unknown>;
}

export type AutomationAiInput = {
  guildId: string;
  description: string;
  context: {
    roles: Array<{ id: string; name: string; mentionable: boolean }>;
    channels: Array<{ id: string; name: string; type: 'text' | 'announcement' }>;
    supportedTriggers: string[];
    supportedConditions: string[];
    supportedActions: string[];
  };
};

export interface AutomationAiProvider {
  generateAutomationProposal(input: AutomationAiInput): Promise<unknown>;
}

type ChatCompletionResponse = {
  choices?: Array<{ message?: { content?: string } }>;
};

function automationProposalJsonSchema(input: AutomationAiInput) {
  const stringSchema = (maxLength?: number) => ({
    type: 'string',
    ...(maxLength === undefined ? {} : { maxLength }),
  });
  const roleIdSchema = { type: 'string', enum: input.context.roles.map((role) => role.id) };
  const channelIdSchema = { type: 'string', enum: input.context.channels.map((channel) => channel.id) };
  const objectSchema = (properties: Record<string, unknown>, required: string[]) => ({
    type: 'object',
    properties,
    required,
    additionalProperties: false,
  });
  const actionSchema = (type: string, properties: Record<string, unknown>, required: string[]) => objectSchema({
    type: { type: 'string', enum: [type] },
    ...properties,
  }, ['type', ...required]);

  return {
    type: 'object',
    properties: {
      proposalId: stringSchema(),
      guildId: { type: 'string', enum: [input.guildId] },
      name: { ...stringSchema(100), minLength: 1 },
      description: { ...stringSchema(500), minLength: 1 },
      trigger: objectSchema({
        type: {
          type: 'string',
          enum: ['MEMBER_JOIN', 'MEMBER_LEAVE', 'MESSAGE_CREATE', 'WARNING_ISSUED', 'TICKET_OPENED', 'TICKET_CLOSED'],
        },
      }, ['type']),
      conditions: {
        type: 'array',
        items: {
          anyOf: [
            objectSchema({
              type: { type: 'string', enum: ['HAS_ROLE', 'DOES_NOT_HAVE_ROLE'] },
              roleId: roleIdSchema,
            }, ['type', 'roleId']),
            objectSchema({
              type: { type: 'string', enum: ['CHANNEL_IS'] },
              channelId: channelIdSchema,
            }, ['type', 'channelId']),
            objectSchema({
              type: { type: 'string', enum: ['WARNING_COUNT'] },
              operator: {
                type: 'string',
                enum: ['GREATER_THAN', 'GREATER_THAN_OR_EQUAL', 'EQUAL', 'LESS_THAN', 'LESS_THAN_OR_EQUAL'],
              },
              value: { type: 'integer', minimum: 0 },
            }, ['type', 'operator', 'value']),
          ],
        },
      },
      actions: {
        type: 'array',
        minItems: 1,
        items: {
          anyOf: [
            actionSchema('ADD_ROLE', { roleId: roleIdSchema }, ['roleId']),
            actionSchema('REMOVE_ROLE', { roleId: roleIdSchema }, ['roleId']),
            actionSchema('SEND_MESSAGE', {
              channelId: channelIdSchema,
              message: { ...stringSchema(2000), minLength: 1 },
            }, ['channelId', 'message']),
            actionSchema('SEND_DM', { message: { ...stringSchema(2000), minLength: 1 } }, ['message']),
            actionSchema('ADD_WARNING', { reason: { ...stringSchema(500), minLength: 1 } }, ['reason']),
            actionSchema('TIMEOUT_MEMBER', {
              durationMinutes: { type: 'integer', minimum: 1, maximum: 40320 },
              reason: { ...stringSchema(500), minLength: 1 },
            }, ['durationMinutes', 'reason']),
            actionSchema('NOTIFY_ROLE', {
              roleId: roleIdSchema,
              channelId: channelIdSchema,
              message: { ...stringSchema(2000), minLength: 1 },
            }, ['roleId', 'channelId', 'message']),
          ],
        },
      },
      summary: { ...stringSchema(500), minLength: 1 },
      riskWarnings: { type: 'array', maxItems: 10, items: stringSchema() },
      requiresConfirmation: { type: 'boolean', enum: [true] },
    },
    required: [
      'proposalId',
      'guildId',
      'name',
      'description',
      'trigger',
      'conditions',
      'actions',
      'summary',
      'riskWarnings',
      'requiresConfirmation',
    ],
    additionalProperties: false,
  };
}

export class OpenAiCompatibleProvider implements SetupAiProvider, AutomationAiProvider {
  constructor(
    private readonly apiKey: string,
    private readonly model: string,
    private readonly baseUrl: string,
  ) {}

  async generatePlan(input: AiPlanInput): Promise<unknown> {
    const response = await fetch(`${this.baseUrl.replace(/\/$/, '')}/chat/completions`, {
      method: 'POST',
      signal: AbortSignal.timeout(30_000),
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: this.model,
        temperature: 0.2,
        response_format: { type: 'json_object' },
        messages: [
          {
            role: 'system',
            content: 'Plan a Discord community based on the original brief, which is the primary source of truth. Priority order: explicit user requirements and exclusions; strongly implied requirements; size, tone, and context; selected server type and templates; generic defaults. A lower priority must never override a higher one. Treat templates as optional suggestions, never mandatory channels. Respect negation, including informal wording. Do not create support or ticket infrastructure unless requested; "no tickets" excludes both tickets and support unless support is separately requested. When support tickets are requested, do not add a redundant general support channel unless the user asks for one separately. A teams area does not imply player recruitment; add recruitment, tryout, or player application channels only when those are explicitly requested. Do not invent monetisation or membership tiers such as VIP, paid roles, donations, supporters, boosters, or sponsorships without evidence in the brief. An occasional community event means one simple events channel, not tournaments, teams, or event staff. Create tournament infrastructure only when tournaments/competitive organisation is requested. A mentioned game permits channels only for that named game; never add unrelated games. A build showcase is one focused channel, not generic media, clips, or creator infrastructure. "Only these channels" or "nothing else" means exactly those requested channels (plus the requested voice channels), without defaults. For small groups, private/friend servers, casual/chill tone, or minimal language, keep the structure lightweight and roles limited; scale complexity with stated membership and organisational needs. Do not invent roles or channels from type alone. Reflect tone naturally without slogans. Include a rules channel only when requested or genuinely suitable as a small baseline; when present, provide 3-5 concise community-specific rules, each under 160 characters, with no duplicates, contradictions, niche invented policies, or filler. If no rules channel is planned, rules must be []. Return exactly the SetupPlan shape and preserve type and description. Never include executable actions, permission overwrites, or Administrator permissions.',
          },
          {
            role: 'user',
            content: JSON.stringify({
              selectedType: input.type,
              description: input.description,
              intent: input.intent,
              fallbackPlan: input.fallbackPlan,
              outputShape: 'Return a SetupPlan-shaped JSON object with type, description, categories, voiceCategories, recommendedFeatures, requestedFeatures, skippedFeatures, roles, and rules (3-5 short strings, or [] when there is no rules channel). Treat fallbackPlan as a reference for explicit intent and safe defaults, not a required template. Never add known channels merely because they occur in fallbackPlan.',
            }),
          },
        ],
      }),
    });

    if (!response.ok) {
      throw new Error(`AI provider request failed with status ${response.status}.`);
    }

    const payload = await response.json() as ChatCompletionResponse;
    const content = payload.choices?.[0]?.message?.content;
    if (!content) {
      throw new Error('AI provider returned no plan content.');
    }

    const normalizedContent = content.trim().replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/\s*```$/, '');
    return JSON.parse(normalizedContent) as unknown;
  }

  async generateAutomationProposal(input: AutomationAiInput): Promise<unknown> {
    const response = await fetch(`${this.baseUrl.replace(/\/$/, '')}/chat/completions`, {
      method: 'POST',
      signal: AbortSignal.timeout(30_000),
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: this.model,
        temperature: 0.2,
        provider: { require_parameters: true },
        response_format: {
          type: 'json_schema',
          json_schema: {
            name: 'automation_proposal',
            strict: true,
            schema: automationProposalJsonSchema(input),
          },
        },
        messages: [
          {
            role: 'system',
            content: 'Generate a safe Discord automation proposal matching the supplied strict JSON schema. Output only the schema-conforming JSON object, with no Markdown or commentary. Every roleId and channelId must be selected from the provided guild context; do not invent IDs. For SEND_MESSAGE, use the field "message", never "content". If a role or channel is ambiguous, do not guess. Never include executable code, shell commands, JavaScript, TypeScript, custom functions, arbitrary API calls, permission escalations, or Administrator permissions.',
          },
          {
            role: 'user',
            content: JSON.stringify({
              guildId: input.guildId,
              description: input.description,
              context: input.context,
              outputShape: 'Return exactly the AutomationProposal shape enforced by the response schema. Each trigger, condition, and action must use only its exact schema fields.',
            }),
          },
        ],
      }),
    });

    if (!response.ok) {
      throw new Error(`AI provider request failed with status ${response.status}.`);
    }

    const payload = await response.json() as ChatCompletionResponse;
    const content = payload.choices?.[0]?.message?.content;
    if (!content) {
      throw new Error('AI provider returned no automation proposal content.');
    }

    const normalizedContent = content.trim().replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/\s*```$/, '');
    return JSON.parse(normalizedContent) as unknown;
  }
}

export function createConfiguredProvider(): (SetupAiProvider & AutomationAiProvider) | undefined {
  const apiKey = process.env.AI_API_KEY;
  if (!apiKey) {
    return undefined;
  }

  return new OpenAiCompatibleProvider(
    apiKey,
    process.env.AI_MODEL ?? 'nvidia/nemotron-3-super-120b-a12b:free',
    process.env.AI_BASE_URL ?? 'https://openrouter.ai/api/v1',
  );
}