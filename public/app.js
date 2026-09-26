const $ = s => document.querySelector(s);
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const store = {
  get: k => {
    try {
      return localStorage.getItem(k);
    } catch {
      return null;
    }
  },
  set: (k, v) => {
    try {
      localStorage.setItem(k, v);
    } catch {}
  },
};

const HINT_MIN = 0.3;
const asked = (new URLSearchParams(location.search).get('salon') || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 10);
const code = asked.length >= 4 ? asked : '';
let me = store.get('pikiguess.id');
if (!me) store.set('pikiguess.id', (me = crypto.randomUUID()));
let myName = store.get('pikiguess.name') || '';
let sortByHeat = store.get('pikiguess.sort') === 'heat';

let ws, st, offset = 0, retry = 0, barMode = '', unread = 0;
let pick = null, lastQuery = '', searchTimer, searchSeq = 0;
let hinted = new Set();
const view = { revealed: new Map(), hints: new Map(), fresh: new Set(), guesses: [], live: {}, last: null, hits: new Map() };

const send = msg => ws?.readyState === 1 && ws.send(JSON.stringify(msg));
const nameOf = id => st.players.find(p => p.id === id)?.name ?? '?';
const isMeneur = () => st.you === st.meneurId;
const isBoss = () => st.you === st.hostId || !st.players.find(p => p.id === st.hostId)?.online;
const plural = (n, word) => `${n} ${word}${n > 1 ? 's' : ''}`;
const heat = s => Math.min(1, Math.max(0, (s - HINT_MIN) / 0.5));
const baseTitle = () => `Pikiguess · ${code}`;
const duration = ms => {
  const s = Math.round(ms / 1000);
  return s >= 60 ? `${Math.floor(s / 60)} min ${String(s % 60).padStart(2, '0')} s` : `${s} s`;
};
const clock = ms => {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};
const wiki = params =>
  fetch(`https://fr.wikipedia.org/w/api.php?${new URLSearchParams({ action: 'query', format: 'json', formatversion: '2', origin: '*', ...params })}`).then(r => r.json());

// Accueil et connexion

function home() {
  $('#home').hidden = false;
  $('#name').value = myName;
  if (code) {
    $('#go').textContent = `Rejoindre le salon ${code}`;
    $('#joinRow').hidden = true;
  }
  $('#homeForm').onsubmit = e => {
    e.preventDefault();
    if (!saveName()) return;
    if (code) enter();
    else location.search = `?salon=${newCode()}`;
  };
  $('#join').onclick = () => {
    const raw = $('#joinCode').value;
    const c = (raw.match(/salon=([A-Za-z0-9]+)/)?.[1] ?? raw).toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 10);
    if (c.length < 4) return $('#joinCode').focus();
    if (saveName()) location.search = `?salon=${c}`;
  };
  $('#joinCode').onkeydown = e => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    $('#join').click();
  };
  $('#name').focus();
}

function saveName() {
  const name = $('#name').value.trim();
  if (!name) {
    $('#name').focus();
    return false;
  }
  myName = name;
  store.set('pikiguess.name', name);
  return true;
}

function newCode() {
  const abc = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return Array.from(crypto.getRandomValues(new Uint8Array(5)), b => abc[b % abc.length]).join('');
}

function enter() {
  $('#home').hidden = true;
  $('#game').hidden = false;
  $('#room').hidden = false;
  $('#rename').hidden = false;
  $('#code').textContent = code;
  document.title = baseTitle();
  connect();
}

