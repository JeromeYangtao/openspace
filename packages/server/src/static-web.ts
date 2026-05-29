import { createReadStream, existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const MIME_TYPES: Record<string, string> = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

export interface StaticWebOptions {
  distDir?: string;
  logger?: {
    info: (obj: unknown, msg?: string) => void;
    warn: (obj: unknown, msg?: string) => void;
  };
}

export async function registerStaticWeb(
  app: FastifyInstance,
  options: StaticWebOptions = {},
): Promise<void> {
  const distDir =
    options.distDir ??
    process.env.OPENSPACE_WEB_DIST ??
    path.resolve(__dirname, '../../web/dist');
  const indexFile = path.join(distDir, 'index.html');

  if (!existsSync(indexFile)) {
    options.logger?.warn(
      { distDir },
      '[web] packages/web/dist not found; static frontend disabled',
    );
    return;
  }

  options.logger?.info({ distDir }, '[web] serving static frontend');

  app.route({
    method: ['GET', 'HEAD'],
    url: '/*',
    handler: async (req, reply) => {
      const url = req.raw.url ?? '/';
      if (url.startsWith('/api') || url.startsWith('/ws')) {
        reply.code(404);
        return { error: 'not found' };
      }
      return serveStaticOrSpaFallback(req, reply, distDir, indexFile);
    },
  });
}

async function serveStaticOrSpaFallback(
  req: FastifyRequest,
  reply: FastifyReply,
  distDir: string,
  indexFile: string,
) {
  const rawPath = (req.raw.url ?? '/').split('?')[0] ?? '/';
  const decodedPath = safeDecodeURIComponent(rawPath);
  const normalizedPath = path.normalize(decodedPath).replace(/^(\.\.(\/|\\|$))+/, '');
  const candidate = path.join(distDir, normalizedPath === '/' ? 'index.html' : normalizedPath);
  const resolved = path.resolve(candidate);
  const distRoot = path.resolve(distDir);

  if (!resolved.startsWith(`${distRoot}${path.sep}`) && resolved !== distRoot) {
    reply.code(403);
    return { error: 'forbidden' };
  }

  const file = fileExists(resolved) ? resolved : indexFile;
  const isIndexFallback = file === indexFile && resolved !== indexFile;
  const ext = path.extname(file).toLowerCase();
  const contentType = MIME_TYPES[ext] ?? 'application/octet-stream';

  reply.header('content-type', contentType);
  reply.header(
    'cache-control',
    isIndexFallback || file === indexFile
      ? 'no-cache'
      : 'public, max-age=31536000, immutable',
  );

  if (req.method === 'HEAD') {
    return reply.send();
  }
  return reply.send(createReadStream(file));
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
