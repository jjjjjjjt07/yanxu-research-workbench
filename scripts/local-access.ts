import type { Plugin } from 'vite';

/** Explicit single-user mode, confined to loopback and Vite development. */
export function localAccess(enabled: boolean): Plugin {
  return {
    name: 'workbench-local-access',
    apply: 'serve',
    configureServer(server) {
      if (!enabled) return;
      server.middlewares.use((req, res, next) => {
        const peers = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);
        let host: string;
        try {
          host = new URL(`http://${req.headers.host}`).hostname;
        } catch {
          res.writeHead(403).end();
          return;
        }
        if (!peers.has(req.socket.remoteAddress ?? '') ||
            !['localhost', '127.0.0.1', '[::1]'].includes(host) ||
            req.headers['sec-fetch-site'] === 'cross-site') {
          res.writeHead(403).end('Local workbench accepts same-site loopback access only.');
          return;
        }
        // The Sites middleware that follows still validates the peer and host,
        // strips spoofed identity headers and supplies the existing local owner.
        const cookies = (req.headers.cookie ?? '').split(';')
          .map(value => value.trim())
          .filter(value => value && !value.startsWith('__sites_local_auth='));
        cookies.push('__sites_local_auth=1');
        req.headers.cookie = cookies.join('; ');
        next();
      });
    },
  };
}
