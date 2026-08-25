# « Le live translator ne donne même plus la traduction » (25/08/2026)

Ce que dit ce document : ce qui a été mesuré, ce qui a été trouvé, et surtout **ce qui a été
éliminé**, pour qu'aucune session ne repaie les mêmes vérifications.

## L'état du moteur, mesuré avant toute hypothèse

Sept requêtes ordinaires jouées **contre la production** (`tools/repro-2026-08-25.mjs`) :
`hello`, `I want a coffee`, `bonjour`, `je voudrais un café`, `ani rotze kafe`, `ספר`,
`אני רוצה קפה`. Les sept rendent l'hébreu pointé, sa lecture et son sens. **0 erreur JS,
0 requête en échec.** Le moteur, réseau sain, n'a pas régressé.

Les upstreams répondent tous : gtx 200 en 0,4 s, le Worker 200, Input Tools 200.

## Ce qui a été éliminé (ne pas repayer)

| Hypothèse | Mesure | Verdict |
|---|---|---|
| Le moteur a régressé | 7 requêtes contre la prod, toutes correctes | réfutée |
| Un upstream est mort | curl direct sur gtx, Worker, Input Tools : 200 | réfutée |
| gtx rend 429 | injecté (429, page HTML de consentement, JSON vide) : **MyMemory rattrape les 4 requêtes** | réfutée : une source morte ne casse rien |
| MyMemory seul mort | injecté : gtx rattrape tout | réfutée |
| Le Worker seul mort | injecté : traduction et sens intacts, seul le niqqud tombe | réfutée |
| Input Tools mort | injecté : traduction intacte | réfutée |
| Une préférence tue la traduction | `QSPrefs.langs()` ne pilote que les **retries**, `translit()` ne cache que la ligne de lecture | réfutée par lecture du code |
| Hors ligne franc | `ctx.setOffline(true)` : hints explicites, phrases du carnet servies | déjà honnête, rien à corriger |

## Ce qui a été trouvé

**Quand AUCUNE source avant n'est joignable alors que le navigateur se croit en ligne**, la page
mentait de deux façons, mesurées le 25/08 avec gtx + MyMemory refusés :

1. `I want a coffee` rendait trois devinettes phonétiques non glosées : `י וַעֲנָת א צוֹפִי`, Input
   Tools lisant les *lettres latines* de la phrase comme des sons hébreux, **et pas un mot sur
   l'échec**. C'est exactement la forme de « ça ne donne même plus la traduction ».
2. `where is the pharmacy`, qui n'a aucune devinette, recevait
   « Nothing found for … Try rephrasing » : le réseau tombe, et la page accuse la formulation.
   L'apprenant reformule une phrase qui n'a jamais été le problème.

**Cause.** `translateOnline` avalait ses deux échecs dans `.catch(() => null)`. « Aucune source
n'a répondu » et « les sources ont répondu et n'avaient rien » rendaient la même valeur `null`,
donc `render()` ne pouvait pas distinguer une absence d'un réseau mort ; il ne lui restait qu'à
proposer de reformuler.

**`navigator.onLine` ne couvre pas ce cas** et c'est le point important : sur un wifi captif ou
à moitié mort (le cas ordinaire du téléphone), il reste `true` pendant que chaque requête
échoue. Le chemin hors-ligne honnête existait déjà et n'était jamais atteint.

## Le correctif

