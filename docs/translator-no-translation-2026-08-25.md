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

---

# Troisième passe : la vraie cause, Google répond 429

En construisant la batterie d'exemples, presque tous les sens sont revenus vides. Vérifié avant
de conclure quoi que ce soit :

```
curl gtx  ->  HTTP 429, corps HTML, 1103 octets
```

**Google limite cette connexion.** Je l'ai saturée moi-même avec les tests de la journée, mais
c'est aussi la panne de Jonas, et tout colle :

| Ce qu'il décrit | Ce que fait un 429 |
|---|---|
| la carte hébreu s'affiche | Input Tools est un autre hôte, il répond |
| le champ du sens est vide | la glose ne venait QUE de gtx, sans aucun repli |
| la traduction avant marche parfois | MyMemory est derrière elle, la glose n'avait rien |
| sur les trois appareils | le quota est par **connexion**, pas par appareil |
| pas reproductible à la demande | ça va et vient avec la fenêtre de quota |

`gtx` n'est pas une API publique : ni clé, ni quota documenté, ni palier. C'est le même genre
d'emprunt que Dicta l'était (cf. la note du 24/07 : « un endpoint interne non documenté n'est pas
une API »). Et l'app en tire **plusieurs appels par écran rendu** : la traduction avant, un retry
par langue activée, puis une glose par candidat phonétique, jusqu'à trois. Quelques dizaines de
requêtes en une session d'apprentissage.

## Correctif

La glose de carte monte maintenant l'échelle que le mot-à-mot montait déjà, et qui n'avait
jamais servi pour une carte :

1. **`data/gloss.json`** — 6 871 mots vocalisés vérifiés, sur disque, gratuits. Clé = la forme
   **pleinement vocalisée**, jamais le squelette consonantique : ce squelette EST l'ambiguïté que
   ce corpus existe pour lever (un jour il a répondu « in shock » pour בשוק, au marché).
2. **Google**, dans la langue de l'apprenant.
3. **Le vérifié en repli** quand Google tombe, plutôt que rien.

Conséquence mesurée sous 429 injecté : `ספר` → « book », `שולחן` → « desk », `מקרר` → « fridge »,
**avec zéro appel à Google**. Une session anglaise n'appelle plus Google du tout pour un mot
couvert, ce qui réduit aussi le volume qui déclenche le 429.

Et un 429 se dit maintenant pour ce qu'il est : « the translation service is rate-limiting this
connection », pas « check the connection » — qui envoyait regarder un wifi qui fonctionne.

## Le contrôle

`tools/ratelimit-check.mjs`, 8 assertions, 429 injecté (corps **HTML**, comme le vrai : servir du
JSON testerait une panne que Google ne produit pas). Matrice de cassures faite : neutraliser
`verifiedGloss` fait tomber R1, 5/8.

## Ce qui reste à mesurer

La batterie d'exactitude (`translator-battery.mjs`) demande que gtx ne soit **pas** en 429, sinon
elle mesure le quota et pas le moteur. Dernier relevé valide, avant que la limite tombe :

| pool | chemin | score |
|---|---|---|
| in-sample (carnet) | en2he / fr2he / rom2he / he2mean | 100 % chacun — et ça ne prouve rien, le moteur se cite |
| **held-out** (129 expressions, non chargées) | rom2he | **84 %** |
| **held-out** | he2mean | **68 %** |

Le held-out est le seul chiffre à regarder. À rejouer quand le quota est retombé.

## Défaut de données trouvé au passage

`data/expressions.json` porte un champ nommé **`fr`** sur ses 129 lignes et **pas une n'est en
français** : « cool / OK / awesome », « broken heart ». La page `reference/expressions.html`
l'affiche tel quel dans `.xp-fr`. Un francophone y lit donc de l'anglais dans un champ qui promet
du français. Corriger, c'est traduire 129 idiomes : contenu, donc décision de Jonas.

