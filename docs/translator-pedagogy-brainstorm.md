# Brainstorm — faire du live translator un vecteur d'apprentissage

**Date** : 2026-08-04
**Demande de Jonas** : « ça doit être un véritable vecteur d'apprentissage, pas juste balancer le mot comme ça »
**Axes retenus** : comprendre · retenir · relier. **Écarté explicitement** : produire (le moteur de production existe déjà côté leçons, P1).
**Techniques** : First Principles · Analogical Thinking · Assumption Reversal · Five Whys · Alien Anthropologist · Cross-Pollination · SCAMPER · Constraint Mapping
**Idées** : 80. Pas 100 — le protocole vise la quantité, mais la dernière chose utile ici est du remplissage. Chaque ligne ci-dessous est jouable.

---

## La bascule (First Principles)

Qu'est-ce qui fait qu'une langue rentre ? En dépouillant : de l'input compréhensible juste
au-dessus du niveau, le fait de **remarquer** la forme et pas seulement le sens, du **rappel**
plutôt que de la relecture, de l'**espacement**, et de la **pertinence personnelle**.

Le traducteur coche la case la plus dure de toutes, et par accident. C'est le seul endroit de
l'app où tu arrives parce que **tu voulais dire quelque chose**. Pas un exercice, pas un
programme : un besoin réel, daté, chargé émotionnellement, et par construction juste au-dessus
de ton niveau — sinon tu n'aurais pas cherché.

> **Les 465 leçons sont le programme de tout le monde. Tes requêtes sont ton programme à toi.
> L'app génère ce programme à chaque frappe, l'affiche une fois, et le jette.**

Tout ce qui suit découle de ça. Le traducteur n'a pas besoin d'être « enrichi » : il a besoin
d'arrêter de perdre ce qu'il produit déjà.

---

## Le diagnostic (Five Whys)

Pourquoi une recherche ne reste pas ? Parce qu'elle est lue une fois. Pourquoi une seule ?
Parce que rien ne la ramène. Pourquoi rien ? Parce que le résultat n'est pas stocké comme objet
apprenable, seulement peint à l'écran. Pourquoi ? Parce que « sauver » est manuel et va dans le
carnet « My phrases ». Pourquoi pas dans le SRS ? **Parce que le carnet et le moteur de révision
ont été construits séparément, et que le comportement par défaut ne mène ni à l'un ni à l'autre.**

Racine : deux systèmes de mémoire disjoints, et le défaut est l'oubli.

---

## Ce qui existe déjà et que le traducteur ignore (Constraint Mapping)

C'est là que se cache le meilleur rapport valeur/effort. Rien à inventer, tout à câbler.

| Ressource | État | Utilisée par le traducteur ? |
|---|---|---|
| `data/gloss.json` — 6 871 mots vocalisés vérifiés | construite | seulement pour gloser un breakdown |
| 465 leçons avec listes de mots | construites | **non** — aucun index mot → leçon |
| Atlas des racines (~250 pages) | construit | **non** — aucun lien |
| `expressions.json` — 129 idiomes + note d'usage | construite | **non** |
| Moteur SRS (SM-2) | construit | **non** — « save » va au carnet, pas au deck |
| Frontières de préfixe Dicta (`לְ|בֵית`) | reçues | **supprimées** par `.replace(/\|/g,'')` |
| Racine / lemme, binyan, temps, genre-nombre | reçus | affichés derrière un clic |
| Bouton copier + event `phrase_copied` | construits | tracés, jamais exploités |
| `#d-heatmap` | **code mort** référencé | non |

---

## Idées par technique

### A. Le journal de recherche comme programme (First Principles)

