# Ulpan Hebrew — Plan de refonte pédagogique

_Décidé avec Jonas 2026-07-15, sur review Fable. Objectif : passer d'un moteur de reconnaissance de mots isolés à un moteur de **production de phrases** pour un olé qui doit parler._

## 0. Principe directeur

La cible n'est pas de reconnaître des mots, c'est de **produire des phrases dans une situation réelle**. Chaque décision se juge à : « est-ce que ça rapproche l'apprenant du moment où il parle dans un magasin / une clinique / un taxi ? »

Trois leviers, dans l'ordre :
1. Construire des phrases (sous contrainte grammaticale), pas les reconnaître.
2. Une couche de phrases complètes + expressions quotidiennes, branchée au breakdown morphologique qu'on possède déjà.
3. Moins de quiz, et les quiz restants orientés production.

**L'asset sous-exploité :** le breakdown Dicta/UDPipe (`quicksay.js:renderBreakdown` + `worker/src/index.js`) qui éclate une phrase hébraïque en racine + binyan + temps + genre/nombre par mot. Aujourd'hui il ne sert que dans le popover du traducteur. Il devient la colonne vertébrale de la couche phrases.

---

## 1. Modèle de données (nouvelles arrays par leçon)

On garde la forme existante `{ he, translit, fr }` et on ajoute deux nouveaux types, **taggés** pour que le scraper de vocab (`collectLessonItems`, app.js:1056) ne les avale PAS comme des mots à driller en QCM.

### 1a. Phrases à construire (`SENTENCES`)
```js
const SENTENCES = [
  {
    he: 'אֲנִי גָּר בְּתֵל אָבִיב',
    translit: 'ani gar be-Tel Aviv',
    fr: 'I live in Tel Aviv',
    chunks: ['אֲנִי', 'גָּר', 'בְּתֵל אָבִיב'],   // tokens ordonnés = la réponse
    distractors: ['גָּרָה', 'אַתָּה'],            // verbe mauvais genre, pronom en trop
    focus: 'agreement:gender'                     // ce que la phrase enseigne
  }
];
```

### 1b. Expressions / idiomes (`EXPRESSIONS`)
```js
const EXPRESSIONS = [
  {
    he: 'חֲבָל עַל הַזְּמַן', translit: 'chaval al ha-zman', fr: 'amazing (lit. "a waste of time")',
    usage: 'enthousiasme ; entre amis ; registre familier',   // QUAND / AVEC QUI / registre
    literal: 'a waste of time'                                  // pour montrer l'écart littéral↔sens
  }
];
```

### 1c. Slot/substitution (`FRAMES`) — le geste génératif
```js
const FRAMES = [
  { frame: 'אֲנִי רוֹצֶה ___', translit: 'ani rotze ___', fr: 'I want ___',
    slots: [ { he: 'קָפֶה', fr: 'coffee' }, { he: 'מַיִם', fr: 'water' }, { he: 'לְשַׁלֵּם', fr: 'to pay' } ] }
];
```

Règle anti-piège (Fable) : ces arrays ne doivent PAS passer par `collectLessonItems`. Soit array séparée lue directement par le renderer, soit `data-kind="sentence"` sur les rows. Sinon les phrases retombent en flashcards de vocab = on recrée le problème.

---

## 2. Mécaniques (codées UNE fois dans app.js, propagées aux 460 leçons)

### 2a. Sentence-builder (priorité #1)
**Surface (décidé 2026-07-15) :** lancé DEPUIS la leçon (zone d'exercices), affiché en **modal focalisé** (comme `showSRSReview` / le Mixed Quiz), PAS un bouton header global (le traducteur est global/sans contexte ; le sentence-builder est lié au contenu de la leçon). Une entrée globale cross-leçon dans le hamburger (« Practice sentences ») est **différée** (inutile tant qu'une seule leçon a des phrases) — à ajouter en P5 quand plusieurs leçons ont des SENTENCES.

Nouveau mode dans `renderExercise` (app.js:1132) consommant `SENTENCES`.
- Les tuiles `chunks + distractors` mélangées dans un bac en bas ; tap pour placer dans l'ordre ; check vs `chunks`.
- **Les distracteurs SONT la pédagogie** : גָּרָה (fém.) à côté de גָּר (masc.) force l'accord de genre ; une préposition בְּ/לְ/אֶת en trop force l'attachement (le piège classique olim) ; un pronom parasite force l'ordre des mots.
- Sur erreur : surligner le point `focus` + afficher la règle en une ligne.
- **Sur réussite : auto-render du breakdown Dicta de la phrase finie** (`renderBreakdown`) → chaque bonne réponse devient une micro-leçon de grammaire gratuite.

### 2b. Substitution drill (frames)
Mode léger consommant `FRAMES` : une trame, on remplit le slot avec chaque valeur. Enseigne qu'une phrase = une trame + des slots, pas une chaîne mémorisée.