---

# « Y a du monde qui utilise l'app ? » — ce que dit la télémétrie, et ce qu'elle ne dit pas

## D'abord : le quota est par CONNEXION, pas global

Vérifié dans le code, pas supposé. Les quatre appels externes du traducteur partent tous du
navigateur du visiteur (`assets/quicksay.js` lignes 486, 512, 683, 701) : gtx, MyMemory, Input
Tools. Aucun ne passe par le Worker. C'est donc **l'IP de chaque utilisateur** que Google compte.
Mes tests n'ont dégradé personne d'autre.

**Mais la conséquence à l'ulpan est réelle** : plusieurs personnes derrière un même wifi sortent
sur une seule IP. Une classe qui utilise l'app en même temps partage donc un seul quota Google et
peut le faire tomber ensemble. C'est le cas d'usage le plus probable de cette app, et l'échelle
de glose ajoutée aujourd'hui est ce qui le rend supportable : un mot couvert par les 6 871 mots
vérifiés ne coûte plus aucune requête.

## Ensuite : les chiffres bruts ne valent rien tels quels

30 jours, hors trafic tagué `owner` : **1 474 événements, 147 « devices »**, dont 1 485 en Israël.

Sauf que **143 de ces 147 sont des navigateurs sans tête**. Chaque contexte Playwright démarre
avec un localStorage vide, donc chaque run de sonde forge un nouvel `ulpan-aid` et le rapport le
compte comme une personne de plus. Les pics tombent exactement sur les jours de travail sur ce
dépôt (16, 17, 18, 20, 23, 25 août) et `breakdown_used` fait 1 092 événements sur 21 « devices »,
ce qui est la signature d'une sonde, pas d'un apprenant.

Le tag `owner` ne pouvait pas les attraper : il vit dans le même localStorage que le harnais
efface à chaque run.

## Le seul signal honnête : le mobile

Mes sondes envoient un User-Agent desktop. En filtrant sur `device = mobile` :

| | |
|---|---|
| appareils distincts sur 30 jours | **4** |
| usage typique | **1 appareil par jour**, 1 à 17 événements |
| événements mobiles au total | 128 sur 1 474 |

C'est petit, c'est régulier, et c'est probablement surtout Jonas. **Aucune preuve, à ce jour,
d'un usage tiers significatif.** Ce n'est pas un verdict sur l'app : c'est le constat que la
télémétrie ne pouvait pas répondre à la question tant qu'elle comptait le harnais.

## Correctif

`assets/track.js` coupe la télémétrie quand `navigator.webdriver === true`. C'est le seul témoin
que le harnais ne peut pas ne pas porter (le drapeau `owner`, lui, vit dans le localStorage que
le harnais efface). Vérifié : sous Playwright, `off = true` et zéro balise part.

Les 30 derniers jours restent pollués et le resteront ; les chiffres redeviennent lisibles à
partir d'aujourd'hui.

Piège de mesure au passage, à ne pas refaire : ma première vérification comptait « 1 requête
/track partie quand même ». C'était le **script** `assets/track.js`, attrapé par un filtre
`url().includes('/track')`. Vérifier la méthode et le type de ressource avant de croire qu'une
balise est partie.

---

# Capacité : et si 10 personnes utilisent l'app en même temps ?

À l'ulpan elles sont derrière **un seul wifi, donc une seule IP**, et tous les quotas en jeu se
comptent par IP. La question est donc arithmétique. Il manquait le chiffre qui permet de la
poser : le coût unitaire d'une requête. Mesuré (`tools/upstream-cost.mjs`, cache vidé, service
worker bloqué) :

