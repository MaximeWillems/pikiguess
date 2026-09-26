import { popularIdeas } from './wikipedia.js';

export { Room } from './room.js';

export default {
  async fetch(request, env) {
    const { pathname } = new URL(request.url);
    if (pathname === '/api/idees') {
      try {
        return Response.json(await popularIdeas(8));
      } catch {
        return Response.json([], { status: 503 });
      }
    }
    const m = pathname.match(/^\/api\/salon\/([A-Z0-9]{4,10})$/i);
    if (!m) return new Response('Introuvable', { status: 404 });
    if (request.headers.get('Upgrade') !== 'websocket') return new Response('WebSocket attendu', { status: 426 });
    return env.ROOMS.get(env.ROOMS.idFromName(m[1].toUpperCase())).fetch(request);
  },
};