### 2c. Collapse des quiz : 7 modes → 3
| Décision | Modes | Raison |
|---|---|---|
| **Garder** | Flashcard (exposition) ; Listen&Match **converti en production** (écoute → reconstruis) ; **mini-quiz situationnel promu dans le moteur** | production ou exposition légitime |
| **Rétrograder en warm-up** | Multiple Choice (fuite : montre hébreu + translittération) ; English→Hebrew (choisir ≠ produire) | reconnaissance |
| **Couper** | Memory Pairs (jeu de concentration) ; Dictation (redondant avec Audio+Typing) ; Typing (on tape la translittération, jamais l'hébreu) | ~0 transfert vers la parole |

Le **mini-quiz situationnel** (`addMiniQuiz`, app.js:1505 — « il est 19h, tu dis quoi ? ») est la meilleure pédago du stock mais n'existe qu'à la main dans qques leçons. On le remonte dans le moteur partagé, alimenté par une array `SITUATIONS` par leçon.

---

## 3. La couche contenu — génération à l'échelle (le vrai goulot)

Le mécanisme se code une fois ; le contenu (phrases + distracteurs + expressions) doit être écrit. On ne le fait PAS à la main sur 460 leçons. Pipeline semi-automatique qui s'appuie sur l'asset Dicta :

**`tools/gen-sentences.mjs`** (nouveau script local) :
1. **Entrée** : par leçon, un jeu de phrases-cibles en hébreu (10-15) que **Claude authore** à partir du vocabulaire de la leçon (les arrays existantes) + du thème. Claude génère l'hébreu + le sens.
2. **Enrichissement automatique via le Worker morpho** (`ulpan-morph`) : chaque phrase passe par Dicta/UDPipe → niqqud (vocalisation), translittération (via translit.js sur le vocalisé), et **découpage en `chunks` à partir des frontières de tokens UDPipe** (gratuit, déjà là).
3. **Distracteurs semi-auto** : pour les phrases avec un verbe, générer le distracteur de genre opposé ; ajouter une préposition parasite plausible. Le `focus` est déduit du type de distracteur.
4. **Sortie** : l'array `SENTENCES` prête à coller dans la leçon (ou dans un fichier de données chargé par la leçon).
5. **Validation** : re-run Dicta sur la phrase finale = garde-fou contre une phrase mal formée (LOI #0g : données réelles, ici morphologie vérifiée, pas inventée).

Expressions : couche **curée à la main** (pas 460 leçons), ~150-300 idiomes avec note d'usage. On part de ce qui existe déjà éparpillé (92-small-talk : yalla, נו, סבבה, מה פתאום, חבל על הזמן…) + une catégorie dédiée « Expressions ».

---

## 4. Priorisation des leçons (on ne traite pas les 460 pareil)

| Vague | Leçons | Pourquoi |
|---|---|---|
| **V1 — preuve** | greetings (04), small-talk (92), daily-life, restaurant-food (14), shopping (34), directions (91) | vie quotidienne pure, ROI max, valide le mécanisme |
| **V2 — survie olé** | banking-admin (17), medical (15), misrad-hapnim (42), rental (43), job-hunting (44), phone-calls (48) | démarches concrètes d'un nouvel arrivant |
| **V3 — extension** | le reste des leçons « Living Hebrew » conversationnelles | après rodage du pipeline |
| **Hors scope phrases** | Roots Atlas, Tehilim, communautés, cinéma… | vocab/lecture, pas du drill de phrases parlées |

Expressions : catégorie transverse, pas par vague.

---

## 5. SRS en mode production (le scheduler est bon, l'interaction non)

- L'algo SM-2 (`srUpdate`, app.js:585) est correct, on n'y touche pas.
- Le problème : une review = flip de flashcard ou QCM = reconnaissance encore.
- Fix : `showSRSReview` (index.html:3326) branche sur le type de carte —
  - carte **mot** → produire le sens/le mot,
  - carte **phrase** → cloze du mot `focus` OU reconstruction depuis les tuiles.
- Un flip passif ne compte plus comme une rep gradée.

---

## 6. Ordre de bataille (phases livrables)

1. **P1 — Moteur.** Sentence-builder + substitution drill + collapse des quiz (7→3) dans app.js. Contenu : SENTENCES/FRAMES codées à la main sur 04-greetings seul (preuve). Bump version, test headless, deploy. → **tu vois le mécanisme vivant sur une leçon.**
2. **P2 — Pipeline contenu.** `tools/gen-sentences.mjs` (authoring Claude + enrichissement Dicta). Générer V1 (6 leçons). Deploy.
3. **P3 — Expressions.** Couche EXPRESSIONS curée + catégorie dédiée + note d'usage + breakdown en un tap. Deploy.
4. **P4 — SRS production.** Review branché sur le type de carte. Deploy.
5. **P5 — Extension.** V2 puis V3 via le pipeline rodé.

Chaque phase = 1 deploy testé, réversible, sans casser l'existant.

---

## 7. Risques / garde-fous

1. **Justesse de l'hébreu généré.** Mitigé par la validation Dicta systématique. Une phrase que Dicta ne vocalise pas proprement est rejetée, pas livrée.
2. **Scraper de vocab qui avale les phrases** → tag `data-kind` obligatoire (§1).
3. **Volume de contenu** → priorisation par vagues (§4), jamais « tout, tout de suite ».
4. **Ne pas casser les leçons existantes** → les nouvelles arrays sont additives ; une leçon sans SENTENCES garde le comportement actuel (dégradation propre).
5. **Rétrocompat SRS** → les cartes mot existantes continuent de marcher (branche par type, défaut = mot).