function connect() {
  ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/api/salon/${code}`);
  ws.onopen = () => {
    retry = 0;
    status('');
    ws.send(JSON.stringify({ t: 'join', id: me, name: myName }));
  };
  ws.onmessage = e => e.data !== 'pong' && onMessage(JSON.parse(e.data));
  ws.onclose = e => {
    if (e.code === 4000) return;
    status('Connexion perdue, reconnexion…');
    setTimeout(connect, Math.min(10000, 500 * 2 ** retry++));
  };
}

function status(text) {
  $('#status').textContent = text;
}

function toast(text, kind = '') {
  const el = document.createElement('div');
  el.className = `toast ${kind}`;
  el.textContent = text;
  $('#toasts').append(el);
  setTimeout(() => el.remove(), 5000);
}

function notify(text, kind) {
  toast(text, kind);
  if (document.hidden) document.title = `(${++unread}) ${text}`;
}

// Messages du serveur

function onMessage(m) {
  switch (m.t) {
    case 'state':
      return onState(m);
    case 'guess':
      return onGuess(m);
    case 'hint':
      return onHint(m);
    case 'live':
      return onLive(m);
    case 'error':
      return toast(m.msg, 'bad');
    case 'full':
      return full();
  }
}

function onState(m) {
  const prev = st;
  st = m;
  offset = m.now - Date.now();
  if (m.page && !m.page.texts) {
    view.revealed = new Map(m.page.revealed);
    view.hints = new Map(m.page.hints.map(([i, w, s]) => [i, { w, s }]));
  }
  if (prev?.round !== m.round) {
    view.last = null;
    view.hits.clear();
    pick = null;
    lastQuery = '';
  }
  view.guesses = m.guesses || [];
  view.live = m.live || {};
  hinted = new Set(m.hinted || []);
  events(prev, m);
  if (prev && (prev.phase !== m.phase || prev.round !== m.round)) window.scrollTo({ top: 0 });
  render();
}

function events(prev, m) {
  if (!prev) return;
  const changed = prev.phase !== m.phase || prev.round !== m.round;
  if (changed && m.phase === 'choosing' && m.meneurId === m.you) notify('À toi de choisir la page !', 'good');
  if (changed && m.phase === 'playing' && m.meneurId !== m.you && m.page) notify(`Manche ${m.round} : c'est parti !`, 'good');
  if (changed && m.phase === 'roundEnd') notify('Manche terminée.');
  if (changed && m.phase === 'gameEnd') notify('Partie terminée !');
  if (!changed && m.phase === 'playing') {
    for (const p of m.players) {
      const before = prev.players.find(q => q.id === p.id);
      if (p.found && before && !before.found && p.id !== m.you)
        notify(`${p.name} a trouvé la page !${m.chronoEnd ? ` Fin dans ${clock(m.chronoEnd - m.now)}.` : ''}`, 'good');
    }
  }
  for (const p of m.players) if (p.id !== m.you && !prev.players.some(q => q.id === p.id)) notify(`${p.name} a rejoint le salon.`);
}

function uncover(revealed) {
  const changed = new Set();
  for (const [i, text] of revealed) {
    view.revealed.set(i, text);
    view.hints.delete(i);
    view.fresh.add(i);
    changed.add(i);
  }
  return changed;
}

function onGuess(m) {
  const changed = uncover(m.revealed);
  for (const [i, w, s] of m.hints) {
    if (view.revealed.has(i)) continue;
    view.hints.set(i, { w, s });
    changed.add(i);
  }
  const items = m.items.filter(x => !x.dup);
  view.guesses.push(...items);
  if (items.length) view.last = items[items.length - 1].w;
  if (items.length === 1 && m.revealed.length) view.hits.set(items[0].w, m.revealed.map(([i]) => i));
  feedback(m.items);
  updateWords(changed);
  renderProgress();
  renderSide();
}

function feedback(items) {
  $('#feedback').innerHTML = items
    .map(x => {
      const w = `« ${esc(x.w)} »`;
      if (x.dup) return `${w} déjà proposé`;
      if (x.n) return `${w} : <b class="plus">${plural(x.n, 'mot')} dévoilé${x.n > 1 ? 's' : ''}</b>`;
      if (x.s) return `${w} n'est pas dans le texte, mais proche à <b class="heat" style="--h:${heat(x.s).toFixed(2)}">${Math.round(x.s * 100)} %</b>`;
      return `${w} n'est pas dans le texte, et rien de proche`;
    })
    .join(' · ');
}

function onHint(m) {
  updateWords(uncover(m.revealed));
  renderProgress();
  toast(`Indice du meneur : « ${m.word} »`, 'good');
}

function onLive(m) {
  const l = (view.live[m.id] ||= { guesses: [], count: 0 });
  l.guesses.push(...m.items.filter(x => !x.dup));
  l.count = m.count;
  renderSide();
}

function full() {
  status('');
  $('#bar').innerHTML = `<h2>Ce salon est complet</h2><p>5 personnes maximum par salon.</p>
    <button type="button" data-href="/">Créer un autre salon</button>`;
}

// Affichage

