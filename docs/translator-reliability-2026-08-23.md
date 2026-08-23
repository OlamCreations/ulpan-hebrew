# Traducteur live : ce que les trois captures du 23/08 disaient vraiment

**Signalé** : « le live translator débloque, n'est plus fiable », avec trois captures
(08:09, 08:47, 09:01).

## Le point de départ, qui a orienté tout le reste

Les trois requêtes exactes ont été rejouées, **en local puis sur github.io là où Jonas est**.
Les deux rendent la même chose, et c'est correct :

| Requête | Rendu aujourd'hui, local et prod |
|---|---|
| `hard` | `קָשֶׁה` · `ka-SHE` · "hard" — **un** mot |
| `אחרי` | `אַחֲרֵי` · `a-cha-REI` · "after" — vocalisé |
| le collage WhatsApp | traduction juste, aucune navigation parasite |

Zéro erreur JS. La prod sert `ulpan-v98` et le `quicksay.js` courant. **Le moteur n'a pas
régressé** : l'écart est entre le code et ce qui tournait sur le téléphone.

## Hypothèses testées, et ce que chacune élimine

Aucune n'a été retenue au flair : chacune a été mesurée, y compris celles qui sont tombées.

| Hypothèse | Verdict | Ce qui le montre |
|---|---|---|
| Les langues sources actives changent la lecture de « hard » | **réfutée** | 7 configurations de `qs-src-langs` (défaut, en, fr, ru, es, fr+ru, toutes) rendent toutes `קָשֶׁה`, un mot |
| `זריקה` vient d'une entrée curée du corpus | **réfutée** | absent des 118 phrases, 129 expressions et 6 857 gloses |
| Google varie sa réponse pour « hard » | **réfutée aujourd'hui** | 10 exécutions, 10 fois `קָשֶׁה` |
| La cursive supprime le niqqud de l'hébreu principal | **réfutée** | cursive ON garde `אַחֲרֵי` vocalisé ; seule la ligne d'écho est nue |
| `qs-niqqud = off` produit l'hébreu nu de la capture 2 | **CONFIRMÉE** | niqqud OFF rend exactement `אחרי` + `a-cha-REI` correct |
| Le Worker injoignable explique la capture 2 | **partielle** | il produit bien l'hébreu nu, mais dégrade aussi la lecture (`achari`), or Jonas avait `a-cha-REI` juste |
| Un jeton étranger empoisonne la lecture de la carte | **réfutée** | latin, `@`, `~`, emoji, `✦`, `▾`, chiffres, point collé : 100 % de lectures vérifiées ; seule une URL descend à 88 % |
| L'espace insécable de WhatsApp ressort en « Â » | **réfutée** | aucun `Â` produit |
| Un remplissage asynchrone écrit dans la carte d'une autre requête | **réfutée** | `wireGnp` écrit dans une référence capturée ; si la carte a été remplacée, l'élément est détaché et l'écriture ne va nulle part |

## Deux défauts réels, mesurés et corrigés

### 1. Le dernier lookbehind du site, dans un module chargé partout

`quicksay.js:1252` portait `/(?<![.!?])\.$/`. La règle « pas de lookbehind » avait été appliquée
à `app.js` le 20/08 et **ce fichier avait été oublié** : c'était le seul survivant des six
fichiers livrés. Sur Safari < 16.4 ce n'est pas un bug de comportement, c'est une **erreur de
parse** : le fichier entier meurt, donc plus de traducteur du tout.

Remplacé par un test en deux temps, sans lookbehind. Équivalence vérifiée sur 16 cas contre la
version d'origine, y compris le point isolé, plus une cassure injectée qui exige qu'une version
naïve (« enlever tout point final ») diverge.

C'est la même classe d'erreur qu'un correctif appliqué à un document et pas à son jumeau.

### 2. Le plafond de longueur était contournable

`maxlength="200"` sur l'input tient pour un collage clavier (mesuré : 203 → 200), mais **pas
pour une écriture par programme** — le chemin des chips fait `input.value = …` et passe à 203
sans être coupé. Une entrée de 200 caractères rend une carte de **515 px et 30 mots hébreux**,
illisible, et fait payer au Worker une phrase que personne n'apprend d'un coup.

Le plafond vit désormais dans `render()`, le seul entonnoir que toutes les voies traversent, et
il **le dit** au lieu de tronquer en silence. Vérifié : 200 passe, 201 est refusé avec un
message.

