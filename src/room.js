import { DurableObject } from 'cloudflare:workers';
import { analyze, buildPage, fullPage, guess, isFound, newRun, playerView, ranking, reveal } from './game.js';
import { Lexicon } from './lexicon.js';
import { fetchPage, UserError } from './wikipedia.js';

const MAX_PEOPLE = 5;
const MINUTE = 60_000;

function int(v, min, max, def) {
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : def;
}

const cleanSettings = x => ({
  chrono: int(x?.chrono, 0, 60, 3),
  maxDuration: int(x?.maxDuration, 0, 120, 20),
  meneurStop: x?.meneurStop !== false,
  tours: int(x?.tours, 1, 5, 1),
});

// Un salon : ses joueurs, la partie en cours et les connexions WebSocket.
export class Room extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'));
    ctx.blockConcurrencyWhile(async () => {
      this.s = (await ctx.storage.get('state')) ?? {
        hostId: null,
        phase: 'lobby',
        settings: cleanSettings({}),
        players: [],
        queue: [],
        tour: 0,
        round: 0,
        meneurId: null,
        page: null,
        runs: {},
        hinted: [],
        startedAt: null,
        firstFoundAt: null,
        results: null,
      };
    });
  }

  async fetch() {
    const [client, server] = Object.values(new WebSocketPair());
    this.ctx.acceptWebSocket(server);
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws, data) {
    if (typeof data !== 'string' || data.length > 2000) return;
    let msg;
    try {
      msg = JSON.parse(data);
    } catch {
      return;
    }
    if (!msg || typeof msg !== 'object') return;
    try {
      if (msg.t === 'join') return this.join(ws, msg);
      const id = ws.deserializeAttachment()?.id;
      if (id && (await this.handle(id, msg))) {
        this.save();
        this.broadcast();
      }
    } catch (e) {
      if (!(e instanceof UserError)) console.error(e);
      this.send(ws, { t: 'error', msg: e instanceof UserError ? e.message : 'Erreur du serveur.' });
    }
  }

  webSocketClose(ws) {
    this.left(ws);
  }

  webSocketError(ws) {
    this.left(ws);
  }

  async alarm() {
    if (this.s.phase !== 'playing') return;
    if (Object.values(this.deadlines()).some(t => t && t <= Date.now() + 1000)) {
      this.endRound();
      this.save();
      this.broadcast();
    } else this.schedule();
  }

  join(ws, msg) {
    const s = this.s;
    const id = String(msg.id ?? '').slice(0, 40);
    const name = String(msg.name ?? '').trim().slice(0, 20);
    if (!id || !name) return this.send(ws, { t: 'error', msg: 'Choisis un pseudo.' });
    let p = s.players.find(p => p.id === id);
    if (!p) {
      const on = this.onlineIds();
      if (s.players.length >= MAX_PEOPLE && ['lobby', 'gameEnd'].includes(s.phase)) s.players = s.players.filter(p => on.has(p.id));
      if (s.players.length >= MAX_PEOPLE) {
        this.send(ws, { t: 'full' });
        ws.close(4000, 'Salon complet');
        return;
      }
      p = { id, name, score: 0 };
      s.players.push(p);
      if (s.phase !== 'lobby' && s.phase !== 'gameEnd') s.queue.push(id);
    }
    p.name = name;
    if (!s.players.some(q => q.id === s.hostId)) s.hostId = s.players[0].id;
    ws.serializeAttachment({ id });
    this.save();
    this.broadcast();
  }

  left(ws) {
    try {
      ws.close(1000);
    } catch {}
    if (this.s.phase === 'playing' && this.allFound()) {
      this.endRound();
      this.save();
    }
    this.broadcast();
  }

  async handle(id, m) {
    const s = this.s;
    const boss = id === s.hostId || !this.onlineIds().has(s.hostId);
    switch (m.t) {
      case 'settings':
        if (!boss || s.phase !== 'lobby') return false;
        s.settings = cleanSettings(m.settings);
        return true;
      case 'start':
        if (!boss || (s.phase !== 'lobby' && s.phase !== 'gameEnd')) return false;
        this.start(id);
        return true;
      case 'lobby':
        if (!boss || s.phase !== 'gameEnd') return false;
        s.phase = 'lobby';
        return true;
      case 'page':
        if (id !== s.meneurId || s.phase !== 'choosing') return false;
        return this.choose(String(m.title ?? '').slice(0, 300));
      case 'skip':
        if (!boss || s.phase !== 'choosing') return false;
        this.nextRound();
        return true;
      case 'guess':
        return this.onGuess(id, m.word);
      case 'hint':
        return this.onHint(id, m.i);
      case 'stop':
        if (id !== s.meneurId || s.phase !== 'playing' || !s.settings.meneurStop) return false;
        this.endRound();
        return true;
      case 'next':
        if ((!boss && id !== s.meneurId) || s.phase !== 'roundEnd') return false;
        this.nextRound();
        return true;
    }
    return false;
  }

  start(id) {
    const s = this.s;
    const on = this.onlineIds();
    const players = s.players.filter(p => on.has(p.id));
    if (players.length < 2) throw new UserError('Il faut être au moins 2 pour jouer.');
    s.players = players;
    if (!on.has(s.hostId)) s.hostId = id;
    for (const p of players) p.score = 0;
    s.tour = 1;
    s.round = 0;
    s.queue = [s.hostId, ...players.map(p => p.id).filter(x => x !== s.hostId)];
    this.nextRound();
  }

  nextRound() {
    const s = this.s;
    const ids = new Set(s.players.map(p => p.id));
    s.queue = s.queue.filter(x => ids.has(x));
    if (!s.queue.length) {
      if (s.tour >= s.settings.tours) {
        Object.assign(s, { phase: 'gameEnd', meneurId: null, page: null, runs: {}, results: null });
        this.ctx.storage.deleteAlarm();
        return;
      }
      s.tour++;
      s.queue = s.players.map(p => p.id);
    }
    s.meneurId = s.queue.shift();
    s.round++;
    Object.assign(s, { phase: 'choosing', page: null, runs: {}, hinted: [], startedAt: null, firstFoundAt: null, results: null });
    this.ctx.storage.deleteAlarm();
  }

  async choose(title) {
    if (this.busy) return false;
    this.busy = true;
    try {
      const p = await fetchPage(title);
      const s = this.s;
      if (s.phase !== 'choosing') return false;
      s.page = { title: p.title, url: p.url, ...buildPage(p.title, p.extract) };
      s.runs = Object.fromEntries(s.players.filter(x => x.id !== s.meneurId).map(x => [x.id, newRun()]));
      Object.assign(s, { phase: 'playing', startedAt: Date.now(), firstFoundAt: null, hinted: [] });
      this.schedule();
      return true;
    } finally {
      this.busy = false;
    }
  }

  async onGuess(id, word) {
    const s = this.s;
    const round = s.round;
    if (s.phase !== 'playing' || !s.runs[id] || s.runs[id].foundAt != null || typeof word !== 'string') return false;
    const { lex, keys } = await this.analysis();
    const run = s.runs[id];
    if (s.round !== round || s.phase !== 'playing' || run.foundAt != null) return false;
    const res = guess(s.page, keys, lex, run, word);
    if (!res.items.length) return false;
    const found = isFound(s.page, run);
    if (found) {
      run.foundAt = Date.now();
      s.firstFoundAt ??= run.foundAt;
    }
    this.sendTo(id, { t: 'guess', ...res });
    this.sendTo(s.meneurId, { t: 'live', id, items: res.items });
    if (!found) {
      this.save();
      return false;
    }
    this.schedule();
    if (this.allFound()) this.endRound();
    return true;
  }

  async onHint(id, i) {
    const s = this.s;
    const round = s.round;
    if (id !== s.meneurId || s.phase !== 'playing' || !Number.isInteger(i) || !s.page.words[i]) return false;
    const { lex, keys } = await this.analysis();
    const key = s.page.words[i].key;
    if (s.round !== round || s.phase !== 'playing' || s.hinted.includes(key)) return false;
    s.hinted.push(key);
    const now = Date.now();
    for (const [pid, run] of Object.entries(s.runs)) {
      if (run.foundAt != null) continue;
      const revealed = reveal(s.page, keys, lex, run, key);
      if (isFound(s.page, run)) {
        run.foundAt = now;
        s.firstFoundAt ??= now;
      }
      this.sendTo(pid, { t: 'hint', word: s.page.words[i].text, revealed });
    }
    this.schedule();
    if (this.allFound()) this.endRound();
    return true;
  }

  endRound() {
    const s = this.s;
    s.results = ranking(s.page, s.runs, s.startedAt);
    for (const r of s.results) {
      const p = s.players.find(p => p.id === r.id);
      if (p) p.score += r.points;
    }
    s.phase = 'roundEnd';
    this.ctx.storage.deleteAlarm();
  }

  allFound() {
    const on = this.onlineIds();
    const runs = Object.entries(this.s.runs);
    return runs.some(([, r]) => r.foundAt != null) && runs.every(([id, r]) => r.foundAt != null || !on.has(id));
  }

  deadlines() {
    const s = this.s;
    if (s.phase !== 'playing') return { chronoEnd: null, maxEnd: null };
    return {
      chronoEnd: s.settings.chrono && s.firstFoundAt ? s.firstFoundAt + s.settings.chrono * MINUTE : null,
      maxEnd: s.settings.maxDuration ? s.startedAt + s.settings.maxDuration * MINUTE : null,
    };
  }

  schedule() {
    const next = Object.values(this.deadlines()).filter(Boolean);
    if (next.length) this.ctx.storage.setAlarm(Math.min(...next));
    else this.ctx.storage.deleteAlarm();
  }

  async analysis() {
    const lex = await this.lexicon();
    if (this.info?.round !== this.s.round) this.info = { round: this.s.round, keys: analyze(this.s.page, lex) };
    return { lex, keys: this.info.keys };
  }

  lexicon() {
    this.lex ??= Promise.all(
      ['words.bin', 'vectors.bin'].map(async f => {
        const res = await this.env.ASSETS.fetch(new Request(`https://assets.local/data/${f}`));
        if (!res.ok) throw new Error(`${f} : ${res.status}`);
        return res.arrayBuffer();
      }),
    )
      .then(([w, v]) => new Lexicon(w, v))
      .catch(e => {
        console.warn('Données absentes, mots grisés et formes désactivés :', e.message);
        return null;
      });
    return this.lex;
  }

  view(id, on) {
    const s = this.s;
    const v = {
      t: 'state',
      you: id,
      now: Date.now(),
      hostId: s.hostId,
      phase: s.phase,
      settings: s.settings,
      round: s.round,
      tour: s.tour,
      last: !s.queue.length && s.tour >= s.settings.tours,
      meneurId: s.meneurId,
      startedAt: s.startedAt,
      ...this.deadlines(),
      players: s.players.map(p => ({
        id: p.id,
        name: p.name,
        score: p.score,
        online: on.has(p.id),
        playing: !!s.runs[p.id],
        found: s.runs[p.id]?.foundAt != null,
      })),
    };
    const run = s.runs[id];
    if (s.phase === 'playing' && id === s.meneurId) {
      v.page = fullPage(s.page);
      v.hinted = s.page.words.flatMap((w, i) => (s.hinted.includes(w.key) ? [i] : []));
      v.live = Object.fromEntries(Object.entries(s.runs).map(([pid, r]) => [pid, r.guesses]));
    } else if (s.phase === 'playing' && run) {
      v.page = run.foundAt != null ? fullPage(s.page) : playerView(s.page, run);
      v.guesses = run.guesses;
      v.foundTime = run.foundAt != null ? run.foundAt - s.startedAt : null;
    } else if (s.phase === 'roundEnd') {
      v.page = fullPage(s.page);
      v.results = s.results;
    }
    return v;
  }

  sockets() {
    return this.ctx.getWebSockets().filter(ws => ws.readyState === 1);
  }

  onlineIds() {
    return new Set(this.sockets().map(ws => ws.deserializeAttachment()?.id).filter(Boolean));
  }

  broadcast() {
    const on = this.onlineIds();
    for (const ws of this.sockets()) {
      const id = ws.deserializeAttachment()?.id;
      if (id) this.send(ws, this.view(id, on));
    }
  }

  sendTo(id, msg) {
    for (const ws of this.sockets()) if (ws.deserializeAttachment()?.id === id) this.send(ws, msg);
  }

  send(ws, msg) {
    try {
      ws.send(JSON.stringify(msg));
    } catch {}
  }

  save() {
    this.ctx.storage.put('state', this.s).catch(e => console.error('Sauvegarde du salon impossible', e));
  }
}