`translateOnline` rend `{ res, failed }`. `failed` = on n'a rien produit **et** au moins une
source a levé (ou l'étape a expiré) ; une source qui répond sans hébreu est une absence, pas un
échec. `render()` en tire deux formulations, parce que deux choses différentes peuvent être à
l'écran :

- rien de vérifié : « The translation could not be fetched — check the connection and try again. »
  suivi, s'il y a des devinettes, de « What follows is guesswork from the spelling. »
- une phrase curée a répondu : « Showing saved phrases only — the translation sources could not be
  reached. » — l'appeler « guesswork » serait le miroir du bug qu'on corrige.

Le bouton « ✦ natural version » n'est plus proposé dans ce cas : il tape le même réseau.

## Le trou d'entrée, bouché

Le banc dégradé du 24/08 **ne posait que des requêtes hébraïques**. Le chemin pour lequel l'app
existe, « traduis-moi ça », n'avait jamais tourné avec un upstream coupé. Deux ajouts :

- trois requêtes non hébraïques dans `WORDS`, et un cas `no forward source (gtx + mymemory refused)`
- la règle **D4** : une requête non hébraïque dont la traduction a échoué doit le dire ; elle
  rougit sur les deux formes réelles (devinettes muettes, formulation accusée), fixtures
  enregistrées avant/après.

Piège attrapé en chemin : **D2 n'était pas gardée sur `heQuery`**. Sur les nouvelles requêtes
non hébraïques elle a rendu 13 faux défauts, qui auraient enterré le seul vrai. Une règle écrite
quand tout le corpus était hébreu suppose l'hébreu sans le dire.

## Ce qui reste ouvert

**Ce correctif n'est pas prouvé être la panne de Jonas.** Il corrige une panne qui produit
exactement le symptôme décrit, et il rend le moteur capable de dire ce qui lui arrive, ce qui,
la prochaine fois, remplacera une enquête par une capture d'écran lisible. La question qui
trancherait : **est-ce que l'écran disait quelque chose (un message), ou est-ce qu'il n'y avait
rien du tout ?** et **est-ce que ça arrive sur le téléphone, sur le fixe, ou les deux ?**

La piste de fond du 23/08 reste la vraie : rien à l'écran ne distingue une réponse **vérifiée**
d'une **devinette**. Les trois badges (`✓ lesson`, `online`, `phonetic`) font 10 px, même forme,
même bleu. Trois pistes chiffrées en fin de `translator-reliability-2026-08-23.md`.

---

# Deuxième passe : « en fonction de l'input »

Jonas a précisé : la carte hébreu s'affiche, c'est **la ligne du sens** qui ne donne rien, et
c'est vrai sur les trois appareils. Un défaut indépendant de l'appareil ne dépend pas du réseau,
donc il devait se voir en sonde. Il s'y voyait, il n'était pas cherché.

## Mesure

130 entrées mêlées (60 mots hébreux tirés au hasard des 465 leçons, 40 romanisées, 15 françaises,
15 anglaises) jouées contre la production, 231 cartes :

| Constat | n |
|---|---|
| sens vide | 4 (dont 3 sans un mot d'explication) |
| **sens qui répète l'entrée de l'apprenant** | **33** |
| sens en anglais pour un francophone | toutes les autres |

Sur chaque requête française et anglaise, la ligne censée porter le sens rendait les mots que
l'apprenant venait de taper. Sur un mot hébreu, elle rendait de l'anglais. Un francophone n'avait
donc, dans la case prévue pour ça, jamais rien qu'il ait demandé.

## Cause

Deux choses, et la seconde est la plus bête.

1. `CFG.glossLang` était la constante `'en'`. La langue du sens ne suivait rien.
2. Le carnet porte un champ `fr` sur ses **118 lignes** depuis le 18/08, et il ne servait **qu'à
   chercher** : on tapait « où », on matchait sur le champ français, on se faisait répondre en
   anglais. La traduction vérifiée était sur le disque, dans la bonne langue, et l'affichage ne
   la regardait pas.

Et une troisième, trouvée en écrivant le contrôle : `reverseOffline()` matche sur la
**romanisation**, donc taper שלום en lettres hébraïques n'atteignait jamais sa fiche curée. On
demandait à Google, qui rendait « paix ».

## Correctif

- `meaningLang(src)` : la langue de la requête si Google la place (fr, es, ru, en), sinon celle du
  navigateur, sinon l'anglais. Calculée une fois par écran, donc toutes les cartes d'un même
  résultat parlent la même langue.
- `glossOf(row, lang)` : la fiche curée rend son champ dans cette langue, l'anglais en repli (un
  sens dans la mauvaise langue vaut mieux qu'une ligne vide).
- `fetchGloss(he, signal, lang)` : la glose en ligne suit la même langue.
- `forwardByHebrew(q)` : un mot tapé **en hébreu** atteint sa fiche curée, par les consonnes nues,
  avec ou sans niqqud.
- Le **mot par mot reste en anglais**, exprès : sa source vérifiée (`data/gloss.json`, 6 871 mots)
  l'est, et un tableau qui mélange deux langues se lit comme un bug.

## Ce que ça coûte, mesuré

La glose française de Google est moins bonne que l'anglaise : **33/45 contre 37/45** sur les
lignes curées du carnet (référence : leur champ `fr` écrit à la main, un synonyme suffit). Les
vraies erreurs françaises sont `מי` → « OMS », `כמה` → « quelques », `לא` → « pas ». C'est accepté :
les 118 phrases du carnet passent maintenant par le français **vérifié** et ne touchent plus
Google du tout ; l'écart ne porte que sur les mots hors corpus.

Piège de mesure au passage : la première métrique donnait 26/45 en comparant à la liste entière
de synonymes, donc « paix » comptait comme un échec face à « bonjour / salut / paix ». Elle
mesurait la richesse de la référence, pas la justesse de la réponse.

Et un piège d'outil : `gtx` rend une **page HTML** à un `fetch` Node nu (il refuse les clients
non-navigateur), ce qui a donné un franc `0/0` avant d'être vu. Toute mesure de gloss doit tourner
dans la page.

## Le contrôle

`tools/meaning-lang-check.mjs`, 8 assertions dans les deux locales. Ses attentes sont **lues dans
`data/phrasebook.json` au moment du run**, jamais recopiées. Il était rouge avant le correctif,
sur le vrai défaut : 3/6, שלום rendant « paix » en français et « peace » en anglais.