| saisie | gtx | Input Tools | MyMemory | notre Worker | total |
|---|---|---|---|---|---|
| mot hébreu couvert par le corpus | 1 | 0 | 0 | 2 | **3** |
| mot hébreu hors corpus | 1 | 0 | 0 | 2 | **3** |
| phrase hébreu déjà dans le carnet | 0 | 0 | 0 | 0 | **0** |
| romanisé | 4 | 1 | 0 | 4 | **9** |
| **français, un mot** | **6** | 1 | 0 | 5 | **12** |
| français, une phrase | 4 | 1 | 0 | 4 | **9** |
| anglais, une phrase | 4 | 1 | 0 | 4 | **9** |

Moyenne **6,4 appels externes par requête**. Dix personnes cherchant trois mots par minute :
**≈ 193 appels/minute depuis une seule IP.**

## Ce qui casse en premier — et ce n'est pas Google

**C'est notre propre limiteur.** `worker/src/index.js` limite à **100 requêtes / 60 s par IP**
(`env.RL.limit({ key: ip })`), et les chemins IA à **12 / 60 s**. À 3,9 appels Worker par requête,
dix personnes à trois mots par minute font **≈ 117 appels Worker/minute** : la classe est coupée
par notre propre garde avant même que Google s'en aperçoive. Le limiteur a été écrit contre
l'abus scripté, et il traite un NAT partagé comme un attaquant.

Ordre de rupture prévu, à dix utilisateurs :

1. **notre Worker** (100/60s/IP) → niqqud et mot-à-mot tombent
2. **`/nat` et `/form`** (12/60s/IP) → indisponibles dès la deuxième personne qui les touche
3. **gtx** → 429, quota non documenté (mesuré atteint aujourd'hui, retombé depuis)
4. MyMemory et Input Tools : non mesurés sous charge, à ne pas supposer

## Le levier, dans l'ordre du rapport qualité/effort

1. **Ne pas appeler.** Un mot hébreu couvert par les 6 871 mots vérifiés coûte déjà 0 appel de
   glose depuis aujourd'hui. Le vocabulaire des 465 leçons fait ~15 000 mots : étendre
   `data/gloss.json` déplace la majorité des recherches hors réseau, définitivement et gratuitement.
2. **Les 3 retries de langue.** Un mot français coûte 6 appels gtx parce que `addLangAlts` demande
   fr + es + ru en plus de la détection. Par défaut, seules la langue du navigateur et l'anglais
   suffisent : 6 → 3, soit -25 % du trafic total sans rien perdre pour un francophone.
3. **Re-keyer notre limiteur.** L'identifiant anonyme (`ulpan-aid`) distingue dix personnes
   derrière une IP là où l'IP les confond. Garder une borne par IP, plus large, contre l'abus.
4. **Cache partagé côté Worker.** Il existe déjà (7 jours) : la deuxième personne qui cherche le
   même mot ne paie pas. Il ne protège pas du limiteur, qui compte avant le cache.

## Le piège à ne pas prendre

**Ne pas déplacer les appels Google vers le Worker** pour « sortir du quota de la classe ». Les
Workers Cloudflare sortent d'un pool d'IP partagé par toute la plateforme, et c'est exactement ce
qui a tué l'intégration Dicta (note du 24/07 : requête identique, 200 depuis un navigateur, 503
depuis le Worker, blocage par IP côté Dicta). Un endpoint non documenté bloque le trafic
datacenter avant tout le reste : on échangerait un quota qui se recharge contre un blocage qui ne
se recharge pas.

La sortie durable n'est pas de mieux emprunter, c'est d'avoir moins besoin d'emprunter.

---

# Les trois leviers, appliqués — avec deux corrections de ma part

## Avant / après, mesuré des deux côtés

La production tournant encore l'ancien code, le « avant » n'est pas une estimation : c'est la même
table jouée contre `github.io`, une page neuve par cas.

