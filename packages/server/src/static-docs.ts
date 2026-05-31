import { createReadStream, existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const DOC_MIME_TYPES: Record<string, string> = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain; charset=utf-8',
};

export interface StaticDocsOptions {
  docsDir?: string;
  logger?: {
    info: (obj: unknown, msg?: string) => void;
    warn: (obj: unknown, msg?: string) => void;
  };
}

export async function registerStaticDocs(
  app: FastifyInstance,
  options: StaticDocsOptions = {},
): Promise<void> {
  const docsDir =
    options.docsDir ??
    process.env.OPENSPACE_DOCS_DIR ??
    path.resolve(__dirname, '../../../docs');

  if (!existsSync(docsDir) || !statSync(docsDir).isDirectory()) {
    options.logger?.warn({ docsDir }, '[docs] docs directory not found; static docs disabled');
    return;
  }

  options.logger?.info({ docsDir }, '[docs] serving docs directory at /docs');

  app.route({
    method: ['GET', 'HEAD'],
    url: '/docs',
    handler: async (req, reply) => serveDocsFile(req, reply, docsDir),
  });

  app.route({
    method: ['GET', 'HEAD'],
    url: '/docs/*',
    handler: async (req, reply) => serveDocsFile(req, reply, docsDir),
  });
}

async function serveDocsFile(req: FastifyRequest, reply: FastifyReply, docsDir: string) {
  const rawPath = (req.raw.url ?? '/docs/').split('?')[0] ?? '/docs/';
  const withoutPrefix = rawPath.replace(/^\/docs\/?/, '');
  const decodedPath = safeDecodeURIComponent(withoutPrefix);
  const normalizedPath = path.normalize(decodedPath).replace(/^(\.\.(\/|\\|$))+/, '');
  const relativePath =
    normalizedPath === '.' || normalizedPath === '' ? 'project-plan.html' : normalizedPath;
  const candidate = path.join(docsDir, relativePath);
  const resolved = path.resolve(candidate);
  const docsRoot = path.resolve(docsDir);

  if (!resolved.startsWith(`${docsRoot}${path.sep}`) && resolved !== docsRoot) {
    reply.code(403);
    return { error: 'forbidden' };
  }

  if (!fileExists(resolved)) {
    reply.code(404);
    return { error: 'not found' };
  }

  const ext = path.extname(resolved).toLowerCase();
  const contentType = DOC_MIME_TYPES[ext] ?? 'application/octet-stream';
  reply.header('content-type', contentType);
  reply.header('cache-control', 'no-cache');

  if (req.method === 'HEAD') {
    return reply.send();
  }
  return reply.send(createReadStream(resolved));
}

function fileExists(file: string): boolean {
  try {
    return existsSync(file) && statSync(file).isFile();
  } catch {
    return false;
  }
}

function safeDecodeURIComponent(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}
