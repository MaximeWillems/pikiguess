import { before, test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { Lexicon } from '../src/lexicon.js';
import { playable } from '../src/wikipedia.js';
import { distance, edits1, sound } from '../src/spell.js';
import { buildHelp } from '../tools/prepare_help.mjs';
import { analyze, buildPage, camView, cleanExtract, guess, isFound, newRun, normalize, playerView, ranking, reveal, spelling } from '../src/game.js';

const TITLE = 'Mercure (planète)';
const EXTRACT = "Le roi est né en 1789 ( ). Les rois sont nés à Paris, l'empire naquit.\n\nLa révolution est une fête, là.";
let lex, help;

before(() => {
  execFileSync('python', ['test/make_fixtures.py'], { stdio: 'pipe' });
  const load = f => {
    const b = readFileSync(`test/.data/out/${f}`);
    return b.buffer.slice(b.byteOffset, b.byteOffset + b.length);
  };
  lex = new Lexicon(load('words.bin'), load('vectors.bin'), JSON.parse(readFileSync('test/.data/out/variantes.json', 'utf8')));
  help = buildHelp('test/.data/out').help;
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
  assert.equal(cleanExtract("(en néerlandais : België /ˈbɛlɣiə/ ; en wallon : Beldjike /bɛl'dʒik/), en forme"), '(en néerlandais : België ; en wallon : Beldjike), en forme');
  assert.equal(cleanExtract('130 km/h, 3/4 et 1/2'), '130 km/h, 3/4 et 1/2');
  const page = buildPage('Albert Einstein', 'Albert Einstein (prononcé en allemand [ˈalbɐt] ), né le 14 mars 1879.');
  assert.deepEqual(page.words.map(w => w.text), ['Albert', 'Einstein', 'Albert', 'Einstein', 'né', 'le', '14', 'mars', '1879']);
});

test('nombres et dates : chaque sorte de nombre avec son échelle', () => {
  const page = buildPage(
    'Test',
    'En 1889, la tour de 330 m ouvre le 15 mai 1889. Au XIXe siècle, Louis XIV puis Napoléon Ier. Né en 382 av. J.-C. Elle compte 3 000 habitants, soit 0,31 %.',
  );
  const kinds = Object.fromEntries(page.words.filter(w => w.num).map(w => [w.text, w.num.kind]));
  assert.deepEqual(
    [kinds['1889'], kinds['330'], kinds['15'], kinds.mai, kinds.XIXe, kinds.XIV, kinds.Ier, kinds['382'], kinds['3 000'], kinds['0,31']],
    ['year', 'qty', 'day', 'month', 'century', 'roman', 'roman', 'year', 'qty', 'qty'],
  );

  const keys = analyze(page, null);
  const best = (w, target) => Math.max(0, ...guess(page, keys, null, newRun(), w).hints.filter(([i]) => page.words[i].text === target).map(h => h[2]));
  assert.ok(best('1890', '1889') >= 0.9);
  assert.ok(best('1950', '1889') >= 0.3 && best('1950', '1889') < 0.6);
  assert.equal(best('2200', '1889'), 0);
  assert.ok(best('1850', 'XIXe') >= 0.9);
  assert.ok(best('19', 'XIXe') >= 0.9);
  assert.ok(best('14', 'XIV') >= 0.9);
  assert.ok(best('juin', 'mai') >= 0.5);
  assert.ok(best('380', '382') >= 0.9);
  assert.ok(best('300', '330') >= 0.6);
  assert.equal(best('1889', '330'), 0);
  assert.deepEqual(texts(page, guess(page, keys, null, newRun(), '3000').revealed), ['3 000']);
});

test('nationalités : formes en « -o », pays, et nationalités voisines', () => {
  const page = buildPage('Test', 'Un film américano-britannique, tourné par des Américains en Angleterre.');
  const keys = analyze(page, lex);
  const go = w => guess(page, keys, lex, newRun(), w);
  assert.deepEqual(texts(page, go('américaine').revealed).sort(), ['Américains', 'américano']);
  const best = (w, target) => Math.max(0, ...go(w).hints.filter(([i]) => page.words[i].text === target).map(h => h[2]));
  assert.ok(best('anglais', 'Angleterre') >= 0.9);
  assert.ok(best('anglais', 'britannique') >= 0.9);
  assert.ok(best('français', 'britannique') <= 0.35);

  const canada = buildPage('Test', 'Un acteur canadien et une chanteuse québécoise.');
  const near = (w, target) =>
    Math.max(0, ...guess(canada, analyze(canada, lex), lex, newRun(), w).hints.filter(([i]) => canada.words[i].text === target).map(h => h[2]));
  assert.ok(near('Québec', 'canadien') >= 0.9);
  assert.ok(near('Canada', 'québécoise') >= 0.9);
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
  assert.deepEqual(texts(page, go('le').revealed).sort(), ['La', 'Le', 'Les', 'l']);
});

test('les petits mots se dévoilent avec leur féminin, pluriel et formes contractées', () => {
  const page = buildPage('Test', 'Le chat de la voisine et les chiens du quartier vont à la plage, au parc et aux champs, avec une amie et des voisins.');
  const keys = analyze(page, lex);
  const run = newRun();
  const go = w => texts(page, guess(page, keys, lex, run, w).revealed).sort();
  assert.deepEqual(go('un'), ['une']);
  assert.deepEqual(go('le'), ['Le', 'la', 'la', 'les']);
  assert.deepEqual(go('de'), ['de', 'des', 'du']);
  assert.deepEqual(go('à'), ['au', 'aux', 'à']);
});

test("« avoir » ne dévoile ni « s' » ni « à », mais « a » sans accent dévoile « à »", () => {
  const page = buildPage('Test', "Il s'agit de ce qu'il a fait à Paris et au Louvre, où ils ont vécu.");
  const keys = analyze(page, lex);
  const go = w => texts(page, guess(page, keys, lex, newRun(), w).revealed).sort();
  assert.deepEqual(go('avoir'), ['a', 'ont']);
  assert.deepEqual(go('a'), ['a', 'au', 'ont', 'à']);
  assert.deepEqual(go('se'), ['s']);
  assert.deepEqual(go('ou'), ['où']);
  const run = newRun();
  guess(page, keys, lex, run, 'avoir');
  assert.deepEqual(texts(page, guess(page, keys, lex, run, 'a').revealed).sort(), ['au', 'à']);
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
  assert.ok(n.hints[0][2] > 0.75);
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
  const r = go('roi');
  assert.equal(r.items[0].n, 2);
  assert.deepEqual(r.items[0].at, r.revealed.map(([i]) => i));
  assert.ok(go('reine').items[0].s > 0.3);
  assert.equal(go('mai').items[0].s, 0);
});

test('pluriel hors dictionnaire : « transformer » dévoile « Transformers », mais « mai » pas « mais »', () => {
  const page = buildPage('Transformers', 'Les Transformers arrivent en mai mais repartent.');
  const keys = analyze(page, lex);
  const go = w => texts(page, guess(page, keys, lex, newRun(), w).revealed).sort();
  assert.deepEqual(go('transformer'), ['Transformers', 'Transformers']);
  assert.deepEqual(go('mai'), ['mai']);
});

test('petits mots de même famille : brûlants entre eux', () => {
  const page = buildPage('Test', 'Le chat dort dessous et le chien sur la table.');
  const keys = analyze(page, lex);
  const near = (w, target) => Math.max(0, ...guess(page, keys, lex, newRun(), w).hints.filter(([i]) => page.words[i].text === target).map(h => h[2]));
  assert.ok(near('sous', 'dessous') >= 0.9);
  assert.ok(near('dessus', 'sur') >= 0.9);
  assert.equal(near('sous', 'sur'), 0);
});

test("mots sans vecteur : l'orthographe donne un indice", () => {
  const page = buildPage('Spinosaurus', 'Le Spinosaurus est un genre de dinosaures.');
  const keys = analyze(page, lex);
  const r = guess(page, keys, lex, newRun(), 'tyrannosaure');
  const s = Object.fromEntries(r.hints.map(([i, , v]) => [page.words[i].text, v]));
  assert.ok(s.Spinosaurus >= 0.3 && s.Spinosaurus <= 0.7);
  assert.ok(s.dinosaures >= 0.5);
  assert.equal(spelling('chaton', 'chateau'), 0);
  assert.ok(spelling('spinosaure', 'spinosaurus') >= 0.9);
});

test('caméra du meneur : ce que voit un joueur', () => {
  const { page, run, go } = play();
  go('roi');
  go('reine');
  const cam = camView(page, run);
  assert.deepEqual(cam.revealed.map(i => page.words[i].text).sort(), ['roi', 'rois']);
  assert.ok(cam.hints.some(([i, w]) => page.words[i].text === 'empire' && w === 'reine'));
  assert.equal(cam.found, false);
});

test('« 1er » compte pour deux mots, « 1 » et « er »', () => {
  const page = buildPage('Test', 'Le 1er janvier, le 7e jour.');
  assert.deepEqual(page.words.map(w => w.text), ['Test', 'Le', '1', 'er', 'janvier', 'le', '7', 'e', 'jour']);
  const keys = analyze(page, lex);
  const r = guess(page, keys, lex, newRun(), '1er');
  assert.deepEqual(r.items.map(x => x.w), ['1', 'er']);
  assert.deepEqual(texts(page, r.revealed), ['1', 'er']);
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

test('lien plus lâche : tiède sur un seul mot caché, si le mot colle au sujet de la page', () => {
  const { page, go } = play();
  const r = go('sceptre');
  assert.equal(r.items[0].s, 0.3);
  assert.deepEqual(r.hints.map(([i]) => page.words[i].text), ['roi']);
  assert.equal(go('manette').items[0].s, 0);
});

test("le sens de l'écriture de la page : « Vénus » la planète, « Mars » la planète, « Avril » sans le sens du mois", () => {
  const near = (text, word) => {
    const page = buildPage('Test', text);
    const r = guess(page, analyze(page, lex), lex, newRun(), word);
    return r.hints.map(([i]) => page.words[i].text);
  };
  assert.deepEqual(near('On voit Vénus et Mars le soir.', 'astre').sort(), ['Mars', 'Vénus']);
  assert.deepEqual(near('On voit Vénus le soir.', 'naquit'), []);
  assert.deepEqual(near('Ils sont venus le soir.', 'naquit'), ['venus']);
  assert.deepEqual(near('Il chante avec Avril.', 'juin'), []);
  assert.deepEqual(near('Il est parti en avril 2020.', 'naquit'), ['avril']);
});

test("mot qui n'existe pas : signalé, et il ne compte pas s'il ne réchauffe rien", () => {
  const { run, go } = play();
  assert.deepEqual(go('zorglub').items, [{ w: 'zorglub', unknown: true }]);
  assert.deepEqual(go('zorglub').items, [{ w: 'zorglub', unknown: true }]);
  assert.equal(run.guesses.length, 0);
  const near = go('revolutiom').items[0];
  assert.ok(near.unknown && near.s >= 0.9);
  assert.equal(run.guesses.length, 1);
  assert.equal(go('1957').items[0].unknown, undefined);
  assert.equal(go('mercure').items[0].unknown, undefined);
});

test("aide à l'écriture : le son des mots", () => {
  const same = [
    ['phonétique', 'fonétik'], ['automobile', 'otomobil'], ['beaucoup', 'bocou'], ['dinosaure', 'dinosor'],
    ['téléphone', 'téléfone'], ['verre', 'vert'], ['vert', 'vers'], ['cinéma', 'sinéma'], ['enfant', 'anfan'],
    ['manger', 'mangé'], ['château', 'shato'], ['pain', 'pin'], ['photographie', 'fotografi'], ['garçon', 'garsson'],
  ];
  for (const [a, b] of same) assert.equal(sound(a), sound(b), `${a} / ${b}`);
  assert.notEqual(sound('poisson'), sound('poison'));
  assert.notEqual(sound('chat'), sound('chien'));
  assert.equal(distance('porbleme', 'probleme'), 1);
  assert.equal(distance('chat', 'chien'), 3);
  assert.ok([...edits1('porbleme')].includes('probleme'));
});

test("aide à l'écriture : mots proches et liste pendant la frappe, pris dans le dictionnaire seulement", () => {
  assert.ok(help.fits(lex));
  assert.deepEqual(help.suggest(lex, 'planette'), ['planète', 'planètes']);
  assert.deepEqual(help.suggest(lex, 'revolusion'), ['révolution']);
  assert.equal(help.suggest(lex, 'amériquain')[0], 'américain');
  assert.deepEqual(help.suggest(lex, 'planète'), []);
  assert.deepEqual(help.suggest(lex, 'zq'), []);
  assert.deepEqual(help.complete(lex, 'pla'), ['planète', 'planètes']);
  assert.deepEqual(help.complete(lex, 'rev'), ['révolution']);
  // « Mercure », mot de la page absent du dictionnaire, n'est jamais proposé
  assert.deepEqual(help.suggest(lex, 'mercur'), []);
  assert.deepEqual(help.complete(lex, 'merc'), []);
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
  assert.deepEqual(rows.map(r => [r.id, r.points]), [['b', 1000], ['a', 600], ['c', 300], ['d', 300], ['e', 50]]);
  assert.equal(rows[0].time, 50);
});
