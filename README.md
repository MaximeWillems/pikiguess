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
- Un mot absent du dictionnaire des formes (nom propre, mot étranger) se dévoile aussi avec son singulier ou son pluriel en -s ou -x : « transformer » dévoile « Transformers ». Pas pour les mots du dictionnaire, qui décide seul (« mai » ne dévoile pas « mais »).
- Les petits mots se dévoilent aussi ensemble : « le » dévoile « la, les, l' », « de » dévoile « du, des, d' », « à » dévoile « au, aux », de même pour « un/une », « ce/cette/ces », « son/sa/ses », « il/elle/ils/elles »… (liste `GROUPS` dans `src/game.js`).
- Sinon, il s'affiche dans les cases des mots proches par le sens : **tiède** (rouge) s'il fait partie des 500 mots les plus proches du mot caché, **chaud** des 100, **brûlant** (vert) des 10. Le calcul se fait mot par mot : un mot courant comme « guerre » ne s'allume plus partout. Pour un mot inconnu des vecteurs (rare, nom savant), on compare l'orthographe : un morceau commun d'au moins 5 lettres donne un indice, au plus chaud (« tyrannosaure » ↔ « Spinosaurus »). Chaque case garde le mot le plus proche proposé jusque-là.
- Un mot trouvé apparaît sur fond vert, qui s'efface en fondu.
- Nombres et dates : entre deux nombres, seul l'écart compte, pour s'approcher petit à petit. Chaque nombre du texte est reconnu d'après les mots autour, avec son échelle :
  - année (« en 1889 », « 382 av. J.-C. ») : brûlant à 1 ou 2 ans près, visible jusqu'à ~120 ans ;
  - siècle (« XIXe siècle », « 19e siècle ») : une année du siècle est brûlante (1850 ↔ XIXe) ;
  - jour (« 21 septembre »), chiffre romain (« Louis XIV », « Ier ») : visible jusqu'à 10 d'écart ;
  - mois et jours de la semaine : par leur écart (juin ↔ mai), plus par le sens ;
  - quantité (« 330 m », « 3 000 habitants », « 0,31 % ») : visible jusqu'à un facteur 6 environ.
  - Les nombres en lettres et les ordinaux (« trois », « premier ») comptent comme des nombres ; « 1er » donne deux mots, « 1 » et « er ».
- Nationalités : « américain » dévoile aussi « américano- » (de même « franco- », « anglo- », « germano- »…), le pays donne un indice brûlant (« anglais » ↔ « Angleterre »), une région aussi avec son pays (« Québec » ↔ « canadien », « anglais » ↔ « britannique », liste `PARENT` dans `src/game.js`), et deux nationalités sans lien ne se ressemblent plus (« américain » sur « britannique », au plus tiède).
- Le but est juste de trouver le titre : la page est trouvée quand tous les mots du titre sont dévoilés, parenthèse comprise (pour « Mercure (planète) », il faut aussi « planète »).

## Déroulé d'une partie