1. Journaliser chaque requête comme un « vouloir-dire » horodaté. L'ensemble = ton vrai syllabus.
2. Détection de trou : mots dont tu as eu besoin et qu'aucune leçon ne t'a jamais présentés.
3. L'inverse, plus précieux : mots cherchés qui SONT dans une leçon que tu as faite → tu as oublié → priorité SRS maximale.
4. Digest hebdomadaire « ce que tu as essayé de dire cette semaine ».
5. Calibrage de niveau implicite : la difficulté de tes requêtes dit ton niveau mieux qu'un test de placement.
6. Regroupement thématique : « 6 requêtes sur la nourriture cette semaine » → mini-leçon générée.
7. Générer une vraie page de leçon (n° 466+, format existant) à partir des requêtes du mois.
8. Export imprimable de la semaine, à emmener en classe.
9. **Liste « à demander au prof »** : les cas où l'app s'est abstenue (genre ambigu, aucune lecture). L'abstention devient une question pour un humain.
10. Rejouer les requêtes hors ligne pour la révision en avion.

### B. Remarquer — rendre la forme visible (noticing)

11. **Surligner le diff** entre la carte de base et la variante genrée : exactement la voyelle qui change (רוֹצֶה → רוֹצָ**ה**). Aujourd'hui tu dois repérer la différence toi-même — le point pédagogique est invisible.
12. Idem singulier/pluriel.
13. Teinter les lettres de la racine dans le mot vocalisé (ר-צ-ה dans רוֹצָה).
14. Afficher le mishkal / le patron (קוֹטֵל) avec la racine encastrée.
15. **Restituer les frontières de préfixe que Dicta envoie et que le code jette** : ב+ה+שוק rendu visible. Donnée gratuite, actuellement supprimée à la ligne du `replace`.
16. Marquer le smichut (état construit) — un débutant ne le voit jamais.
17. Signaler la disparition de l'article indéfini français (« un café » → pas d'article en hébreu).
18. Paires minimales : si le mot diffère d'un mot connu par une lettre, montrer la paire.
19. Pièges sonores : סליחה / שליחה.
20. Expliquer le décalage de prononciation qu'implique le niqqud (shva na/nah) — translit.js le calcule déjà.

### C. Relier — le traducteur cesse d'être une île

21. **Index inverse mot → leçon(s)**, généré au build comme `gloss.json`. Débloque à lui seul les idées 22, 24, 25, 27, 28.
22. Colorer chaque mot hébreu selon la familiarité (nouveau / en cours / connu) — le modèle LingQ.
23. Racine → page de l'atlas, en un tap.
24. « Tu as croisé ce mot dans la leçon 34 » + la phrase d'exemple réelle du corpus.
25. Mots frères de la même racine que tu connais déjà (« tu sais לִכְתּוֹב, voici כַּתָּב »).
26. Si la requête matche `expressions.json`, faire remonter la note d'usage (quand, avec qui, registre).
27. Jauge de couverture : « tu connais 62 % des mots de cette phrase ».
28. « Ce mot apparaît dans 4 leçons que tu n'as pas faites » → suggère la suivante.
29. Prérequis : « cette phrase utilise le futur — leçon 14 ».
30. Tap sur un mot → sa carte de leçon, avec son état SRS.

### D. Retenir — du rappel, pas de la livraison (Assumption Reversal)

L'hypothèse à casser : *l'app répond instantanément*.

