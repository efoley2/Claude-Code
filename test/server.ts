import { createServer, type Server } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const FIXTURES = join(fileURLToPath(new URL('.', import.meta.url)), 'fixtures');

/**
 * Minimal static server for the fixture site.
 *
 * Bound to 127.0.0.1 so it is reachable without leaving the machine, which
 * also keeps it inside the standard no_proxy list.
 */
export async function startFixtureServer(): Promise<{ url: string; close: () => Promise<void> }> {
  const server: Server = createServer(async (req, res) => {
    try {
      const requested = new URL(req.url ?? '/', 'http://localhost').pathname;
      const relative = requested === '/' ? 'index.html' : requested.slice(1);

      // Reject traversal before touching the filesystem.
      const normalized = normalize(relative);
      if (normalized.startsWith('..')) {
        res.writeHead(403).end('Forbidden');
        return;
      }

      const body = await readFile(join(FIXTURES, normalized));
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(body);
    } catch {
      res.writeHead(404, { 'content-type': 'text/html; charset=utf-8' }).end('<html><body>Not found</body></html>');
    }
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Failed to bind fixture server');

  return {
    url: `http://127.0.0.1:${address.port}`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}
