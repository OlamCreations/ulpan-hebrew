# Le traducteur : ce qui n'allait pas, et ce qui a été fait (27/08/2026)

Point de départ, dans les mots de Jonas : « je voudrais avoir le live translator d'ulpanhebrew
dans kita10, ça pourrait utiliser même code, même worker ? mais le live translator fonctionne
très mal ! j'ai l'impression que le code est trop compliqué et que ça embrouille tout au final ».

Ce document dit ce qui a été **mesuré**, ce qui a été **corrigé**, et ce qui reste ouvert.

## 1. Le moteur ne cassait pas. La surface mentait.

19 requêtes rejouées contre la production (`tools/surface-probe-2026-08-27.mjs`), dont 12 tirées
du corpus de kita10 — c'est-à-dire du vocabulaire réellement vu en cours, pas d'un jeu choisi ici.

| Mesure | Avant |
|---|---|
| erreurs JS / requêtes en échec | 0 / 0 |
| requêtes sous le titre « Hebrew — did you mean? » | **14/19**, y compris `אֲנִי` |
| cartes portant un badge de devinette | **18/19** |
| `אֲנִי`, `כּוֹחַ`, `גַּב` : ligne de lecture | **absente** |
| les mêmes mots passés à `translit.js` en direct | `a-NI`, `KO-ach`, `gav` — corrects, hors réseau |
| « did you mean » déclenché sur un mot **correct** | 2/12 |
| vocabulaire de kita10 couvert par le corpus vérifié | **33 %** (702/2149) |

Le cas qui résume tout : on tape `אֲנִי` avec son niqqud. L'app **jette le niqqud**, envoie les
consonnes nues à Dicta via le Worker, revient sans lecture, et affiche `אֲנִי / I / PHONETIC` sous
un titre qui demande si c'est bien ce qu'on voulait dire. Le module capable de lire ce mot hors
ligne était déjà chargé dans la page.

## 2. La cause de fond était structurelle

`layoutSections()` arbitrait entre deux sections avec **six heuristiques** ajoutées une par une
contre de vrais bugs : « today » commence par « toda », « hier » que Google plaçait en allemand,
la carte parasite du romanisé, et trois autres. Chacune est juste isolément. Ensemble, elles sont
imprévisibles — et c'est exactement ce que « ça embrouille tout » décrit.

Tout passait par le chemin phonétique, y compris une entrée non ambiguë. D'où le badge
`phonetic` sur une simple recherche de mot, et le titre « did you mean? » au-dessus d'une réponse
vérifiée.

## 3. Ce qui a été construit

Un moteur partagé, `C:/dev/projects/ulpan-engine`, vendorisé dans chaque app avec un verrou de
dérive. Quatre étages, on s'arrête au premier qui répond ; la classification de l'entrée est
mécanique, plus arbitrée. Détail : `ulpan-engine/README.md`.