function render() {
  renderPlayers();
  renderTimers();
  renderBar();
  renderPlay();
  renderPage();
  renderSide();
}

function renderPlayers() {
  $('#count').textContent = `(${st.players.length}/5)`;
  $('#players').innerHTML = st.players
    .map(
      p => `<li class="${p.online ? '' : 'off'}${p.id === st.you ? ' me' : ''}">
        <span class="pname">${esc(p.name)}${p.id === st.you ? ' (toi)' : ''}</span>
        ${p.id === st.hostId ? '<span class="tag">hôte</span>' : ''}
        ${p.id === st.meneurId ? '<span class="tag meneur">meneur</span>' : ''}
        ${p.found ? '<span class="tag ok">trouvé</span>' : ''}
        ${p.online ? '' : '<span class="tag">hors ligne</span>'}
        <span class="score">${p.score}</span>
      </li>`,
    )
    .join('');
}

function renderTimers() {
  const now = Date.now() + offset;
  const playing = st.phase === 'playing';
  const end = playing ? Math.min(st.chronoEnd ?? Infinity, st.maxEnd ?? Infinity) : Infinity;
  const left = end - now;
  let html = st.round ? `Manche ${st.round}${st.settings.tours > 1 ? ` · tour ${st.tour}/${st.settings.tours}` : ''}` : 'En attente des joueurs';
  if (playing) html += ` · ${clock(now - st.startedAt)}`;
  if (end < Infinity) html += `<br>${st.chronoEnd ? '<b>' : ''}Fin dans ${clock(left)}${st.chronoEnd ? '</b>' : ''}`;
  $('#timers').innerHTML = html;
  const c = $('#clock');
  c.textContent = end < Infinity ? `⏱ fin dans ${clock(left)}` : playing ? `⏱ ${clock(now - st.startedAt)}` : '';
  c.classList.toggle('urgent', end < Infinity && left < 30000);
}

function settingsForm(editable) {
  const s = st.settings;
  return `<fieldset class="settings"${editable ? '' : ' disabled'}>
    <legend>Réglages de la partie</legend>
    <label>Chrono après le 1er gagnant : <input type="number" name="chrono" min="0" max="60" value="${s.chrono}"> min <small>(0 = aucun)</small></label>
    <label>Durée maximale d'une manche : <input type="number" name="maxDuration" min="0" max="120" value="${s.maxDuration}"> min <small>(0 = aucune)</small></label>
    <label><input type="checkbox" name="meneurStop"${s.meneurStop ? ' checked' : ''}> Le meneur peut arrêter la manche</label>
    <label>Nombre de tours : <input type="number" name="tours" min="1" max="5" value="${s.tours}"> <small>(à chaque tour, chacun est meneur une fois)</small></label>
  </fieldset>`;
}

function resultsTable() {
  const rows = st.results
    .map(
      r => `<tr${r.id === st.you ? ' class="me"' : ''}><td>${r.rank + 1}</td><td>${esc(nameOf(r.id))}</td>
        <td>${r.found ? `trouvé en ${duration(r.time)}` : `${r.pct} % dévoilé`}</td>
        <td>${plural(r.guesses, 'essai')}</td><td>+${r.points}</td></tr>`,
    )
    .join('');
  return `<table class="results"><tr><th>#</th><th>Joueur</th><th>Résultat</th><th>Essais</th><th>Points</th></tr>${rows}</table>`;
}

function refreshBar() {
  barMode = '';
  renderBar();
}

