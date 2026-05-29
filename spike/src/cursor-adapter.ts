/**
 * Cursor CLI 适配器（spike 原型）
 *
 * CLI: cursor-agent -p --output-format stream-json [--stream-partial-output]
 * 输出: NDJSON
 * 事件格式（实测）：
 *   {"type":"system","subtype":"init","apiKeySource":"login","cwd":"...","session_id":"...","model":"..."}
 *   {"type":"user","message":{"role":"user","content":[{"type":"text","text":"..."}]},"session_id":"..."}
 *   {"type":"thinking","subtype":"delta","text":"...","session_id":"...","timestamp_ms":...}
 *   {"type":"thinking","subtype":"completed","session_id":"..."}
 *   {"type":"assistant","message":{"role":"assistant","content":[{"type":"text","text":"..."}]},"session_id":"...","timestamp_ms":...}
 *     ↑ 在 --stream-partial-output 模式下会发多次，每次 text 是增量片段；最后一次是完整 text
 *   {"type":"tool_call","subtype":"started","call_id":"...","tool_call":{"shellToolCall":{...}},"session_id":"..."}
 *   {"type":"tool_call","subtype":"completed","call_id":"...","tool_call":{"shellToolCall":{"args":{...},"result":{"success":{...}}}},"session_id":"..."}
 *   {"type":"result","subtype":"success","duration_ms":...,"is_error":false,"result":"...","usage":{...}}
 */

import { execSync } from 'node:child_process';
import type {
  CLIAdapter,
  AdapterCapabilities,
  BuildCommandParams,
  CLIEvent,
  SpawnSpec,
} from './types.js';

export class CursorAdapter implements CLIAdapter {
  readonly name = 'cursor';

  readonly capabilities: AdapterCapabilities = {
    supportsTextDelta: true,     // --stream-partial-output 支持字符级 delta
    supportsThinking: true,      // thinking/subtype=delta
    supportsWorkingDirectory: true,
    supportsEnvVars: true,
    supportsModelSelection: true,
    supportsReasoningEffort: false, // Cursor 的 reasoning 是通过 model 名（如 sonnet-4-thinking）
    supportsStdinContext: true,
  };

  /**
   * cursor-agent 在 --stream-partial-output 模式下会发多条 assistant 事件：
   *   前 N-1 条的 text 是字符级 delta（独立 chunk）
   *   最后 1 条的 text 是完整 replay（与 result.result 相同）
   *
   * 策略：
   *   - 所有 assistant 事件都 emit 为 text.delta（包括最后的 replay）
   *   - result 事件 emit 为权威 text.completed（使用 result.result 字段）
   *   - Runner 的 fullText 规则：如果收到 text.completed，用它覆盖累积 delta
   */

  async checkInstallation() {
    try {
      const version = execSync('cursor-agent --version', {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      }).trim();
      const path = execSync('which cursor-agent', {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      }).trim();
      return { installed: true, version, path };
    } catch (e) {
      return { installed: false, error: (e as Error).message };
    }
  }

  buildCommand(params: BuildCommandParams): SpawnSpec {
    const args: string[] = [
      '-p',
      '--output-format', 'stream-json',
      '--stream-partial-output',
      '--trust',
    ];

    if (params.workingDirectory) {
      args.push('--workspace', params.workingDirectory);
    }

    if (params.model) {
      args.push('--model', params.model);
    }

    if (params.permissive) {
      args.push('-f'); // force, skip command approval
    }

    // Cursor 的 prompt 放在 positional args
    args.push(params.prompt);

    return {
      command: 'cursor-agent',
      args,
      env: params.envVars,
      stdin: params.stdinContext,
      cwd: params.workingDirectory,
    };
  }

  parseLine(line: string): CLIEvent[] {
    if (!line.trim()) return [];

    let obj: any;
    try {
      obj = JSON.parse(line);
    } catch {
      return [];
    }

    switch (obj.type) {
      case 'system':
        if (obj.subtype === 'init') {
          return [{
            type: 'session.started',
            session_id: String(obj.session_id ?? 'unknown'),
            meta: {
              cwd: obj.cwd,
              model: obj.model,
              permissionMode: obj.permissionMode,
            },
          }];
        }
        return [];

      case 'user':
        return [];

      case 'thinking':
        if (obj.subtype === 'delta') return [{ type: 'thinking.delta', text: String(obj.text ?? '') }];
        if (obj.subtype === 'completed') return [{ type: 'thinking.completed' }];
        return [];

      case 'assistant': {
        const contentArr = obj?.message?.content ?? [];
        const textPart = contentArr.find((c: any) => c?.type === 'text');
        const text = String(textPart?.text ?? '');
        if (!text) return [];
        // 所有 assistant 事件都 emit 为 delta；完整 replay 由 result 事件覆盖
        return [{ type: 'text.delta', text }];
      }

      case 'tool_call': {
        const tc = obj.tool_call ?? {};
        const toolKey = Object.keys(tc).find((k) => k.endsWith('ToolCall'));
        const toolData = toolKey ? tc[toolKey] : {};
        const toolName = toolKey ? toolKey.replace('ToolCall', '').toLowerCase() : 'unknown';

        if (obj.subtype === 'started') {
          return [{
            type: 'tool.started',
            call_id: String(obj.call_id ?? ''),
            tool: toolName,
            args: toolData.args ?? {},
          }];
        }

        if (obj.subtype === 'completed') {
          const result = toolData.result ?? {};
          const success = result.success !== undefined && result.error === undefined;
          const successObj = result.success ?? {};
          return [{
            type: 'tool.completed',
            call_id: String(obj.call_id ?? ''),
            tool: toolName,
            success,
            result: successObj.stdout ?? successObj.output ?? JSON.stringify(result).slice(0, 500),
            exit_code: typeof successObj.exitCode === 'number' ? successObj.exitCode : undefined,
            duration_ms: typeof successObj.executionTime === 'number' ? successObj.executionTime : undefined,
          }];
        }

        return [];
      }

      case 'result': {
        // result 同时携带 final text 与 session 结束信号
        if (obj.subtype === 'success' || obj.is_error === false) {
          const finalText = String(obj.result ?? '');
          const events: CLIEvent[] = [];
          if (finalText) {
            events.push({ type: 'text.completed', text: finalText });
          }
          events.push({
            type: 'session.completed',
            duration_ms: obj.duration_ms,
            usage: obj.usage
              ? {
                  input_tokens: obj.usage.inputTokens,
                  output_tokens: obj.usage.outputTokens,
                  extra: {
                    cacheReadTokens: obj.usage.cacheReadTokens,
                    cacheWriteTokens: obj.usage.cacheWriteTokens,
                  },
                }
              : undefined,
          });
          return events;
        }
        return [{
          type: 'error',
          message: String(obj.error ?? obj.result ?? 'cursor-agent error'),
          code: obj.subtype,
        }];
      }

      default:
        return [];
    }
  }

  async getSupportedModels(): Promise<string[]> {
    // Cursor 可通过 `cursor-agent --list-models` 获取
    try {
      const raw = execSync('cursor-agent --list-models', {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      return raw
        .split('\n')
        .map((l) => l.trim())
        .filter((l) => l && l.includes('-') && !l.toLowerCase().includes('loading') && !l.toLowerCase().includes('available'))
        .map((l) => l.split(/\s+-\s+/)[0].trim());
    } catch {
      return ['composer-2-fast', 'composer-2', 'auto'];
    }
  }
}
