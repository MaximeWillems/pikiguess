export class UserError extends Error {}

const API = 'https://fr.wikipedia.org/w/api.php';
const HEADERS = { 'User-Agent': 'Pikiguess/1.0 (https://github.com/MaximeWillems/pikiguess)' };

export async function fetchPage(title) {
  if (!title.trim()) throw new UserError('Choisis une page.');
  const q = new URLSearchParams({
    action: 'query',
    format: 'json',
    formatversion: '2',
    redirects: '1',
    prop: 'extracts|pageprops|info',
    inprop: 'url',
    exintro: '1',
    explaintext: '1',
    ppprop: 'disambiguation',
    titles: title,
  });
  const res = await fetch(`${API}?${q}`, { headers: HEADERS });
  if (!res.ok) throw new UserError('Wikipédia ne répond pas, réessaie.');
  const page = (await res.json()).query?.pages?.[0];
  if (!page || page.missing || page.invalid) throw new UserError('Page introuvable.');
  if (page.pageprops && 'disambiguation' in page.pageprops) throw new UserError("C'est une page d'homonymie : choisis une page précise.");
  const extract = page.extract?.trim();
  if (!extract) throw new UserError("Cette page n'a pas d'intro : choisis-en une autre.");
  return { title: page.title, url: page.fullurl, extract };
}

const NAMESPACE = /^(Spécial|Special|Wikipédia|Wikipedia|Fichier|File|Catégorie|Category|Portail|Modèle|Template|Aide|Help|Utilisateur|User|Projet|Module|Discussion|Référence|MediaWiki|Sujet|Média)\s*:/i;
const SKIP = /^(Liste|Décès|Mort|Chronologie)\b|\(homonymie\)|xxx|xnxx|xvideos|xhamster|porn|hentai|onlyfans|brazzers|chaturbate|stripchat|sexe|sexualit|érotique|erotique/i;

export const playable = title => title.length > 1 && !/^\d+$/.test(title) && !NAMESPACE.test(title) && !SKIP.test(title);

let popular = null;

// Les pages les plus consultées de Wikipédia en français ces 6 derniers mois (1000 par mois), gardées un jour.
export async function popularTitles() {
  if (popular?.until > Date.now()) return popular.titles;
  const now = new Date();
  const lists = await Promise.all(
    [1, 2, 3, 4, 5, 6].map(async k => {
      const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - k, 1));
      const month = `${d.getUTCFullYear()}/${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
      const res = await fetch(`https://wikimedia.org/api/rest_v1/metrics/pageviews/top/fr.wikipedia/all-access/${month}/all-days`, { headers: HEADERS }).catch(() => null);
      return res?.ok ? ((await res.json()).items?.[0]?.articles ?? []) : [];
    }),
  );
  const titles = [...new Set(lists.flat().map(a => a.article.replace(/_/g, ' ')))].filter(playable);
  if (!titles.length) throw new UserError("La liste des pages les plus consultées n'est pas disponible, réessaie.");
  popular = { titles, until: Date.now() + 86_400_000 };
  return titles;
}

const pickOne = list => list[Math.floor(Math.random() * list.length)];

export async function randomPopularPage() {
  const titles = await popularTitles();
  for (let i = 0; i < 6; i++) {
    try {
      return await fetchPage(pickOne(titles));
    } catch (e) {
      if (!(e instanceof UserError)) throw e;
    }
  }
  throw new UserError('Aucune page trouvée, réessaie.');
}

export async function popularIdeas(n) {
  const titles = await popularTitles();
  const out = new Set();
  while (out.size < Math.min(n, titles.length)) out.add(pickOne(titles));
  return [...out];
}