function renderBar() {
  const boss = isBoss(), meneur = isMeneur();
  const mine = st.players.find(p => p.id === st.you);
  const online = st.players.filter(p => p.online).length;
  const mode = {
    lobby: `lobby:${boss}:${online}:${JSON.stringify(st.settings)}`,
    choosing: meneur ? `pick:${st.round}:${pick?.title ?? ''}` : `wait:${st.meneurId}:${boss}`,
    playing: meneur ? `meneur:${st.round}` : !mine?.playing ? 'spectator' : st.foundTime != null ? `found:${st.round}` : 'play',
    roundEnd: `results:${st.round}:${boss || meneur}`,
    gameEnd: `end:${boss}:${st.players.map(p => p.score).join()}`,
  }[st.phase];
  if (mode === barMode) return;
  barMode = mode;
  const bar = $('#bar');

  if (st.phase === 'lobby') {
    bar.innerHTML = `<div class="share">Lien à envoyer : <code>${esc(`${location.origin}/?salon=${code}`)}</code>
        <button type="button" class="alt small" data-copy>Copier</button></div>
      ${settingsForm(boss)}
      ${
        boss
          ? `<div class="actions"><button data-send="start"${online < 2 ? ' disabled' : ''}>Lancer la partie</button>
              <span class="hint">${online < 2 ? 'Il faut être au moins 2 (5 au maximum).' : `${online} personnes prêtes.`}</span></div>`
          : `<p class="hint">En attente du lancement par ${esc(nameOf(st.hostId))}…</p>`
      }`;
  } else if (st.phase === 'choosing' && meneur && pick) {
    bar.innerHTML = `<p>Tu es le meneur. Cette page te convient ?</p>
      <div class="preview"><h3>${esc(pick.title)}</h3>${pick.description ? `<p>${esc(pick.description)}</p>` : ''}<p>${esc(pick.extract)}</p></div>
      <div class="actions"><button type="button" data-launch${pick.ready ? '' : ' disabled'}>Lancer la manche avec cette page</button>
        <button type="button" class="alt" data-back>Choisir une autre page</button></div>`;
  } else if (st.phase === 'choosing' && meneur) {
    bar.innerHTML = `<p>Tu es le meneur : choisis la page que les autres vont chercher.</p>
      <form id="pick" class="row"><input id="q" placeholder="Chercher une page Wikipédia…" autocomplete="off" spellcheck="false" value="${esc(lastQuery)}"><button>Chercher</button></form>
      <div class="actions" style="margin-top:8px"><button type="button" class="alt small" data-ideas>Des idées ?</button>
        <span class="hint">Pages au hasard parmi les articles de qualité de Wikipédia.</span></div>
      <ul id="suggest" class="suggest"></ul>`;
    $('#q').focus();
    if (lastQuery) search(lastQuery);
  } else if (st.phase === 'choosing') {
    bar.innerHTML = `<p><b>${esc(nameOf(st.meneurId))}</b> choisit une page…</p><p class="hint">La manche commence dès que la page est choisie.</p>
      ${boss ? '<button class="alt small" data-send="skip" data-confirm="Passer au meneur suivant ?">Passer son tour</button>' : ''}`;
  } else if (st.phase === 'playing' && meneur) {
    bar.innerHTML = `<p>Tu es le meneur : les autres cherchent « <b>${esc(st.page.title)}</b> ».</p>
      <p class="hint">Clique sur un mot du texte pour le donner en indice à tous les joueurs. Leurs essais s'affichent en direct à gauche.</p>
      ${st.settings.meneurStop ? '<button class="alt small" data-send="stop" data-confirm="Arrêter la manche maintenant ?">Arrêter la manche</button>' : ''}`;
  } else if (st.phase === 'playing') {
    bar.innerHTML = !mine?.playing
      ? '<p>Manche en cours : tu joueras à la prochaine.</p>'
      : st.foundTime != null
        ? `<p class="win">Bravo, trouvé en ${duration(st.foundTime)}${st.rank ? `, ${st.rank === 1 ? '1er' : `${st.rank}e`}` : ''} ! Attends la fin de la manche.</p>`
        : '';
  } else if (st.phase === 'roundEnd') {
    bar.innerHTML = `<h2>C'était « <a href="${esc(st.page.url)}" target="_blank" rel="noopener">${esc(st.page.title)}</a> »</h2>
      ${resultsTable()}
      ${boss || meneur ? `<button data-send="next">${st.last ? 'Voir le classement final' : 'Manche suivante'}</button>` : '<p class="hint">En attente de la manche suivante…</p>'}`;
  } else if (st.phase === 'gameEnd') {
    const medals = ['🥇', '🥈', '🥉'];
    const ranked = [...st.players].sort((a, b) => b.score - a.score);
    bar.innerHTML = `<h2>Classement final</h2>
      <ol class="final">${ranked.map((p, i) => `<li>${medals[i] ?? `${i + 1}.`} <b>${esc(p.name)}</b> : ${p.score} points</li>`).join('')}</ol>
      ${boss ? '<div class="actions"><button data-send="start">Rejouer</button><button class="alt" data-send="lobby">Changer les réglages</button></div>' : "<p class=\"hint\">En attente de l'hôte…</p>"}`;
  }
}

