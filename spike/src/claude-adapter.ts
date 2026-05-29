/**
 * Claude Code 适配器（占位实现）
 *
 * MVP-4 阶段用户安装 Claude Code 后再补验证与实现。
 *
 * 根据社区文档预期格式：
 *   CLI: claude -p --output-format stream-json [prompt]
 *   输出: NDJSON with type=message / message_delta / tool_use / tool_result / ...
 *
 * 本占位确保 CLI Bridge 可以"列出三个适配器但只能启用已安装的两个"，
 * 用户安装后 isInstalled=true，即可启用。
 */

import { execSync } from 'node:child_process';
import type {
  CLIAdapter,
  AdapterCapabilities,
  BuildCommandParams,
  CLIEvent,
  SpawnSpec,
} from './types.js';

export class ClaudeAdapter implements CLIAdapter {
  readonly name = 'claude';

  readonly capabilities: AdapterCapabilities = {
    supportsTextDelta: true,
    supportsThinking: false,     // 待 MVP-4 验证
    supportsWorkingDirectory: true,
    supportsEnvVars: true,
    supportsModelSelection: true,
    supportsReasoningEffort: false,
    supportsStdinContext: true,
  };

  async checkInstallation() {
    try {
      const version = execSync('claude --version', {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      }).trim();
      const path = execSync('which claude', {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      }).trim();
      return { installed: true, version, path };
    } catch (e) {
      return { installed: false, error: 'Claude Code not installed' };
    }
  }

  buildCommand(params: BuildCommandParams): SpawnSpec {
    // 占位实现：MVP-4 补完整参数
    const args: string[] = ['-p', '--output-format', 'stream-json'];

    if (params.model) args.push('--model', params.model);
    if (params.permissive) args.push('--allowedTools', 'Read,Write,Bash,Edit');

    args.push(params.prompt);

    return {
      command: 'claude',
      args,
      env: params.envVars,
      stdin: params.stdinContext,
      cwd: params.workingDirectory,
    };
  }

  parseLine(_line: string): CLIEvent[] {
    // MVP-4 实装
    // 预期：type=message_start / content_block_delta / tool_use_start / ...
    return [];
  }

  async getSupportedModels(): Promise<string[]> {
    return ['claude-sonnet-4', 'claude-opus-4', 'claude-haiku-4'];
  }
}
