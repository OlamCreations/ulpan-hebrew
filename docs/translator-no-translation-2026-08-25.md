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