| saisie | avant (prod) | après (local) |
|---|---|---|
| mot hébreu couvert par le corpus | 3 | 3 |
| mot hébreu hors corpus | 3 | 3 |
| **phrase hébreu (carnet)** | 2 | **0** |
| phrase hébreu (leçon) | 2 | 2 |
| romanisé | 9 | 9 |
| **français, un mot** | 12 | **10** |
| français, une phrase | 9 | 9 |
| anglais, une phrase | 9 | 9 |
| **moyenne** | **6,1** | **5,6** |

## Correction n°1 : le levier 1 n'était pas un levier de capacité

J'avais annoncé que l'index de phrases vérifiées ferait tomber une phrase de leçon de 9 à 2
appels. **Faux** : je n'avais jamais mesuré le « avant ». Une phrase hébraïque coûtait déjà 2
appels en production, parce qu'une requête tout-hébreu saute le chemin avant. Les 13 029 phrases
apportent la **justesse** — niqqud vérifié, sens vérifié, badge ✓ lesson au lieu d'une glose
Google — et non de la capacité. Le gain global est de **−8 %**, pas les −25 % annoncés.

Le vrai poste, ce sont les saisies **latines** à 9-10 appels : 4 gtx + 1 Input Tools + 4 Worker,
dont l'essentiel part en glose et vocalisation des **trois** candidats phonétiques (`CFG.enrichTop`).
Descendre à deux candidats économiserait environ 2 appels par saisie latine. C'est un changement
visible pour l'apprenant (une carte de moins), donc une décision de Jonas.

## Correction n°2 : le levier 2 a un coût, et le contrôle l'a attrapé

Réduire les langues de retry (les quatre → celle du navigateur + l'anglais) fait tomber un mot
français de 6 à 4 appels gtx. Mais sans le retry `sl=fr`, Google classe parfois « bonjour » comme
de l'anglais, et le sauvetage d'homographe que documente `addLangAlts` (pain, chat, main, coin)
ne se déclenche plus. `meaning-lang-check` est passé à 7/8 en session anglaise.

Pour l'apprenant visé — navigateur français — **rien ne change** : le français reste actif, le
retry aussi. Le coût ne tombe que sur une session anglaise où l'on tape du français, et les autres
langues sont à un clic dans Préférences. L'assertion a été réécrite pour dire exactement cela,
avec le pourquoi, plutôt que supprimée.

## Levier 3 : découverte plus grave que le levier lui-même

Le re-keying est fait (seau par appareil `ip|aid`, l'identifiant anonyme voyage en `?d=` et non en
en-tête, pour ne pas déclencher un préflight OPTIONS sur chaque appel) et le Worker est déployé.

**Mais le limiteur n'a jamais rien limité.** Mesuré :

| test | résultat |
|---|---|
| 140 appels en rafale, même identifiant (limite 100/60 s) | 140 × 200 |
| 20 appels `/gloss`, chemin IA (limite 12/60 s, fail-closed) | 20 × 200 |
| **limite abaissée à 5/60 s, 12 appels** | **12 × 200** |

Un endpoint de diagnostic temporaire a confirmé que `env.RL`, `RL_DEV`, `RL_AI`, `RL_AI_DEV` sont
tous présents et que `limit` est bien une fonction : l'appel répond donc « autorisé » malgré le
dépassement. `wrangler 4.33.1` transmet `[[unsafe.bindings]]` en « Unsafe Metadata » sans le
valider, et la clé moderne `[[ratelimits]]` est **ignorée en silence** (les bindings disparaissent
du déploiement). Le diagnostic a été retiré, les limites voulues remises, et le fait est écrit
dans `worker/wrangler.toml` au-dessus des bindings.

**Conséquence à dire clairement : la protection anti-abus que le dépôt décrit n'existe pas, et ça
précède tout ce qui a été fait aujourd'hui.** Le re-keying par appareil reste correct et
inoffensif, mais il ne protège rien tant que ceci n'est pas résolu. Deux sorties : activer le Rate
Limiting côté compte Cloudflare, ou compter nous-mêmes (Durable Object ou KV). À trancher.
