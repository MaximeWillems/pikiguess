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