| Mesure | Avant | Après |
|---|---|---|
| appels réseau par requête | 6,4 | 0 pour le vocabulaire couvert |
| couverture hors ligne (occurrences réelles, corpus tenu à l'écart) | 54 % | **67 %** |
| ... sur les 100 mots les plus fréquents | 78 % | **95 %** |
| cartes portant un badge | 18/19 | **0/8** |
| requêtes montrant plus d'une carte à l'écran | — | **0/8** |
| violations CSP, erreurs JS | — | 0, 0 |

Le badge n'apparaît plus que pour l'**exception** : une réponse non vérifiée. Un signe affiché
sur presque tout ne distingue plus rien, et c'est ce que « on ne sait plus à quoi se fier »
voulait dire.

## 4. Trois défauts trouvés en chemin, tous réparés

### Le guéresh cassait le corpus (94 mots)

`tools/build-gloss.mjs` lisait le source des leçons avec une regex `'([^']+)'` qui ne connaît pas
l'échappement. Dans une leçon, le guéresh (ג׳ = j, צ׳ = tch, ז׳ = zh) est une apostrophe **à
l'intérieur** d'une chaîne JavaScript entre apostrophes, donc écrite `\'`. Le motif s'arrêtait
là et gardait le début du mot : `צֶ\` pour « check », `גִּ\` pour « gin », `גְּ\` pour le jachnoun,
`וַה\` pour un verset entier.

Le corpus perdait donc précisément les **emprunts du quotidien**, et les remplaçait par des
fragments qui avaient l'air de mots. Corrigé : 94 clés corrompues → 0, et 100 mots à guéresh
récupérés (29 → 129).

### Le guéresh cassait aussi la lecture (339 mots)

`translit.js` ne connaissait ni le guéresh ni le guershayim : le premier **coupait le mot en
deux** (traité comme une ponctuation) et la lettre était lue à sa valeur ordinaire.

| | avant | après |
|---|---|---|
| `צִ'יפְּס` chips | `tzi'yps` | `chips` |
| `גִ'ינְס` jeans | `gi'yns` | `jins` |
| `זָ'קֶט` jacket | `za'ket` | `ZHA-ket` |
| `סֶנְדְוִיץ'` sandwich | `sen-de-VITZ'` | `sen-de-VICH` |
| `מַמַּ"ד` safe room | `ma-MA"d` | `ma-MAD` |

339 lectures corrigées, **0 dégât collatéral** — vérifié mot à mot sur les 8 306 entrées du
corpus (`ulpan-engine/tools/translit-diff.mjs`), toutes les différences portant le signe traité.
Non-régression : la suite existante reste à 118/118, syllabes et accent tonique 139/139.

Piège de mesure rencontré : la première comparaison signalait trois mots changés sans guéresh
(`אוטובוס`, `מוזיקה`, `טלפון`). C'était l'instrument. `translit.js` charge
`../data/loanwords.json` **relativement à sa propre position**, dans un `try/catch` silencieux :
la copie « avant » était dans un dossier temporaire, donc privée de la liste des emprunts. Une
copie de ce fichier hors de son dossier se comporte différemment, sans rien dire.

### Le hachage qui invalide le cache PWA ne voyait pas les sous-dossiers

`site/data/` est apparu avec le traducteur et le parcours était plat. La correction évidente —
ignorer les dossiers — aurait été la pire : le corpus serait sorti du hachage, un corpus mis à
jour n'aurait plus changé le nom du cache, et un téléphone où l'app est installée aurait servi
l'ancien vocabulaire indéfiniment. C'est la panne du 27.07, dans un nouveau dossier. Rendu
récursif, chemin relatif compris.

## 5. Le Worker

- **`/tr`**, nouvelle route : la traduction part désormais de notre infrastructure. Avant, le
  navigateur appelait `translate.googleapis.com` (« gtx ») — pas une API publique, pas de clé,
  quota non documenté, compté **par IP**. Une classe entière derrière le wifi de l'ulpan sort sur
  une seule IP : le 429 tombait sur tout le monde en même temps. C'est la panne du 25/08.
  Deux moteurs derrière la même route : Google Cloud Translation v2 si `GOOGLE_TRANSLATE_KEY` est
  posée (500 000 caractères/mois gratuits à vie, ~25 000 requêtes), Workers AI sinon.
- **CORS** : `ulpan-etzion.pages.dev` ajouté à une liste explicite d'origines.
- Un invariant que ni l'un ni l'autre upstream ne vérifiait : une traduction **vers** l'hébreu qui
  ne contient aucune lettre hébraïque n'est pas une traduction. Les deux échouent en douceur en
  renvoyant l'entrée, et la carte affichait alors le mot de l'apprenant dans la case du résultat.

**Le Worker n'est pas déployé.** Le code est prêt et vérifié syntaxiquement ; le déploiement est
un acte sortant.

## 6. Ce qui reste ouvert

1. **ulpan-hebrew tourne toujours sur `quicksay.js`.** Le nouveau moteur est en service dans
   kita10 seulement. Migrer ulpan-hebrew coûterait quatre fonctions que `quicksay.js` porte et
   que le nouveau moteur n'a pas : la version naturelle (`/nat`), les formes genrées (`/form`),
   le mot-à-mot, et « enregistrer dans mes phrases ». C'est un arbitrage, pas un oubli.
2. **Le hé mappiq final.** Le moteur lit `שֶׁלָּהּ` « she-LAH » ; la classe écrit « shela », et elle
   a raison **en hébreu moderne**. Mais `translit.js` sert aussi 214 pages de liturgie, où ce hé
   se prononce. Deux réponses correctes selon le registre : arbitrage de Jonas, pas correctif.
3. **Le sheva na.** 400 désaccords subsistent entre le moteur et les lectures manuscrites de la
   classe, très majoritairement de convention : le moteur écrit `mla-MED`, la classe `melamed`.
   Aucun des deux n'est faux. À trancher une fois, pas mot par mot.
4. **`GOOGLE_TRANSLATE_KEY`** n'est pas posée : `/tr` tomberait sur Workers AI. Poser la clé
   demande une action dans la console Google Cloud.
5. **Les lectures manuscrites de kita10 sont un jeu d'évaluation humain** de 3 462 entrées pour le
   moteur de lecture, découvert sans le chercher. 88 % d'accord une fois la mise en forme
   neutralisée. C'est le seul jeu tenu à l'écart dont ce moteur ait jamais disposé.