1. Un joueur (l'hôte) crée un salon, règle la partie et partage le lien. 5 personnes max : 4 joueurs + le meneur. Pas de compte, juste un pseudo.
2. À chaque manche, un joueur est meneur : il choisit la page Wikipédia (recherche par titre) et ne joue pas cette manche. L'hôte commence. Tant que la page n'est pas choisie, le meneur (ou l'hôte) peut donner la main à un autre joueur, ou choisir « page au hasard » : une page tirée parmi les plus consultées, sans meneur, tout le monde joue.
3. Top départ : chacun joue sur sa propre grille, sans voir les mots des autres.
4. Pendant la manche, on voit seulement qui a trouvé. Le reste (essais, part du texte dévoilée) s'affiche à la fin.
5. Le premier qui dévoile le titre gagne la manche ; les autres continuent pour le classement.
6. La manche s'arrête quand tout le monde a trouvé, ou selon les réglages.
7. En fin de manche, le meneur choisit qui mène la suivante : lui-même, n'importe quel joueur connecté (ceux qui n'ont pas encore mené sont signalés) ou « tout le monde joue » (page au hasard). L'hôte peut aussi choisir, et il termine la partie quand il veut (« Terminer la partie » : classement final). Après une manche sans meneur, seul l'hôte choisit la suite, et il peut reprendre la main.

L'hôte peut retirer un joueur du salon (×, il peut revenir avec le lien) ou l'exclure (⊘, il ne peut plus revenir). Personne ne peut retirer l'hôte.

Actualiser la page, ou la rouvrir plus tard, reprend la partie là où on en était : même joueur, mêmes mots dévoilés, même historique de ses essais (gardés par le serveur).

## Réglages de la partie

L'hôte règle la partie comme il veut :

- chrono après le 1er gagnant, ou non : les autres ont X minutes pour finir ;
- durée maximale de manche, ou non : la page est dévoilée même si personne n'a trouvé ;
- arrêt de la manche par le meneur, autorisé ou non (sans meneur, c'est l'hôte qui peut arrêter).

## Points

- Classement de chaque manche : d'abord ceux qui ont trouvé le titre, par ordre d'arrivée, puis les autres selon le nombre de mots dévoilés.
- Points par place, qu'on ait trouvé ou non : 1000, 600, 300, 100, 50 (5e place possible quand tout le monde joue). Gros écarts, car une partie compte peu de manches.
- Les manches « tout le monde joue » comptent comme les autres.
- Le meneur ne marque rien pendant sa manche. Pour que ce soit équitable, ceux qui n'ont pas encore mené sont signalés quand le meneur choisit le suivant.

## Le meneur pendant sa manche

- Il passe d'un écran à l'autre avec des onglets, comme des caméras :
  - **Ma vue** : le texte complet, d'où il donne les indices ;
  - **Tous** : les grilles de tous les joueurs côte à côte, en réduit, mises à jour en direct (un clic ouvre celle du joueur) ;
  - **un joueur** : sa grille en grand, exactement comme il la voit (mots dévoilés, mots proches en couleur), avec la liste de ses essais.
- Il peut donner un indice : un mot se dévoile chez tous les joueurs. Il clique sur le mot dans sa vue, ou sur une case dans l'écran d'un joueur (le survol montre le mot caché).

## Mode solo

- Une page tirée au hasard parmi les plus consultées de Wikipédia en français : les 1000 premières de chacun des 6 derniers mois, sans pages techniques, listes, pages d'homonymie ni pages pour adultes.
- Pas de chrono : on joue jusqu'à trouver, ou on clique « Voir la réponse ». Puis « Nouvelle page ».
- Le bouton « Des idées ? » du meneur pioche dans la même liste.

## Pas prévu pour l'instant

- Grille commune : tous dévoilent la même grille, un point par mot trouvé, gros bonus pour le titre.
- Chat : on joue en vocal à côté.

## Données

### Vecteurs de mots (Fauconnier)

[fauconnier.github.io/#data](https://fauconnier.github.io/#data) : modèles word2vec en français. Chaque mot y est une liste de nombres (un vecteur) ; deux mots proches par le sens ont des vecteurs proches. C'est ce qui donne les mots grisés.

- Modèle retenu : `frWac_non_lem_no_postag_no_phrase_200_skip_cut100.bin` (126 Mo, entraîné sur frWaC, 1,6 milliard de mots). Non lemmatisé : il garde les nombres (« 1789 » reste proche de « révolution ») et ses 200 dimensions tiennent en ligne sans réduction.
- Le script `tools/prepare_data.py` garde tous les mots du modèle (environ 155 000, mots rares compris comme « tyrannosaure ») et compresse les vecteurs : un octet par nombre, et autant de dimensions que la limite de 25 Mo par fichier de Cloudflare le permet (environ 165 au lieu de 200). Il calcule aussi, pour chaque mot, la similarité de son 10e, 100e et 500e voisin le plus proche : ce sont les seuils de tiède, chaud et brûlant.
- L'Action « Données » se relance seule quand `tools/` change. Elle écrit `public/data/rapport.txt` : pour des pages de test (`tools/evaluation.json`), le niveau atteint par des mots du sujet et par des mots pièges, avec les données en ligne et avec la version à 100 000 mots, pour comparer.
- Comparé le 03/10/2026 : le modèle entraîné sur Wikipédia (`frWiki_no_lem_no_postag_no_phrase_1000_skip_cut100.bin`) allumait deux fois plus de pièges (36 % contre 18 %) pour autant de mots du sujet : on garde frWaC.
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
| `tools/evaluate.mjs`, `tools/evaluation.json` | mesure des mots proches sur des pages de test (rapport de l'Action) |
| `test/` | tests des règles sur de fausses données (`npm test`, demande Python et numpy) |

## À faire

### Mots proches : la suite

- Lire `public/data/rapport.txt` : vérifier que garder tous les mots (vecteurs réduits) ne dégrade pas les indices par rapport à la version à 100 000 mots.
- À décider : un deuxième avis du modèle Wikipédia pour les mots dont le sens web domine (« suite » est appris comme « Lire la suite » : « saga » n'est que son 6 513e voisin). Gagnerait ces cas, mais ce modèle allumait seul deux fois plus de pièges : à mesurer avec le rapport avant de le mettre en ligne.
- Régler les seuils d'après le rapport et de vraies parties : rangs 10 / 100 / 500 (`RANKS` dans `tools/prepare_data.py`), plancher de similarité 0,25 (`semantic` dans `src/game.js`).
- Pas fait, à décider : une flèche ↑/↓ dans la case d'un nombre (plus grand / plus petit). Les couleurs guident déjà ; la flèche rendrait les nombres très faciles.

### Aide à l'écriture (dyslexie)

Décidé le 03/10/2026, pas encore développé :

- **Pour tous.** Un mot absent du dictionnaire du jeu et du texte, qui ne réchauffe aucune case, est signalé « n'existe pas ». Il ne compte pas comme essai et reste dans la case pour être corrigé.
  - S'il réchauffe une case (orthographe proche d'un mot du texte, comme « spinosaure »), il compte comme aujourd'hui.
  - Aujourd'hui, le jeu répond « pas dans le texte » même quand le mot y est, mal écrit. Les mots courts ne donnent rien (« otel »).
- **Option « Aide à l'écriture », choisie par chaque joueur.** C'est une case à cocher près de la saisie, gardée par son navigateur ; les autres ne voient rien. Elle comprend :
  - **mots proches** : quand le mot n'existe pas, 3 à 5 mots existants à cliquer, les plus courants d'abord. Ils sont proches par l'écriture (lettres inversées, oubliées, en trop) ou par le son (« fonétik » → phonétique, « otomobil » → automobile), confusions b/d, p/q, f/v comprises ;
  - **liste pendant la frappe** : des mots du dictionnaire s'affichent sous la case pendant qu'on tape, ceux qui commencent ou se prononcent pareil. On choisit avec les flèches et Entrée, ou d'un clic.
- **Jamais de correction automatique** : le joueur choisit.
- **Aucun indice** : les propositions viennent du dictionnaire entier, classées par fréquence, jamais du texte de la page.
- **Écarté : le correcteur du navigateur.** Il dépend de la langue du navigateur, souligne des noms propres justes et se corrige au clic droit.
- **Technique.** L'Action « Données » prépare un fichier à part : l'orthographe avec accents (les clés de `words.bin` n'en ont pas) et un index des sons. Le salon ne le charge que quand un joueur utilise l'aide, et les propositions passent par la connexion du salon.
- **À préciser** : une autre aide cochée sans précision.

### Points ouverts
- À mesurer : après une longue pause, le premier mot semble mettre plus d'une seconde à répondre, le temps que le salon recharge ses 25 Mo de données.

### Fait

- Actualiser la page sans perdre la partie ni l'historique de ses essais (vérifié le 28/09/2026).
- Caméras du meneur (voir « Le meneur pendant sa manche »).
- Mots proches : nombres et dates par sorte, nationalités, proximité calibrée mot par mot, mesure sur des pages de test, affichage tiède / chaud / brûlant (voir « Règles »).