function renderPlay() {
  const mine = st.players.find(p => p.id === st.you);
  const active = st.phase === 'playing' && !isMeneur() && mine?.playing && st.foundTime == null;
  const opening = active && $('#play').hidden;
  $('#play').hidden = !active;
  if (opening) {
    $('#feedback').textContent = 'Tape un mot puis Entrée. Clique sur une case pour voir son nombre de lettres.';
    $('#word').value = '';
    $('#word').focus();
  }
  renderProgress();
}

function renderProgress() {
  const p = st.page;
  if (!p || p.texts || $('#play').hidden) return;
  const total = p.lens.length;
  const titleWords = p.titleTokens.filter(t => typeof t === 'number');
  const titleFound = titleWords.filter(i => view.revealed.has(i)).length;
  $('#progress').textContent = `Titre : ${titleFound}/${titleWords.length} · Texte : ${view.revealed.size}/${total} mots (${Math.round((100 * view.revealed.size) / total)} %)`;
}

function wordHtml(i) {
  const p = st.page;
  if (p.texts) {
    if (st.phase === 'playing' && isMeneur()) return `<span class="mw${hinted.has(i) ? ' hinted' : ''}" data-i="${i}">${esc(p.texts[i])}</span>`;
    return esc(p.texts[i]);
  }
  const r = view.revealed.get(i);
  if (r != null) return `<span id="w${i}" class="ok${view.fresh.has(i) ? ' new' : ''}">${esc(r)}</span>`;
  const n = p.lens[i], h = view.hints.get(i);
  const tip = `${plural(n, 'lettre')}${h ? ` · « ${h.w} » proche à ${Math.round(h.s * 100)} %` : ''}`;
  if (!h) return `<span id="w${i}" class="w" data-n="${n}" style="--n:${n}" title="${esc(tip)}"></span>`;
  const fit = Math.max(0.5, Math.min(1, n / [...h.w].length));
  return `<span id="w${i}" class="w${h.s >= 0.6 ? ' hot' : ''}" data-n="${n}" data-g="${esc(h.w)}" style="--n:${n};--h:${heat(h.s).toFixed(2)}" title="${esc(tip)}"><i style="--f:${fit.toFixed(2)}">${esc(h.w)}</i></span>`;
}

function renderPage() {
  const el = $('#page'), p = st.page;
  if (!p || (st.phase !== 'playing' && st.phase !== 'roundEnd')) {
    el.innerHTML = '';
    return;
  }
  const line = tokens => tokens.map(t => (typeof t === 'number' ? wordHtml(t) : esc(t))).join('');
  el.innerHTML =
    `<h1 class="title">${line(p.titleTokens)}</h1>` +
    p.paragraphs.map(par => `<p>${line(par)}</p>`).join('') +
    (p.url && st.phase === 'playing' ? `<p class="src"><a href="${esc(p.url)}" target="_blank" rel="noopener">Voir la page sur Wikipédia</a></p>` : '');
  view.fresh.clear();
}

function updateWords(indices) {
  for (const i of indices) {
    const el = document.getElementById(`w${i}`);
    if (el) el.outerHTML = wordHtml(i);
  }
  view.fresh.clear();
}

const rank = g => (g.n ? 2 : g.s || 0);

function guessList(items, from, byHeat, mine) {
  const rows = items.map((g, i) => ({ ...g, k: from + i + 1 }));
  if (byHeat) rows.sort((a, b) => rank(b) - rank(a) || b.k - a.k);
  else rows.reverse();
  return `<ul class="guesses">${rows
    .map(
      g => `<li${mine ? ` data-g="${esc(g.w)}" title="Retrouver ce mot dans le texte"` : ''}${mine && g.w === view.last ? ' class="last"' : ''}>
        <span class="k">${g.k}</span><span class="gw">${esc(g.w)}</span>
        ${g.n ? `<span class="plus">+${g.n}</span>` : g.s ? `<span class="heat" style="--h:${heat(g.s).toFixed(2)}">${Math.round(g.s * 100)} %</span>` : ''}
      </li>`,
    )
    .join('')}</ul>`;
}

