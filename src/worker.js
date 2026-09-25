export { Room } from './room.js';

export default {
  async fetch(request, env) {
    const m = new URL(request.url).pathname.match(/^\/api\/salon\/([A-Z0-9]{4,10})$/i);
    if (!m) return new Response('Introuvable', { status: 404 });
    if (request.headers.get('Upgrade') !== 'websocket') return new Response('WebSocket attendu', { status: 426 });
    return env.ROOMS.get(env.ROOMS.idFromName(m[1].toUpperCase())).fetch(request);
  },
};
