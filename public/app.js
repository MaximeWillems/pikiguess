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

const asked = (new URLSearchParams(location.search).get('salon') || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 10);
const code = asked.length >= 4 ? asked : '';
let me = store.get('pikiguess.id');
if (!me) store.set('pikiguess.id', (me = crypto.randomUUID()));

let ws, st, offset = 0, retry = 0, barMode = '', msgTimer, searchTimer, searchSeq = 0;
const view = { revealed: new Map(), hints: new Map(), fresh: new Set(), guesses: [], live: {} };

const send = msg => ws?.readyState === 1 && ws.send(JSON.stringify(msg));
const nameOf = id => st.players.find(p => p.id === id)?.name ?? '?';
const isMeneur = () => st.you === st.meneurId;
const isBoss = () => st.you === st.hostId || !st.players.find(p => p.id === st.hostId)?.online;
const plural = (n, word) => `${n} ${word}${n > 1 ? 's' : ''}`;
const duration = ms => {
  const s = Math.round(ms / 1000);
  return s >= 60 ? `${Math.floor(s / 60)} min ${String(s % 60).padStart(2, '0')} s` : `${s} s`;
};
const clock = ms => {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

function home() {
  $('#home').hidden = false;
  $('#name').value = store.get('pikiguess.name') || '';
  if (code) $('#go').textContent = `Rejoindre le salon ${code}`;
  $('#homeForm').onsubmit = e => {
    e.preventDefault();
    const name = $('#name').value.trim();
    if (!name) return;
    store.set('pikiguess.name', name);
    if (code) enter(name);
    else location.search = `?salon=${newCode()}`;
  };
}

function newCode() {
  const abc = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return Array.from(crypto.getRandomValues(new Uint8Array(5)), b => abc[b % abc.length]).join('');
}

function enter(name) {
  $('#home').hidden = true;
  $('#game').hidden = false;
  $('#room').hidden = false;
  $('#code').textContent = code;
  document.title = `Pikiguess · ${code}`;
  connect(name);
}

function connect(name) {
  ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/api/salon/${code}`);
  ws.onopen = () => {
    retry = 0;
    status('');
    ws.send(JSON.stringify({ t: 'join', id: me, name }));
  };
  ws.onmessage = e => e.data !== 'pong' && onMessage(JSON.parse(e.data));
  ws.onclose = e => {
    if (e.code === 4000) return;
    status('Connexion perdue, reconnexion…');
    setTimeout(() => connect(name), Math.min(10000, 500 * 2 ** retry++));
  };
}

function status(text) {
  $('#status').textContent = text;
}

function flash(text, error = false) {
  const el = $('#msg');
  el.textContent = text;
  el.className = error ? 'err' : '';
  clearTimeout(msgTimer);
  msgTimer = setTimeout(() => (el.textContent = ''), 6000);
}

function onMessage(m) {
  switch (m.t) {
    case 'state':
      return onState(m);
    case 'guess':
      return onGuess(m);
    case 'hint':
      return onHint(m);
    case 'live':
      (view.live[m.id] ||= []).push(...m.items.filter(x => !x.dup));
      return renderSide();
    case 'error':
      return flash(m.msg, true);
    case 'full':
      return status('Salon complet (5 personnes max).');
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
  view.guesses = m.guesses || [];
  view.live = m.live || {};
  if (prev && (prev.phase !== m.phase || prev.round !== m.round)) $('#msg').textContent = '';
  render();
}

function uncover(revealed) {
  for (const [i, text] of revealed) {
    view.revealed.set(i, text);
    view.hints.delete(i);
    view.fresh.add(i);
  }
}

function onGuess(m) {
  uncover(m.revealed);
  for (const [i, w, s] of m.hints) if (!view.revealed.has(i)) view.hints.set(i, { w, s });
  for (const x of m.items) if (!x.dup) view.guesses.push({ w: x.w, n: x.n });
  flash(m.items.map(x => (x.dup ? `« ${x.w} » déjà proposé` : x.n ? `« ${x.w} » : ${plural(x.n, 'mot')} dévoilé${x.n > 1 ? 's' : ''}` : `« ${x.w} » n'est pas dans le texte`)).join(' · '));
  renderPage();
  renderSide();
}

function onHint(m) {
  uncover(m.revealed);
  flash(`Indice du meneur : « ${m.word} »`);
  renderPage();
}

function render() {
  renderPlayers();
  renderTimers();
  renderBar();
  renderPage();
  renderSide();
}

function renderPlayers() {
  $('#players').innerHTML = st.players
    .map(
      p => `<li class="${p.online ? '' : 'off'}${p.id === st.you ? ' me' : ''}">
        <span class="pname">${esc(p.name)}</span>
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
  let html = st.round ? `Manche ${st.round}` : '';
  if (st.phase === 'playing') {
    html += ` · ${clock(now - st.startedAt)}`;
    const end = Math.min(st.chronoEnd ?? Infinity, st.maxEnd ?? Infinity);
    if (end < Infinity) html += `<br>${st.chronoEnd ? '<b>' : ''}Fin dans ${clock(end - now)}${st.chronoEnd ? '</b>' : ''}`;
  }
  $('#timers').innerHTML = html;
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
      r => `<tr><td>${r.rank + 1}</td><td>${esc(nameOf(r.id))}</td>
        <td>${r.found ? `trouvé en ${duration(r.time)}` : `${r.pct} % dévoilé`}</td>
        <td>${plural(r.guesses, 'essai')}</td><td>+${r.points}</td></tr>`,
    )
    .join('');
  return `<table class="results"><tr><th>#</th><th>Joueur</th><th>Résultat</th><th>Essais</th><th>Points</th></tr>${rows}</table>`;
}

function renderBar() {
  const boss = isBoss(), meneur = isMeneur();
  const mine = st.players.find(p => p.id === st.you);
  const online = st.players.filter(p => p.online).length;
  const mode = {
    lobby: `lobby:${boss}:${online}:${JSON.stringify(st.settings)}`,
    choosing: meneur ? 'pick' : `wait-pick:${st.meneurId}:${boss}`,
    playing: meneur ? `meneur:${st.round}` : !mine?.playing ? 'spectator' : st.foundTime != null ? `found:${st.round}` : `guess:${st.round}`,
    roundEnd: `results:${st.round}:${boss || meneur}`,
    gameEnd: `end:${boss}`,
  }[st.phase];
  if (mode === barMode) return;
  barMode = mode;

  const bar = $('#bar');
  switch (st.phase) {
    case 'lobby':
      bar.innerHTML =
        settingsForm(boss) +
        (boss
          ? `<button data-send="start"${online < 2 ? ' disabled' : ''}>Lancer la partie</button>
             ${online < 2 ? '<small>Envoie le lien du salon à tes amis (5 personnes max).</small>' : ''}`
          : "<p>En attente du lancement par l'hôte…</p>");
      break;
    case 'choosing':
      bar.innerHTML = meneur
        ? `<p>Tu es le meneur : choisis la page que les autres vont chercher.</p>
           <form id="pick" class="row"><input id="q" placeholder="Chercher une page Wikipédia…" autocomplete="off"><button>Valider</button></form>
           <ul id="suggest" class="suggest"></ul>`
        : `<p><b>${esc(nameOf(st.meneurId))}</b> choisit une page…</p>
           ${boss ? '<button class="alt" data-send="skip" data-confirm="Passer au meneur suivant ?">Passer son tour</button>' : ''}`;
      $('#q')?.focus();
      break;
    case 'playing':
      if (meneur)
        bar.innerHTML = `<p>Tu es le meneur : les autres cherchent « <b>${esc(st.page.title)}</b> ». Clique sur un mot du texte pour le donner en indice.</p>
          ${st.settings.meneurStop ? '<button class="alt" data-send="stop" data-confirm="Arrêter la manche maintenant ?">Arrêter la manche</button>' : ''}`;
      else if (!mine?.playing) bar.innerHTML = '<p>Manche en cours : tu joueras à la prochaine.</p>';
      else if (st.foundTime != null) bar.innerHTML = `<p class="win">Bravo, trouvé en ${duration(st.foundTime)} ! Attends la fin de la manche.</p>`;
      else {
        bar.innerHTML = '<form id="guessForm" class="row"><input id="word" placeholder="Propose un mot" autocomplete="off" maxlength="60"><button>Envoyer</button></form>';
        $('#word').focus();
      }
      break;
    case 'roundEnd':
      bar.innerHTML = `<h2>C'était « <a href="${esc(st.page.url)}" target="_blank" rel="noopener">${esc(st.page.title)}</a> »</h2>
        ${resultsTable()}
        ${boss || meneur ? `<button data-send="next">${st.last ? 'Voir le classement final' : 'Manche suivante'}</button>` : '<p>En attente de la manche suivante…</p>'}`;
      break;
    case 'gameEnd': {
      const ranked = [...st.players].sort((a, b) => b.score - a.score);
      bar.innerHTML = `<h2>Classement final</h2>
        <ol class="final">${ranked.map(p => `<li><b>${esc(p.name)}</b> : ${p.score} points</li>`).join('')}</ol>
        ${boss ? '<button data-send="start">Rejouer</button> <button class="alt" data-send="lobby">Changer les réglages</button>' : "<p>En attente de l'hôte…</p>"}`;
      break;
    }
  }
}

function renderPage() {
  const el = $('#page'), p = st?.page;
  if (!p || (st.phase !== 'playing' && st.phase !== 'roundEnd')) {
    el.innerHTML = '';
    return;
  }
  const meneur = st.phase === 'playing' && isMeneur();
  const hinted = new Set(st.hinted || []);
  const word = i => {
    if (p.texts) return meneur ? `<span class="mw${hinted.has(i) ? ' hinted' : ''}" data-i="${i}">${esc(p.texts[i])}</span>` : esc(p.texts[i]);
    const r = view.revealed.get(i);
    if (r != null) return `<span class="ok${view.fresh.has(i) ? ' new' : ''}">${esc(r)}</span>`;
    const h = view.hints.get(i), n = p.lens[i];
    const heat = h ? Math.min(1, Math.max(0, (h.s - 0.3) / 0.5)) : 0;
    const title = `${plural(n, 'lettre')}${h ? ` · proche à ${Math.round(h.s * 100)} %` : ''}`;
    return `<span class="w${h && h.s >= 0.6 ? ' hot' : ''}" style="--n:${n};--h:${heat.toFixed(2)}" title="${title}">${h ? esc(h.w) : ''}</span>`;
  };
  const line = tokens => tokens.map(t => (typeof t === 'number' ? word(t) : esc(t))).join('');
  el.innerHTML =
    `<h1 class="title">${line(p.titleTokens)}</h1>` +
    p.paragraphs.map(par => `<p>${line(par)}</p>`).join('') +
    (p.url && st.phase === 'playing' ? `<p class="src"><a href="${esc(p.url)}" target="_blank" rel="noopener">Voir la page sur Wikipédia</a></p>` : '');
  view.fresh.clear();
}

function renderSide() {
  const el = $('#side');
  const list = (items, total) =>
    `<ol reversed start="${total}">${[...items].reverse().map(x => `<li>${esc(x.w)}${x.n ? ` <span class="plus">+${x.n}</span>` : ''}</li>`).join('')}</ol>`;
  if (st.phase === 'playing' && isMeneur()) {
    el.innerHTML =
      '<h3>En direct</h3>' +
      st.players
        .filter(p => p.playing)
        .map(p => {
          const g = view.live[p.id] || [];
          return `<div class="live"><b>${esc(p.name)}</b> · ${plural(g.length, 'essai')}${p.found ? ' · trouvé' : ''}${list(g.slice(-8), g.length)}</div>`;
        })
        .join('');
  } else if (st.phase === 'playing' && view.guesses.length) {
    el.innerHTML = `<h3>Mes essais (${view.guesses.length})</h3><div class="guesses">${list(view.guesses, view.guesses.length)}</div>`;
  } else el.innerHTML = '';
}

async function search(text) {
  const seq = ++searchSeq;
  const ul = $('#suggest');
  if (!ul) return;
  if (!text) return void (ul.innerHTML = '');
  const url =
    'https://fr.wikipedia.org/w/api.php?' +
    new URLSearchParams({
      action: 'query',
      format: 'json',
      formatversion: '2',
      origin: '*',
      generator: 'prefixsearch',
      gpssearch: text,
      gpslimit: '8',
      prop: 'description|pageprops',
      ppprop: 'disambiguation',
      redirects: '1',
    });
  try {
    const pages = (await (await fetch(url)).json()).query?.pages ?? [];
    if (seq !== searchSeq || !$('#suggest')) return;
    pages.sort((a, b) => (a.index ?? 99) - (b.index ?? 99));
    $('#suggest').innerHTML = pages
      .map(p => {
        const homonymie = p.pageprops && 'disambiguation' in p.pageprops;
        return `<li ${homonymie ? 'class="off"' : `data-title="${esc(p.title)}"`}><b>${esc(p.title)}</b> <span>${esc(homonymie ? "page d'homonymie" : p.description || '')}</span></li>`;
      })
      .join('');
  } catch {
    flash('Recherche Wikipédia impossible pour le moment.', true);
  }
}

function choose(title) {
  send({ t: 'page', title });
  flash(`Chargement de « ${title} »…`);
}

$('#bar').addEventListener('click', e => {
  const b = e.target.closest('button[data-send]');
  if (b && (!b.dataset.confirm || confirm(b.dataset.confirm))) send({ t: b.dataset.send });
  const li = e.target.closest('#suggest [data-title]');
  if (li) choose(li.dataset.title);
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
  if (e.target.id === 'guessForm') {
    const w = $('#word');
    if (w.value.trim()) send({ t: 'guess', word: w.value.trim() });
    w.value = '';
    w.focus();
  } else if (e.target.id === 'pick') {
    const q = $('#q').value.trim();
    if (q) choose(q);
  }
});

$('#page').addEventListener('click', e => {
  const w = e.target.closest('.mw');
  if (!w || w.classList.contains('hinted') || st.phase !== 'playing' || !isMeneur()) return;
  if (confirm(`Donner « ${w.textContent} » en indice à tous les joueurs ?`)) send({ t: 'hint', i: Number(w.dataset.i) });
});

$('#copy').addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(location.href);
    flash('Lien copié : envoie-le à tes amis.');
  } catch {
    prompt('Copie ce lien :', location.href);
  }
});

document.addEventListener('keydown', e => {
  const w = $('#word');
  const typing = ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName);
  if (w && !typing && e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) w.focus();
});

setInterval(() => st?.phase === 'playing' && renderTimers(), 1000);
setInterval(() => ws?.readyState === 1 && ws.send('ping'), 30000);

const saved = store.get('pikiguess.name');
if (code && saved) enter(saved);
else home();
