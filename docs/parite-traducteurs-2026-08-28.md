# Deux traducteurs, une seule barre

**2026-08-28.** ulpan-hebrew et kita10 gardent chacun son code : 2040 lignes ici,
987 dans `ulpan-engine`. Ils ne partagent pas de moteur, et c'est un choix, pas
un retard — la migration détruirait au passage les sondes soudées aux entrailles
de `QuickSay` (`_normalizeQuery`, `_weldProclitics`, `_phoneticQuery`,
`_hasExactForward`…), c'est-à-dire le filet, exactement au moment où il sert.

Ce qu'ils partagent, c'est **la barre**. `tools/parity-2026-08-28.mjs` pose les
mêmes questions aux deux surfaces et vérifie sur chacune les mêmes invariants.
Il ne compare pas les sorties : les corpus diffèrent, et une comparaison octet à
octet rougirait sur du travail correct, donc finirait désactivée.

## Les invariants

| | ce qui doit tenir |
|---|---|
| P1 | une question qui a une réponse en rend une |
| P2 | une seule carte visible, les autres dans un repli |
| P3 | un repli existe si et seulement s'il a quelque chose dedans |
| P4 | le sens ne répète jamais la question |
| P5 | une carte hébraïque porte une lecture |
| P6 | aucun titre de groupe au-dessus d'un élément unique |
| P7 | **croisé** : si une surface répond vérifié, l'autre ne répond pas par une devinette |
| P8 | une question de N mots n'est pas résolue par une réponse de plus de N+1 mots |

P7 est le seul qui ait besoin des deux à la fois. Aucune sonde interne à un
dépôt ne peut le voir : il faut la question posée aux deux pour savoir que l'une
devinait là où l'autre savait. C'est lui qui a trouvé le trou de corpus sur
`todah`.

## Ce que la première exécution a trouvé

Cinq violations réelles, **des deux côtés** — ce qui répond à la question de
savoir lequel des deux était en retard : aucun, ils avaient dérivé chacun de son
côté.

**ulpan-hebrew**

1. *P6* — « Translation » coiffait seul la carte de `bureau`. Le repli, écrit la
   veille, ne s'appliquait qu'à partir de deux cartes : le défaut réparé pour les
   réponses multiples restait entier pour la plus fréquente, la réponse unique.
2. *P7* — `bureau` partait en ligne quand kita10 répondait depuis son corpus.

Le second cachait beaucoup plus gros. Le corpus tient **7136 mots vérifiés** et
la recherche hébreu → sens les voit tous ; la recherche sens → hébreu ne
consultait que le phrasebook, **118 lignes**. **2339 mots anglais** étaient donc
sur le disque, vérifiés, et partaient quand même demander une réponse en ligne.

Mesuré sur 20 mots pris à pas fixe (`tools/reverse-coverage-2026-08-28.mjs`) :

| | avant | après |
|---|---|---|
| répondu hors ligne, vérifié | 0/20 | **20/20** |
| parti en ligne | 20/20 | **0/20** |
| hébreu présent dans le corpus | 13/20 | **20/20** |

Ce n'étaient pas seulement des appels réseau inutiles. Sept réponses sur vingt
rendaient un **autre mot** que celui du corpus : `drill` → לִקְדוֹחַ, le verbe
percer, quand la classe a donné מַקְדֵּחָה, la perceuse ; `attack` rendait un verbe
pour un nom ; `manhole` un mot sans rapport. L'apprenant révisait un mot qu'on ne
lui avait pas enseigné.

Deux correctifs, à deux étages, et le second compte autant que le premier :
l'index inverse (`glossReverse`), puis son **classement** — sans
`hasExactForward` étendu au corpus des leçons, l'index trouvait les 2339 mots et
la mise en page les rangeait quand même sous la réponse en ligne, repliés. Un
index qui trouve et dont la trouvaille est reléguée est indiscernable, à l'écran,
d'un index qui ne trouve rien.

**kita10 / ulpan-engine**

3. *P8* — `thank you` rendait « תּוֹדָה מוֹרָה », puis avant cela une phrase de six
   mots. Cause : l'index découpait les gloses sur la virgule pour servir les
   synonymes (« office, bureau »), et découpait donc aussi les propositions d'une
   phrase. « No problem. You waited 3 hours, thank you » recevait la clé exacte
   `thank you`. La règle est maintenant adossée à la forme de l'entrée : la
   virgule ne sépare des synonymes que dans la glose d'un mot **unique**.