## La cause de fond, et c'est une décision de Jonas

Les trois badges de provenance font **10 px, même forme, même famille de bleu** :

| Badge | Ce que ça vaut réellement |
|---|---|
| `✓ lesson` | vérifié à la main, niqqud relu |
| `online` | une devinette de Google, jamais relue |
| `phonetic` | une correspondance approchée |

Sur un téléphone, dans un coin, en capitales de 10 px, **une devinette machine et une phrase
vérifiée ont la même autorité visuelle**. Quelle que soit la réponse que Google a servie à
Jonas à 09:01, rien sur la carte ne lui disait qu'elle n'avait été relue par personne.

C'est exactement ce que dit « n'est plus fiable » : le problème n'est pas que le moteur se
trompe parfois (un traducteur automatique se trompe). Le problème est qu'**on ne peut pas voir
lesquelles de ses réponses sont fiables.**

Trois pistes, par coût croissant, à trancher par Jonas (changement visuel = son domaine) :
1. Marquer les lectures **non vérifiées** mot par mot. Mesuré : au-delà de 14 mots, 6 à 14 % des
   mots portent une romanisation qui n'est pas passée par le moteur vérifié (`saliha` au lieu de
   `sli-CHA`), sans aucune marque.
2. Donner au badge `online` un poids visuel de mise en garde, pas de simple étiquette.
3. Sur une requête d'**un** mot qui rend une réponse de plusieurs mots, afficher aussi la lecture
   du mot seul. C'est le cas exact de la capture 1.

## Ce qui reste inexpliqué, et pourquoi je n'invente pas

Deux choses des captures ne se reproduisent sur aucune configuration testée, ni en local ni en
prod : `hard` → `זריקה קשה`, et le champ sens contenant de l'hébreu sous le titre TRANSLATION.

Les deux cartes portent le badge ONLINE, donc les deux réponses viennent de Google. Google est
un service distant, versionné, dont la réponse d'un jour n'est pas récupérable le lendemain.
Après avoir éliminé les préférences, le corpus, l'état du Worker et la variance mesurable
d'aujourd'hui, **je ne sais pas ce qu'il a renvoyé à 09:01, et je préfère l'écrire que le
combler**.

Une information réglerait la capture 1 : y avait-il une requête précédente dans le champ ? Les
résultats ne se vident pas quand on retape, et l'ancienne carte reste à l'écran le temps du
debounce et du réseau.

## Non-régression après les deux correctifs

| Contrôle | Résultat |
|---|---|
| `normalize-cap-test.mjs` (neuf) | 20/20, cassure injectée comprise |
| `translator-units.mjs` | 127/127 |
| `translator-probe.mjs --break` | 107 capturées, 0 vide, 0 non-settled |
| `translator-invariants.mjs --compare` | **0 violation sur 205 cartes, 0 nouvelle contre la référence** |
| `translit-test.cjs` | 118/118, hors-convention 0/118 |
| `smoke.mjs` | tout vert |
| `translator-metamorphic.mjs` | 1/36 puis **0/36** au rejeu |

`SHARED_V` bumpé, SW `ulpan-v98 → v99`, 1 229 entrées précachées.

**Le M5 instable est le même phénomène que la capture 08:47.** Il casse quand le moteur n'arrive
pas à repointer sa propre réponse : « a répondu `מָחָר`, mais repointer ses consonnes a rendu
`מחר` ». C'est un appel Worker qui n'a pas abouti, et le symptôme est exactement l'hébreu nu que
Jonas a vu. La clôture du 20/08 notait déjà cette instabilité comme du bruit réseau non
expliqué ; elle a maintenant un nom et un mécanisme.

## Sondes laissées dans `tools/`

Réutilisables, chacune porte son protocole en tête : `repro-2026-08-23.mjs` (les trois requêtes,
local ou prod), `repro-degraded-2026-08-23.mjs` (Worker coupé / lent), `investigate-2026-08-23.mjs`
(langues, niqqud/cursive, plafond, NBSP), `mixed-script-2026-08-23.mjs` (contaminants),
`translit-degradation-2026-08-23.mjs` (lecture vérifiée selon la longueur),
`normalize-cap-test.mjs` (les deux correctifs + leurs cassures injectées).
