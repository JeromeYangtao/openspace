import type { FastifyInstance } from 'fastify';
import { RUNTIME_REGISTRY, type Runtime, type RuntimeDetection } from '@openspace/shared';
import { detectRuntime } from '../runtime-detect.js';
import { getAdapterFor } from '../agents/engine.js';
import { listCodexAppServerStatuses } from '../agents/codex-app-server-adapter.js';

export async function runtimesRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/runtimes', async (): Promise<RuntimeDetection[]> => {
    return Promise.all(
      RUNTIME_REGISTRY.map(async (meta) => {
        const detection = await detectRuntime(meta.id);
        return {
          id: meta.id,
          label: meta.label,
          installed: detection.installed,
          version: detection.version,
          path: detection.path,
          note: meta.note,
          enabled_in_openspace: meta.available,
        };
      }),
    );
  });

  app.get('/api/runtimes/codex/app-servers', async () => {
    return { statuses: listCodexAppServerStatuses() };
  });

  // 查询某个 runtime 支持的模型列表（仅对已启用且安装的 runtime 有效）
  app.get('/api/runtimes/:id/models', async (req, reply) => {
    const { id } = req.params as { id: string };
    const meta = RUNTIME_REGISTRY.find((r) => r.id === id);
    if (!meta) {
      reply.code(404);
      return { error: 'unknown runtime' };
    }
    if (!meta.available) {
      return { models: [], note: meta.note ?? 'runtime not yet supported' };
    }
    const adapter = getAdapterFor(id as Runtime);
    if (!adapter) {
      return { models: [], note: 'adapter not found' };
    }
    try {
      const models = await adapter.getSupportedModels();
      return { models };
    } catch (e) {
      reply.code(200);
      return { models: [], error: (e as Error).message };
    }
  });
}