4. *P7* — `todah` ne trouvait rien et revenait avec כְּבָר, « déjà ». La clé de
   romanisation était exacte, or le ה final est muet : `toda` et `todah` sont le
   même mot. Nouvelle clé tolérante `romKey` (ה final, kh/ch, tz/ts, consonne
   doublée), dans un compartiment **séparé** consulté en dernier — une tolérance
   orthographique ne doit jamais devancer une correspondance exacte.
5. *P4* — `thank you` → תּוֹדָה affichait « thank you » comme sens. Règle
   d'ulpan-hebrew, mise en miroir dans le moteur.

## Le portage du phonétique (même jour)

`kacha kacha` est de l'hébreu écrit en lettres latines. Aucune clé du corpus ne
l'atteint, donc kita10 tombait sur le traducteur, qui le lisait comme du
français et rendait הֲכִי הַרְבֵּה הֲכִי הַרְבֵּה : quatre mots faux pour une question
de deux.

Ce qui manquait au moteur, c'est le seul service qui sache rendre le **son** en
lettres hébraïques (Input Tools). Il est maintenant porté — mais pas recopié.

|  | ulpan-hebrew (avant) | moteur (porté) |
|---|---|---|
| candidats affichés | tous, badgés « phonetic » | **seulement ceux que le corpus confirme** |
| rang | celui du service | le confirmé passe devant |
| ce que coûte un candidat non confirmé | pointage + glose (2 appels) | rien, il n'est pas montré |

La règle qui rend l'appel utile n'est pas « on interroge le service », c'est **un
candidat confirmé par le corpus n'est plus une devinette** : c'est une entrée
vérifiée atteinte par une autre porte, et elle hérite du rang du corpus. C'est la
hiérarchie que le moteur tient déjà partout — le vérifié bat le réseau — et non
une exception écrite pour ce cas.

Deux mutations de la matrice de cassures gardent les deux moitiés séparément :
débrancher l'étage, et laisser passer un candidat **non** confirmé. Sans la
seconde, l'assertion ne prouverait que « l'appel part ».

### Et le retour dans l'autre sens

Une fois kita10 réparé, la barre a signalé ulpan-hebrew : il rendait כָּךְ כָּךְ
sous le badge `phonetic`, alors que son propre corpus tenait כָּכָה כָּכָה avec son
sens relu — classé deuxième par le service, donc affiché en second sous une
étiquette de devinette. **La page tenait la bonne réponse et menait avec
l'autre.** Trois corrections en miroir :

1. le corpus des **phrases** est consulté, pas seulement celui des mots
   (כָּךְ כָּךְ fait deux mots, `verifiedGloss` n'en connaît qu'un) ;
2. le candidat confirmé passe devant, par un tri **stable** — entre deux
   candidats de même statut, l'ordre du service est conservé, car lui seul sait
   lequel ressemble le plus à ce qui a été tapé ;
3. il porte son propre badge, « ✓ lesson · by sound » : ni « phonetic », qui
   ferait douter d'un mot enseigné, ni « ✓ lesson » nu, qui cacherait que l'app a
   interprété une orthographe.

**Résultat : 0 violation des deux côtés, sur les dix questions.**

## Le contrôle qui manquait

`latKey` et `romKey` sont écrits en double — une fois dans le constructeur d'index
(module Node), une fois dans le moteur (script de navigateur sans imports). Si une
règle diverge d'un caractère, les clés de l'index ne sont plus celles que la
recherche calcule et **le corpus a l'air vide** : aucune erreur, aucune trace.

Un commentaire du moteur annonçait un contrôle de parité de clés depuis le début.
**Le fichier n'existait pas.** Il existe maintenant
(`tools/key-parity-check.mjs`, dans `npm test`), il compare ce que les deux
implémentations RENDENT sur 43 entrées plutôt que leur texte source, et il porte
son propre contrôle négatif.

## Lancer la barre

```bash
cd projects/ulpan-hebrew
node tools/serve.mjs 8912                     # dans un autre shell, pour les units
node tools/parity-2026-08-28.mjs              # les deux surfaces
node tools/reverse-coverage-2026-08-28.mjs 20 # couverture inverse d'ulpan-hebrew
node tools/revidx-check-2026-08-28.mjs        # l'index inverse trouve-t-il, et est-il montré
```

La barre sert les deux dépôts depuis celui-ci parce qu'elle a besoin des deux
sites construits. `K10=<chemin>` pointe ailleurs que `../ulpan-etzion/site`.

**Piège, rencontré le jour même :** `collapse-check` vise la **production** par
défaut. Lancé sans `BASE=http://localhost:8912`, il rend un vert qui décrit le
site en ligne et pas le travail en cours.
