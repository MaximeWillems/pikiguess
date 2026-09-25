# Pikiguess

Un [Pédantix](https://pedantix.certitudes.org) entre amis : au lieu d'une page Wikipédia du jour commune à tous, un joueur crée un salon, choisit une page, et ses amis doivent la trouver. Le premier qui trouve gagne.

## Mise en ligne (à faire une fois)

1. Créer le dépôt `pikiguess` sur GitHub (compte maximew2000@gmail.com) et y pousser ce dossier.
2. Cloudflare → Workers & Pages → Créer → Importer un dépôt Git → `pikiguess`. Nom du Worker : `pikiguess`, commande de déploiement : `npx wrangler deploy` (proposée par défaut). Ensuite, chaque push remet le jeu en ligne.
3. GitHub → onglet Actions → « Données » → Run workflow. L'Action télécharge les vecteurs et Lexique sur les serveurs de GitHub, prépare `public/data/` et l'ajoute au dépôt, ce qui remet le jeu en ligne.

Sans ces données, le jeu marche quand même, mais sans mots grisés ni formes : seuls les mots exacts se dévoilent.

## Règles

- On affiche l'intro d'une page Wikipédia telle quelle, titre compris, chaque mot caché sous une case noire de la taille du mot. Au départ rien n'est dévoilé, même pas les petits mots (le, de, et…).
- Le joueur propose un mot : s'il est dans le texte, il se dévoile partout et sous toutes ses formes (pluriel, féminin, conjugaisons : « naître » dévoile « né », « naquit »…). Majuscules et accents ignorés : « egypte » dévoile « Égypte ».
- Sinon, il s'affiche en grisé dans les cases des mots proches par le sens : plus il est proche, plus il est lisible. Chaque case garde le mot le plus proche proposé jusque-là.
- Nombres et dates : un nombre est aussi proche d'un autre selon l'écart (« 1790 » s'affiche dans la case de « 1789 »). Le plus proche l'emporte, par l'écart ou par le sens.
- Le but est juste de trouver le titre : la page est trouvée quand tous les mots du titre sont dévoilés, parenthèse comprise (pour « Mercure (planète) », il faut aussi « planète »).

## Déroulé d'une partie

1. Un joueur (l'hôte) crée un salon, règle la partie et partage le lien. 5 personnes max : 4 joueurs + le meneur. Pas de compte, juste un pseudo.
2. À chaque manche, un joueur est meneur : il choisit la page Wikipédia (recherche par titre) et ne joue pas cette manche. L'hôte commence.
3. Top départ : chacun joue sur sa propre grille, sans voir les mots des autres.
4. Pendant la manche, on voit seulement qui a trouvé. Le reste (essais, part du texte dévoilée) s'affiche à la fin.
5. Le premier qui dévoile le titre gagne la manche ; les autres continuent pour le classement.
6. La manche s'arrête quand tout le monde a trouvé, ou selon les réglages.
7. Manche suivante : un autre joueur devient meneur.

## Réglages de la partie

L'hôte règle la partie comme il veut :

- chrono après le 1er gagnant, ou non : les autres ont X minutes pour finir ;
- durée maximale de manche, ou non : la page est dévoilée même si personne n'a trouvé ;
- arrêt de la manche par le meneur, autorisé ou non ;
- nombre de tours : à chaque tour, chacun est meneur une fois.

## Points

- Classement de chaque manche : d'abord ceux qui ont trouvé le titre, par ordre d'arrivée, puis les autres selon le nombre de mots dévoilés.
- Points par place, qu'on ait trouvé ou non : 1000, 600, 300, 100. Gros écarts, car une partie compte peu de manches.
- Le meneur ne marque rien pendant sa manche : chacun est meneur à son tour, c'est équitable.

## Le meneur pendant sa manche

- Il voit tout en direct : le texte complet et les mots proposés par chacun.
- Il peut donner un indice : un mot se dévoile chez tous les joueurs.

## Pas prévu pour l'instant

- Page au hasard : pas de meneur, tout le monde joue.
- Grille commune : tous dévoilent la même grille, un point par mot trouvé, gros bonus pour le titre.
- Chat : on joue en vocal à côté.

## Données

### Vecteurs de mots (Fauconnier)

[fauconnier.github.io/#data](https://fauconnier.github.io/#data) : modèles word2vec en français. Chaque mot y est une liste de nombres (un vecteur) ; deux mots proches par le sens ont des vecteurs proches. C'est ce qui donne les mots grisés.

- Modèle retenu : `frWac_non_lem_no_postag_no_phrase_200_skip_cut100.bin` (126 Mo, entraîné sur frWaC, 1,6 milliard de mots). Non lemmatisé : il garde les nombres (« 1789 » reste proche de « révolution ») et ses 200 dimensions tiennent en ligne sans réduction.
- Le script `tools/prepare_data.py` garde les 100 000 mots les plus fréquents et compresse les vecteurs (un octet par nombre) : environ 20 Mo, sous la limite de 25 Mo par fichier de Cloudflare.
- Licence CC-BY 3.0 : auteur cité en bas de page, avec un lien.

### Dictionnaire des formes (Lexique 3.83)

[Lexique 3.83](http://www.lexique.org) relie chaque forme à son mot de base (« naquit » → « naître »). C'est lui qui dévoile toutes les formes d'un mot ; les vecteurs ne servent qu'aux mots grisés. Licence CC BY-SA 4.0, cité en bas de page.

## Technique : Cloudflare, 100 % gratuit

- Front en JS, sans outil de build, dans `public/`. PC d'abord, utilisable sur téléphone sans effort particulier.
- Un salon = un Durable Object (`src/room.js`) : il garde la page, les joueurs et les scores, et échange avec les joueurs en WebSocket. Les connexions sont mises en veille quand personne ne joue, pour rester dans les quotas gratuits.
- Le texte caché ne part jamais dans le navigateur des joueurs, sinon on triche avec les outils du navigateur : le serveur ne renvoie que les mots trouvés et les indices.
- Texte de la page : API Wikipédia (intro en texte brut), lue par le serveur au début de la manche. La recherche de page du meneur interroge Wikipédia directement depuis son navigateur.

| Fichier | Rôle |
| --- | --- |
| `public/` | les écrans (HTML, CSS, JS) |
| `src/worker.js` | point d'entrée : envoie chaque salon vers son Durable Object |
| `src/room.js` | un salon : joueurs, manches, chronos, connexions |
| `src/game.js` | les règles : mots dévoilés, mots grisés, classement |
| `src/lexicon.js` | lecture des données préparées |
| `tools/prepare_data.py` | préparation des données, lancée par l'Action « Données » |
| `test/` | tests des règles sur de fausses données (`npm test`, demande Python et numpy) |

## Suite

1. Mise en ligne (voir en haut) et première partie de test.
2. Régler le seuil des mots grisés (`HINT_MIN` dans `src/game.js`, 0,3 pour l'instant) d'après les chiffres affichés par l'Action « Données ».
