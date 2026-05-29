/**
 * Codex CLI 适配器（spike 原型）
 *
 * CLI: codex exec --json
 * 输出: JSONL
 * 事件格式（实测）：
 *   {"type":"thread.started","thread_id":"..."}
 *   {"type":"turn.started"}
 *   {"type":"item.started","item":{"id":"item_N","type":"command_execution","command":"...","status":"in_progress"}}
 *   {"type":"item.completed","item":{"id":"item_N","type":"agent_message","text":"完整文本"}}
 *   {"type":"item.completed","item":{"id":"item_N","type":"command_execution","command":"...","aggregated_output":"...","exit_code":0,"status":"completed"}}
 *   {"type":"turn.completed","usage":{"input_tokens":...,"output_tokens":...}}
 *
 * 注意：Codex 的 exec --json 不输出字符级 text.delta，agent_message 是整条 item。
 */

import { execSync } from 'node:child_process';
import type {
  CLIAdapter,
  AdapterCapabilities,
  BuildCommandParams,
  CLIEvent,
  SpawnSpec,
} from './types.js';

export class CodexAdapter implements CLIAdapter {
  readonly name = 'codex';

  readonly capabilities: AdapterCapabilities = {
    supportsTextDelta: false,    // Codex 只输出完整 item，无字符级 delta
    supportsThinking: false,     // exec --json 不暴露 reasoning
    supportsWorkingDirectory: true,
    supportsEnvVars: true,
    supportsModelSelection: true,
    supportsReasoningEffort: true,
    supportsStdinContext: true,  // stdin 通过 `-` 或直接 pipe
  };

  async checkInstallation() {
    try {
      const out = execSync('codex --version', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
      const path = execSync('which codex', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
      return { installed: true, version: out, path };
    } catch (e) {
      return { installed: false, error: (e as Error).message };
    }
  }

  buildCommand(params: BuildCommandParams): SpawnSpec {
    const args: string[] = ['exec', '--json', '--ephemeral', '--skip-git-repo-check'];

    if (params.workingDirectory) {
      args.push('-C', params.workingDirectory);
    }

    if (params.model) {
      args.push('-m', params.model);
    }

    if (params.reasoning) {
      // Codex 通过 config 覆盖而非 flag
      args.push('-c', `model_reasoning_effort="${params.reasoning}"`);
    }

    if (params.permissive) {
      // MVP 采用最松模式，生产需要收紧
      args.push('-s', 'workspace-write');
      args.push('--dangerously-bypass-approvals-and-sandbox');
    } else {
      args.push('-s', 'read-only');
    }

    // Prompt 作为命令行参数（即便是长文本也 OK）
    args.push(params.prompt);

    // stdin 追加上下文
    // 注意：如果 stdin 为空，我们通过 spawn 时 stdin 继承 /dev/null 关闭
    const stdin = params.stdinContext;

    return {
      command: 'codex',
      args,
      env: params.envVars,
      stdin,
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
      case 'thread.started':
        return [{
          type: 'session.started',
          session_id: String(obj.thread_id ?? 'unknown'),
        }];

      case 'turn.started':
        return [];

      case 'item.started': {
        const item = obj.item ?? {};
        if (item.type === 'command_execution') {
          return [{
            type: 'tool.started',
            call_id: String(item.id ?? ''),
            tool: 'shell',
            args: { command: item.command ?? '' },
          }];
        }
        return [];
      }

      case 'item.completed': {
        const item = obj.item ?? {};
        if (item.type === 'agent_message') {
          return [{
            type: 'text.completed',
            text: String(item.text ?? ''),
          }];
        }
        if (item.type === 'command_execution') {
          return [{
            type: 'tool.completed',
            call_id: String(item.id ?? ''),
            tool: 'shell',
            success: item.exit_code === 0,
            result: String(item.aggregated_output ?? ''),
            exit_code: typeof item.exit_code === 'number' ? item.exit_code : undefined,
          }];
        }
        return [];
      }

      case 'turn.completed':
        return [{
          type: 'session.completed',
          usage: obj.usage
            ? {
                input_tokens: obj.usage.input_tokens,
                cached_input_tokens: obj.usage.cached_input_tokens,
                output_tokens: obj.usage.output_tokens,
              }
            : undefined,
        }];

      case 'error':
      case 'turn.failed':
        return [{
          type: 'error',
          message: String(obj.message ?? obj.error ?? 'unknown codex error'),
          code: obj.code,
        }];

      default:
        return [];
    }
  }

  async getSupportedModels(): Promise<string[]> {
    // Codex 支持的模型从 ~/.codex/config.toml 可见，实测会接受如 gpt-5.4 / o3-mini 等
    // 实际生产中应通过 API 查询或维护白名单
    return ['gpt-5.4', 'gpt-5', 'gpt-4.1', 'o3-mini', 'o3', 'o1-mini'];
  }
}
