import { before, test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { Lexicon } from '../src/lexicon.js';
import { playable } from '../src/wikipedia.js';
import { analyze, buildPage, cleanExtract, guess, isFound, newRun, normalize, numberCloseness, playerView, ranking, reveal } from '../src/game.js';

const TITLE = 'Mercure (planète)';
const EXTRACT = "Le roi est né en 1789 ( ). Les rois sont nés à Paris, l'empire naquit.\n\nLa révolution est une fête, là.";
let lex;

before(() => {
  execFileSync('python', ['test/make_fixtures.py'], { stdio: 'pipe' });
  const load = f => {
    const b = readFileSync(`test/.data/out/${f}`);
    return b.buffer.slice(b.byteOffset, b.byteOffset + b.length);
  };
  lex = new Lexicon(load('words.bin'), load('vectors.bin'));
});

function play(lexicon = lex) {
  const page = buildPage(TITLE, EXTRACT);
  const keys = analyze(page, lexicon);
  const run = newRun();
  return { page, run, go: word => guess(page, keys, lexicon, run, word), keys };
}

const texts = (page, revealed) => revealed.map(([i]) => page.words[i].text);

test('normalisation : minuscules, sans accents ni ligatures', () => {
  assert.equal(normalize('Égypte'), 'egypte');
  assert.equal(normalize('Œuvre'), 'oeuvre');
});

test('le texte est découpé en mots, parenthèses vides retirées', () => {
  const page = buildPage(TITLE, EXTRACT);
  assert.deepEqual(page.titleWords.map(i => page.words[i].text), ['Mercure', 'planète']);
  assert.equal(page.paragraphs.length, 2);
  assert.ok(page.paragraphs[0].includes('. '));
  assert.ok(!page.paragraphs[0].some(t => typeof t === 'string' && t.includes('(')));
});

test('la prononciation est retirée du texte', () => {
  assert.equal(cleanExtract('La tour Eiffel [tuʁɛfɛl]  est une tour'), 'La tour Eiffel   est une tour');
  assert.equal(cleanExtract('Albert Einstein (prononcé en allemand [ˈalbɐt ˈaɪnʃtaɪn] ), né'), 'Albert Einstein , né');
  assert.equal(cleanExtract('Mercure (planète) est'), 'Mercure (planète) est');
  const page = buildPage('Albert Einstein', 'Albert Einstein (prononcé en allemand [ˈalbɐt] ), né le 14 mars 1879.');
  assert.deepEqual(page.words.map(w => w.text), ['Albert', 'Einstein', 'Albert', 'Einstein', 'né', 'le', '14', 'mars', '1879']);
});

test('écart entre nombres : années à ±30 ans, le reste à 15 %', () => {
  assert.ok(numberCloseness(1789, 1790) > 0.9);
  assert.ok(numberCloseness(1889, 1914) > 0.3);
  assert.ok(numberCloseness(1889, 1957) < 0.3);
  assert.ok(numberCloseness(330, 300) > 0.3);
  assert.ok(numberCloseness(15, 18) > 0.3);
  assert.ok(numberCloseness(1, 9) < 0.3);
});

test('lexique : recherche, mot de base, doublons de casse', () => {
  assert.equal(lex.find('inconnu'), -1);
  assert.equal(lex.find("c'est"), -1);
  const rois = lex.find('rois');
  assert.deepEqual([...lex.lemmas(rois)], [lex.find('roi')]);
  assert.equal(lex.row(lex.find('paris')), 5);
  assert.deepEqual([...lex.lemmas(lex.find('l'))], [lex.find('le')]);
});

test('un mot se dévoile sous toutes ses formes', () => {
  const { page, go } = play();
  assert.deepEqual(texts(page, go('roi').revealed).sort(), ['roi', 'rois']);
  assert.deepEqual(texts(page, go('etre').revealed).sort(), ['est', 'est', 'sont']);
  assert.deepEqual(texts(page, go('naître').revealed).sort(), ['naquit', 'né', 'nés']);
  assert.deepEqual(texts(page, go('le').revealed).sort(), ['La', 'Le', 'Les', 'l', 'là']);
});

test('déjà proposé ou déjà dévoilé', () => {
  const { go } = play();
  go('roi');
  assert.deepEqual(go('Roi').items, [{ w: 'roi', dup: true }]);
  assert.deepEqual(go('rois').items, [{ w: 'rois', dup: true }]);
});

test('mots grisés : par le sens et par écart entre nombres', () => {
  const { page, run, go } = play();
  go('roi');
  const r = go('reine');
  assert.deepEqual(r.hints.map(([i]) => page.words[i].text), ['empire']);
  assert.ok(run.hints.get('empire').s > 0.3);
  const n = go('1790');
  assert.equal(n.hints.length, 1);
  assert.equal(page.words[n.hints[0][0]].text, '1789');
  assert.ok(n.hints[0][2] > 0.9);
  const view = playerView(page, run);
  assert.ok(view.hints.some(([, w]) => w === '1790'));
  assert.ok(!view.revealed.some(([, t]) => t === 'Mercure'));
});

test('les petits mots se dévoilent mais ne grisent rien', () => {
  const { page, go } = play();
  const r = go('le');
  assert.ok(r.revealed.length > 0);
  assert.deepEqual(r.hints, []);
  assert.deepEqual(texts(page, go('une').revealed), ['une']);
});

test('la page est trouvée quand tout le titre est dévoilé, parenthèse comprise', () => {
  const { page, run, go } = play();
  go('mercure');
  assert.equal(isFound(page, run), false);
  go('planete');
  assert.equal(isFound(page, run), true);
});

test('chaque essai garde sa proximité avec le mot caché le plus proche', () => {
  const { go } = play();
  assert.equal(go('roi').items[0].n, 2);
  assert.ok(go('reine').items[0].s > 0.3);
  assert.equal(go('xyz').items[0].s, 0);
});

test('plusieurs mots en une saisie', () => {
  const { go } = play();
  assert.equal(go('Grande-Bretagne').items.length, 2);
});

test('sans données : seulement les mots exacts', () => {
  const { page, go } = play(null);
  assert.deepEqual(texts(page, go('roi').revealed), ['roi']);
  assert.equal(go('1790').hints.length, 1);
});

test("indice du meneur : le mot et ses formes s'affichent", () => {
  const { page, run, keys } = play();
  assert.deepEqual(texts(page, reveal(page, keys, lex, run, 'rois')).sort(), ['roi', 'rois']);
});

test('pages populaires : sans pages techniques, listes ni pages pour adultes', () => {
  for (const t of ['Lionel Messi', 'France', 'Spider-Man: Brand New Day', "L'Odyssée (film, 2026)"]) assert.ok(playable(t), t);
  const out = ['Spécial:Recherche', 'Wikipédia:Accueil principal', 'Fichier:France relief location map.jpg', 'Liste des éclipses solaires', 'Décès en août 2026'];
  for (const t of [...out, 'XNXX', '.xxx', 'Sexe', 'XXXX (homonymie)', '2026', '-']) assert.ok(!playable(t), t);
});

test('classement et points', () => {
  const page = buildPage(TITLE, EXTRACT);
  const run = (foundAt, words) => ({ ...newRun(), foundAt, revealed: new Set(words) });
  const rows = ranking(
    page,
    {
      a: run(1100, ['mercure', 'planete']),
      b: run(1050, ['mercure', 'planete']),
      c: run(null, ['le', 'roi']),
      d: run(null, ['en', 'roi']),
      e: run(null, ['roi']),
    },
    1000,
  );
  assert.deepEqual(rows.map(r => [r.id, r.points]), [['b', 1000], ['a', 600], ['c', 300], ['d', 300], ['e', 0]]);
  assert.equal(rows[0].time, 50);
});
