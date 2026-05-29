/**
 * Settings API（Sprint 4-ext / S-1 收尾）
 *
 * 用户级配置（跨 Project 全局），落地 ~/.openspace/settings.json。
 *
 * 端点：
 *   - GET  /api/settings/cursor                    → 当前 backend / hasApiKey / 来源 / SDK 模式 ripgrep 状态
 *   - GET  /api/settings/cursor?validate=true      → 额外真发 Cursor.me() 验证 key 有效性
 *   - POST /api/settings/cursor                    → 更新 backend / apiKey；可选 validate=true 立即验证
 */

import type { FastifyInstance } from 'fastify';
import type {
  CursorBackend,
  CursorBackendStatus,
  CursorBackendUpdateInput,
} from '@openspace/shared';
import {
  readCursorSettings,
  writeCursorSettings,
} from '../config/cursor-settings.js';
import { configureCursorRipgrep } from '../load-env.js';
import { CursorSdkAdapter } from '../agents/cursor-sdk-adapter.js';

export async function settingsRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/settings/cursor', async (req): Promise<CursorBackendStatus> => {
    const q = req.query as { validate?: string } | undefined;
    const validate = q?.validate === 'true' || q?.validate === '1';
    return await buildStatus(validate);
  });

  app.post('/api/settings/cursor', async (req, reply) => {
    const body = (req.body ?? {}) as CursorBackendUpdateInput & { validate?: boolean };

    const update: CursorBackendUpdateInput = {};
    if (body.backend === 'cli' || body.backend === 'sdk') {
      update.backend = body.backend as CursorBackend;
    }
    if (typeof body.apiKey === 'string') {
      const trimmed = body.apiKey.trim();
      update.apiKey = trimmed.length === 0 ? null : trimmed;
    } else if (body.apiKey === null) {
      update.apiKey = null;
    }

    if (Object.keys(update).length === 0) {
      reply.code(400);
      return { error: 'no fields to update' };
    }

    writeCursorSettings(update);
    // SDK 模式下 settings 改完可能需要重新定位 rg path（首次切到 SDK 时）
    configureCursorRipgrep();

    const validate = body.validate !== false;
    return await buildStatus(validate);
  });
}

async function buildStatus(validate: boolean): Promise<CursorBackendStatus> {
  const settings = readCursorSettings();
  const backend: CursorBackend =
    process.env.OPENSPACE_CURSOR_BACKEND === 'sdk' ? 'sdk' : 'cli';

  const apiKey = process.env.CURSOR_API_KEY;
  const hasApiKey = typeof apiKey === 'string' && apiKey.length > 0;

  // 源判定：settings.json 里也有就算 settings；否则视为 env（来自 .env 或 shell）
  let apiKeySource: 'env' | 'settings' | null = null;
  if (hasApiKey) {
    apiKeySource = settings.apiKey === apiKey ? 'settings' : 'env';
  }

  const status: CursorBackendStatus = {
    backend,
    hasApiKey,
    apiKeySource,
  };

  // 仅 SDK 模式才汇报 rg 状态
  if (backend === 'sdk') {
    const rg = configureCursorRipgrep();
    status.ripgrep = {
      configured: rg.configured,
      path: rg.path,
    };
  }

  if (validate && hasApiKey) {
    try {
      const sdk = new CursorSdkAdapter();
      const check = await sdk.checkInstallation();
      if (check.installed) {
        status.identity = {
          apiKeyName: check.path ?? 'unknown',
        };
      } else {
        status.identityError = check.error ?? 'auth failed';
      }
    } catch (e) {
      status.identityError = (e as Error).message;
    }
  }

  return status;
}