31. **Si le mot est déjà dans ton deck SRS, ne pas le donner : te le demander.** Et compter l'échec.
32. **Le traducteur devient un correcteur SRS implicite** : chercher un mot que tu es censé savoir EST un échec de rappel → note « Again » automatique en SM-2. Zéro UI en plus, signal parfaitement fiable.
33. Retarder la réponse de 2 s en montrant d'abord racine + patron, pour forcer une tentative (effet de pré-test : une tentative ratée avant la réponse améliore massivement la rétention).
34. Réponse floutée derrière un tap : « essaie d'abord ».
35. Montrer d'abord sans voyelles, te laisser tenter la lecture.
36. Choix forcé entre 2 candidats plutôt qu'une réponse servie.
37. « Tu as demandé ça il y a 3 jours » — avant de redonner la réponse.
38. **Capture automatique à trois étages** : vu (auto) → voulu (répété ou copié) → en apprentissage (SRS). Répare la racine du problème : le défaut n'est plus l'oubli.
39. **Copier = usage réel = priorité maximale.** Une phrase que tu as vraiment envoyée à un humain vaut dix flashcards. Le bouton et l'event existent déjà.
40. Détection de « leech » : cherché 5 fois sans que ça rentre → drill dédié.
41. Entrelacement : mêler les recherches du jour à d'anciennes.
42. Carte de récap de fin de session.
43. Badge PWA / notification pour les 5 révisions du jour (l'app est déjà installable).
44. Revue du matin sur les recherches de la veille.
45. Sauver les 4 formes (`/form`) comme un jeu de cartes unique.
46. Brancher le résultat dans le sentence-builder existant (`openSentenceBuilder`) : ta propre phrase, mélangée, à reconstruire.
47. Le soir, 5 phrases du jour en français → produis l'hébreu.

### E. Comprendre — la couche grammaticale

48. Une ligne « pourquoi cette forme », dérivée de la morphologie déjà reçue : « רוֹצָה — présent, Pa'al, f. sing. parce que c'est une femme qui parle ».
49. La règle contrastive derrière : au présent, le verbe s'accorde avec celui qui parle ; il n'existe pas de forme neutre.
50. **Prépositions imposées** : les verbes hébreux en exigent une fixe (לְהִתְקַשֵּׁר לְ, לְחַכּוֹת לְ). Liste curée des 50 principales, signalée à l'apparition.
51. **Genres contre-intuitifs pour un francophone** : דֶּרֶךְ, עִיר, אֶבֶן, רוּחַ. Liste curée, drapeau automatique. (Config externe, LOI 0a.)
52. Faux amis et interférences français → hébreu.
53. Ordre des mots quand il diffère du français (adjectif après le nom).
54. Forme négative quand elle est pertinente (la négation hébraïque ne se calque pas).
55. Forme interrogative.
56. Possessif : שֶׁלִּי contre le suffixe (le cas מוֹרָה / מוֹרָתִי vu avec `/nat`).
57. Table de conjugaison complète à la demande pour un verbe.
58. Collocations : les 2-3 mots qui suivent le plus souvent, tirés du corpus.
59. Registre (rue / soutenu / biblique) — `expressions.json` porte déjà le champ.
60. Avertissement « erreur classique » quand la forme demandée est un piège connu.

### F. Savoir ce que tu sais — divulgation adaptative

61. **Breakdown ouvert par défaut** si la phrase contient un mot inconnu, fermé si tout est connu.
62. Règle des 30 secondes : si tu restes sur un résultat, révéler progressivement les couches (racine → patron → mots liés).
63. **Effacement progressif du niqqud** : à mesure qu'un mot devient familier, le montrer avec moins de voyelles. Le retrait de l'échafaudage, avec la machinerie niqqud déjà en place, mais par mot au lieu de globalement.
64. Écho cursif modulé pareillement.
65. Mode lecture : réponse en cursive seule, puisque c'est ce que tu vois écrit à la main en classe.
66. Deux volets permanents : « la réponse » et « la leçon », pour que la couche pédagogique ne soit pas cachée derrière un clic.

### G. L'incertitude honnête comme outil pédagogique

67. Afficher quelle source a répondu (corpus vérifié / LLM / Google) — les tags existent, les rendre lisibles pour que tu apprennes à qui te fier.
68. Toujours montrer l'autre lecture quand l'app a dû trancher un homographe.
69. Quand l'app s'abstient, dire pourquoi — c'est une leçon sur l'ambiguïté de l'hébreu non vocalisé.
70. Journal des abstentions → alimente l'idée 9.

### H. Divers récoltés en chemin

71. Audio d'abord : jouer avant d'afficher, forcer l'écoute.
72. Relecture syllabe par syllabe en mode lent (l'accent tonique est déjà calculé).
73. Nombres, dates et heures traités comme mini-règle (le code épelle déjà les nombres).
74. Alerte « proche d'un mot de ton deck ».
75. Suggérer l'ajout SRS quand une requête se répète 3 fois.
76. Ajouter un MOT (pas la phrase) au SRS depuis le breakdown, en un tap.
77. Remplacer l'état vide « Nothing found » par « voici le plus proche que tu connais ».
78. Heatmap de recherches — le code mort `#d-heatmap` attend déjà.
79. Streak d'apprentissage basé sur les lookups, pas sur les leçons ouvertes.
80. Boucle de retour légère : « tu l'as utilisée ? » sur une phrase copiée.

---

## Les 10 qui comptent

Classées par (impact d'apprentissage × ce qui existe déjà).

| # | Idée | Pourquoi elle |
|---|---|---|
| 1 | **Index inverse mot → leçon / racine / expression** (21) | Une seule construction, au build, comme `gloss.json`. Débloque 22, 24, 25, 27, 28, 30, 61. C'est la plateforme, pas une feature. |
| 2 | **Capture automatique à trois étages** (38) | Attaque la racine du Five Whys. Le défaut cesse d'être l'oubli. |
| 3 | **Copier = usage réel = priorité max** (39) | Le signal le plus fiable de toute l'app, déjà tracé, jamais lu. Une phrase envoyée à un humain vaut dix cartes. |
| 4 | **Chercher un mot du deck = échec de rappel** (32) | Note SM-2 automatique. Zéro interface, signal parfait. Rend le SRS honnête. |
| 5 | **Surligner le diff des formes** (11) | On vient de livrer `/form` et le point pédagogique est invisible : tu dois repérer la voyelle toi-même. Petit, immédiat. |
| 6 | **Coloration par familiarité** (22) | Le modèle LingQ. Transforme chaque résultat en carte de ce que tu sais. Dépend de #1. |
| 7 | **Ligne « pourquoi cette forme »** (48) | La morphologie est déjà là ; il ne manque qu'une phrase. Le cœur de « comprendre ». |
| 8 | **Breakdown ouvert selon ce que tu sais** (61) | Supprime un clic quand ça compte, supprime du bruit quand non. Dépend de #1. |
| 9 | **Effacement progressif du niqqud** (63) | Retrait d'échafaudage — c'est de la vraie pédagogie, et la machinerie existe. |
| 10 | **Liste « à demander au prof »** (9) | Convertit l'abstention, déjà présente partout, en valeur. Et ça respecte l'ulpan : certaines questions sont pour un humain. |

---

## Ce que le brainstorm a fait remonter, en une ligne chacun

- **Le motif dominant** : presque rien à inventer. Sept des dix premières idées ne font que
  brancher des choses déjà construites qui ne se parlent pas.
- **La donnée jetée** : les frontières de préfixe de Dicta sont supprimées par un `replace`,
  et l'event `phrase_copied` est écrit sans jamais être lu.
- **La tension à trancher** : plus l'app enseigne, plus elle ralentit celui qui veut juste
  envoyer un WhatsApp. Le mode « rappel avant réponse » (31-36) doit être un réglage, pas une
  loi — sinon l'outil devient pénible et tu cesseras de l'ouvrir, ce qui coûte plus que tout
  ce qu'il enseignait.
- **Le risque de dérive** : la moitié de ces idées ne valent rien sans mesure. « Est-ce que ça
  fait retenir ? » n'est pas vérifiable par une capture d'écran.

---

## Premier incrément proposé

**L'index inverse (#1) plus la capture automatique (#2, #3, #4).** Ensemble ils sont la
plateforme dont dépendent six des dix premières idées, et ils sont invisibles : rien ne
ralentit une recherche. Puis #5 et #7, qui sont petits et se voient immédiatement.

Ce qui **n'est pas** dans ce premier incrément et ne doit pas y glisser : tout ce qui retarde
ou cache une réponse (31-36). Ça vient après, derrière un réglage, une fois que la capture
prouve qu'elle capte quelque chose.

---
*Méthodologie BMAD. Suite logique de `docs/pedagogy-redesign-plan.md` (P1-P5), qui couvrait les
leçons ; celui-ci couvre le traducteur.*
