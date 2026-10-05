import type { AgentInputRequest, AgentInputResponse } from '@openspace/shared';
import type { ApprovalContext } from './approval-manager.js';

interface PendingInput extends AgentInputRequest {
  respond: (response: AgentInputResponse) => void;
}

const pending = new Map<string, PendingInput>();
let nextId = 1;

export function registerInput(input: Omit<PendingInput, 'id' | 'createdAt'>): PendingInput {
  const request = { ...input, id: `input-${Date.now()}-${nextId++}`, createdAt: Date.now() };
  pending.set(request.id, request);
  return request;
}

export function getPendingInput(id: string): PendingInput | undefined {
  return pending.get(id);
}

export function listPendingInputs(): AgentInputRequest[] {
  return [...pending.values()].map(({ respond: _respond, ...request }) => request);
}

export function attachInputContext(id: string, context: ApprovalContext): void {
  const request = pending.get(id);
  if (request) Object.assign(request, context);
}

/** Forget a request that the server has already resolved; do not send a second reply. */
export function forgetInput(id: string): void {
  pending.delete(id);
}

export function resolveInput(id: string, response: AgentInputResponse): boolean {
  const request = pending.get(id);
  if (!request) return false;
  validateInputResponse(request, response);
  pending.delete(id);
  request.respond(response);
  return true;
}

export function validateInputResponse(
  request: AgentInputRequest,
  response: AgentInputResponse,
): void {
  if (!response || !['accept', 'decline', 'cancel'].includes(response.action)) {
    throw new Error('Invalid input action');
  }
  if (response.action !== 'accept') return;
  if (request.kind === 'questions') {
    for (const question of request.questions ?? []) {
      const answers = response.answers?.[question.id];
      if (!response.answers || typeof response.answers !== 'object')
        throw new Error('Answers required');
      if (
        !Array.isArray(answers) ||
        answers.length === 0 ||
        answers.some((answer) => typeof answer !== 'string' || !answer.trim())
      ) {
        throw new Error(`Answer required: ${question.header}`);
      }
      if (
        !question.isOther &&
        question.options?.length &&
        answers.some((answer) => !question.options!.some((option) => option.label === answer))
      ) {
        throw new Error(`Invalid option: ${question.header}`);
      }
    }
    return;
  }
  if (request.mode === 'url') return;
  if (request.mode === 'openai/userVerification') {
    throw new Error('This verification requires a supported verification client');
  }
  if (!request.schema) throw new Error('Missing form schema');
  validateSchema(request.schema, response.content, 'Form');
}

function validateSchema(schema: Record<string, unknown>, value: unknown, path: string): void {
  const fail = (message: string): never => {
    throw new Error(`${path}: ${message}`);
  };
  if (
    Array.isArray(schema.oneOf) &&
    !schema.oneOf.some(
      (option) =>
        option && typeof option === 'object' && (option as { const?: unknown }).const === value,
    )
  )
    fail('invalid option');
  if (Array.isArray(schema.enum) && !schema.enum.includes(value)) fail('invalid option');
  if (
    Array.isArray(schema.anyOf) &&
    !schema.anyOf.some(
      (option) =>
        option && typeof option === 'object' && (option as { const?: unknown }).const === value,
    )
  )
    fail('invalid option');
  if (!schema.type && (Array.isArray(schema.enum) || Array.isArray(schema.anyOf))) return;
  switch (schema.type) {
    case 'object': {
      if (!value || typeof value !== 'object' || Array.isArray(value)) fail('object required');
      const content = value as Record<string, unknown>;
      const properties = (schema.properties ?? {}) as Record<string, Record<string, unknown>>;
      for (const key of (schema.required ?? []) as string[]) {
        if (content[key] === undefined) fail(`required field ${key}`);
      }
      for (const [key, child] of Object.entries(properties)) {
        if (content[key] !== undefined) validateSchema(child, content[key], `${path}.${key}`);
      }
      if (
        schema.additionalProperties === false &&
        Object.keys(content).some((key) => !(key in properties))
      ) {
        fail('unknown field');
      }
      break;
    }
    case 'string':
      if (typeof value !== 'string') fail('text required');
      if (typeof schema.minLength === 'number' && (value as string).length < schema.minLength)
        fail('text too short');
      if (typeof schema.maxLength === 'number' && (value as string).length > schema.maxLength)
        fail('text too long');
      break;
    case 'number':
    case 'integer':
      if (typeof value !== 'number' || !Number.isFinite(value)) fail('number required');
      if (schema.type === 'integer' && !Number.isInteger(value)) fail('integer required');
      if (typeof schema.minimum === 'number' && (value as number) < schema.minimum)
        fail('below minimum');
      if (typeof schema.maximum === 'number' && (value as number) > schema.maximum)
        fail('above maximum');
      break;
    case 'boolean':
      if (typeof value !== 'boolean') fail('boolean required');
      break;
    case 'array':
      if (!Array.isArray(value)) fail('array required');
      if (typeof schema.minItems === 'number' && (value as unknown[]).length < schema.minItems)
        fail('too few items');
      if (typeof schema.maxItems === 'number' && (value as unknown[]).length > schema.maxItems)
        fail('too many items');
      if (
        schema.uniqueItems === true &&
        new Set((value as unknown[]).map((item) => JSON.stringify(item))).size !==
          (value as unknown[]).length
      )
        fail('duplicate items');
      if (schema.items && typeof schema.items === 'object') {
        (value as unknown[]).forEach((item, index) =>
          validateSchema(schema.items as Record<string, unknown>, item, `${path}[${index}]`),
        );
      }
      break;
    default:
      fail('unsupported schema type');
  }
}