function renderSide() {
  const el = $('#side');
  if (st.phase === 'playing' && isMeneur()) {
    const total = st.page.texts.length;
    el.innerHTML =
      '<h3>En direct</h3>' +
      st.players
        .filter(p => p.playing)
        .map(p => {
          const l = view.live[p.id] || { guesses: [], count: 0 };
          const pct = Math.round((100 * l.count) / total);
          const shown = l.guesses.slice(-6);
          return `<div class="live"><div class="side-head"><b>${esc(p.name)}</b>
              <span class="hint">${plural(l.guesses.length, 'essai')} · ${pct} %${p.found ? ' · trouvé' : ''}</span></div>
            <div class="gauge" style="--p:${pct}"><i></i></div>${guessList(shown, l.guesses.length - shown.length, false, false)}</div>`;
        })
        .join('');
  } else if (st.phase === 'playing' && view.guesses.length) {
    el.innerHTML = `<div class="side-head"><h3>Mes essais (${view.guesses.length})</h3>
        <button type="button" class="link" data-sort>${sortByHeat ? 'trier par ordre' : 'trier par proximité'}</button></div>
      ${guessList(view.guesses, 0, sortByHeat, true)}`;
  } else el.innerHTML = '';
}

// Choix de la page par le meneur

async function search(text) {
  const seq = ++searchSeq;
  lastQuery = text;
  if (!text) return void ($('#suggest') && ($('#suggest').innerHTML = ''));
  try {
    const d = await wiki({ generator: 'prefixsearch', gpssearch: text, gpslimit: '8', prop: 'description|pageprops', ppprop: 'disambiguation', redirects: '1' });
    if (seq === searchSeq) suggestions(d.query?.pages ?? []);
  } catch {
    toast('Recherche Wikipédia impossible pour le moment.', 'bad');
  }
}

async function ideas() {
  const seq = ++searchSeq;
  const ul = $('#suggest');
  if (ul) ul.innerHTML = '<li class="off">Recherche d\'idées…</li>';
  try {
    const d = await wiki({
      generator: 'search',
      gsrsearch: 'incategory:"Article de qualité"|"Bon article"',
      gsrsort: 'random',
      gsrlimit: '8',
      gsrnamespace: '0',
      prop: 'description',
    });
    if (seq === searchSeq) suggestions(d.query?.pages ?? []);
  } catch {
    toast('Wikipédia ne répond pas.', 'bad');
  }
}

function suggestions(pages) {
  const ul = $('#suggest');
  if (!ul) return;
  pages.sort((a, b) => (a.index ?? 99) - (b.index ?? 99));
  ul.innerHTML =
    pages
      .map(p => {
        const homonymie = p.pageprops && 'disambiguation' in p.pageprops;
        return `<li ${homonymie ? 'class="off"' : `data-title="${esc(p.title)}"`}><b>${esc(p.title)}</b> <span>${esc(homonymie ? "page d'homonymie" : p.description || '')}</span></li>`;
      })
      .join('') || '<li class="off">Aucune page trouvée.</li>';
}

async function preview(title) {
  pick = { title, description: '', extract: 'Chargement de l\'aperçu…', ready: false };
  refreshBar();
  let error = 'Wikipédia ne répond pas.';
  try {
    const d = await wiki({ prop: 'extracts|description|pageprops', exintro: '1', explaintext: '1', exsentences: '2', ppprop: 'disambiguation', redirects: '1', titles: title });
    const p = d.query?.pages?.[0];
    if (pick?.title !== title) return;
    if (!p || p.missing || p.invalid) error = 'Page introuvable.';
    else if (p.pageprops && 'disambiguation' in p.pageprops) error = "C'est une page d'homonymie : choisis une page précise.";
    else {
      pick = { title: p.title, description: p.description || '', extract: (p.extract || '').replace(/\s*\[[^\]]*\]/g, ''), ready: true };
      error = null;
    }
  } catch {}
  if (pick?.title !== title && error) return;
  if (error) {
    pick = null;
    toast(error, 'bad');
  }
  refreshBar();
}

// Actions

async function copyLink(btn) {
  const url = `${location.origin}/?salon=${code}`;
  try {
    await navigator.clipboard.writeText(url);
  } catch {
    prompt('Copie ce lien :', url);
    return;
  }
  const old = btn.textContent;
  btn.textContent = 'Copié !';
  setTimeout(() => (btn.textContent = old), 1500);
}

function spot(elements) {
  if (!elements.length) return false;
  for (const el of elements) {
    el.classList.add('spot');
    setTimeout(() => el.classList.remove('spot'), 2500);
  }
  elements[0].scrollIntoView({ behavior: 'smooth', block: 'center' });
  return true;
}

$('#bar').addEventListener('click', e => {
  const b = e.target.closest('button');
  if (!b) {
    const li = e.target.closest('#suggest [data-title]');
    if (li) preview(li.dataset.title);
    return;
  }
  if (b.dataset.send && (!b.dataset.confirm || confirm(b.dataset.confirm))) send({ t: b.dataset.send });
  if ('copy' in b.dataset) copyLink(b);
  if ('ideas' in b.dataset) ideas();
  if ('launch' in b.dataset && pick?.ready) {
    send({ t: 'page', title: pick.title });
    b.disabled = true;
    b.textContent = 'Lancement…';
  }
  if ('back' in b.dataset) {
    pick = null;
    refreshBar();
  }
  if (b.dataset.href) location.href = b.dataset.href;
});

$('#bar').addEventListener('change', e => {
  const f = e.target.closest('.settings');
  if (!f) return;
  const { chrono, maxDuration, meneurStop, tours } = f.elements;
  send({ t: 'settings', settings: { chrono: chrono.value, maxDuration: maxDuration.value, meneurStop: meneurStop.checked, tours: tours.value } });
});

$('#bar').addEventListener('input', e => {
  if (e.target.id !== 'q') return;
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => search(e.target.value.trim()), 250);
});

$('#bar').addEventListener('submit', e => {
  e.preventDefault();
  if (e.target.id !== 'pick') return;
  const first = $('#suggest [data-title]');
  const q = $('#q').value.trim();
  if (first) preview(first.dataset.title);
  else if (q) preview(q);
});

$('#guessForm').addEventListener('submit', e => {
  e.preventDefault();
  const w = $('#word');
  if (w.value.trim()) send({ t: 'guess', word: w.value.trim() });
  w.value = '';
  w.focus();
});

$('#word').addEventListener('keydown', e => {
  if (e.key === 'Escape') e.target.value = '';
});

$('#page').addEventListener('click', e => {
  const mw = e.target.closest('.mw');
  if (mw) {
    if (!mw.classList.contains('hinted') && st.phase === 'playing' && isMeneur() && confirm(`Donner « ${mw.textContent} » en indice à tous les joueurs ?`))
      send({ t: 'hint', i: Number(mw.dataset.i) });
    return;
  }
  const w = e.target.closest('.w');
  if (!w) return;
  w.classList.add('len');
  setTimeout(() => w.classList.remove('len'), 1500);
});

$('#side').addEventListener('click', e => {
  if (e.target.closest('[data-sort]')) {
    sortByHeat = !sortByHeat;
    store.set('pikiguess.sort', sortByHeat ? 'heat' : 'order');
    return renderSide();
  }
  const li = e.target.closest('li[data-g]');
  if (!li) return;
  const word = li.dataset.g;
  const boxes = [...document.querySelectorAll(`.w[data-g="${CSS.escape(word)}"]`)];
  const hits = (view.hits.get(word) || []).map(i => document.getElementById(`w${i}`)).filter(Boolean);
  if (!spot(boxes.length ? boxes : hits)) toast(`« ${word} » n'est affiché dans aucune case pour le moment.`);
});

$('#copy').addEventListener('click', e => copyLink(e.currentTarget));

$('#rename').addEventListener('click', () => {
  const name = prompt('Ton nouveau pseudo :', myName)?.trim().slice(0, 20);
  if (!name || name === myName) return;
  myName = name;
  store.set('pikiguess.name', name);
  send({ t: 'join', id: me, name });
});

document.addEventListener('keydown', e => {
  const w = $('#word');
  const typing = ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName);
  if ($('#play').hidden || typing || e.key.length !== 1 || e.ctrlKey || e.metaKey || e.altKey) return;
  w.focus();
});

document.addEventListener('visibilitychange', () => {
  if (document.hidden || !code) return;
  unread = 0;
  document.title = baseTitle();
});

setInterval(() => st?.phase === 'playing' && renderTimers(), 1000);
setInterval(() => ws?.readyState === 1 && ws.send('ping'), 30000);

if (code && myName) enter();
else home();
