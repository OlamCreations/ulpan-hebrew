# DÉCISIONS QUI M'APPARTIENNENT — NE LES PRENDS PAS SEUL

Liste lue par `C:/dev/.claude/hooks/prompt_gate.py`. Une ligne = une décision réservée à Jonas.
**Tout ce qui n'est PAS ici appartient à l'agent : il l'exécute sans demander l'autorisation.**

Seules les **puces** sont lues par la porte. Dérivée le 2026-08-05 des sources du dépôt.

- **Arbitrer le rendu du Nom divin avant d'écrire les psaumes 11 à 20** — voir l'encadré ci-dessous, c'est la plus lourde de la liste [`liturgy/tehilim-001.html:998, 1151` vs `tools/reports/tehilim-011.data.json`]
- Pousser le commit local `78a8394` — le dépôt est servi depuis `olamcreations.github.io`, donc pousser **c'est mettre en ligne** [`git status -sb` ; `README.md:64-65`]
- Ouvrir ou non la passe d'écriture des psaumes 11 à 20 — les données mécaniques des dix psaumes existent depuis le 04/08, aucune page correspondante n'a été écrite [`tools/reports/tehilim-0{11..20}.data.json` ; `ls liturgy/`]
- Choisir le premier incrément du traducteur — le document le qualifie de « premier incrément **proposé** », jamais de décidé [`docs/translator-pedagogy-brainstorm.md:204-212`]
- Trancher la tension pédagogie contre vitesse : le mode « rappel avant réponse » doit-il être un réglage ou une loi — le document nomme lui-même ce point « la tension à trancher » [`docs/translator-pedagogy-brainstorm.md:195-198`]

---

## ⚠️ Le Nom divin — contradiction entre deux artefacts, non arbitrée

Les pages de Tehilim déjà livrées translittèrent יְהוָה en **`a-do-NAY`** et le traduisent par
« l'Éternel » — la convention juive qui ne prononce jamais le Tétragramme. La sortie mécanique
du scaffold (`translit.js`) rend au contraire **`ye-ho-VA`** pour יְהֹוָה et **`bai-ho-VA`**
pour בַּיהֹוָה, c'est-à-dire une vocalisation littérale des points-voyelles.

**Aucun texte du dépôt ne signale cette contradiction ni ne la tranche.** Elle est déduite de
deux artefacts qui se contredisent, pas d'une prose qui la nomme.

Enjeu concret : les données mécaniques des psaumes 11 à 20 sont générées et attendent d'être
mises en page. Les écrire sans arbitrer propagerait la sortie mécanique sur dix psaumes, à
rebours de la convention tenue dans les dix premiers. Ce n'est pas un détail de style.

---

Écartés avec leur raison : la **convention de translittération** est arrêtée et verrouillée par
un test qui doit rester à 118/118, pas d'arbitrage ouvert ; le plan de pédagogie est daté
« décidé avec Jonas 2026-07-15 » ; les deux points « à confirmer » de `MORPHOLOGIE-TRACK.md`
sont résolus en tête du même fichier ; aucune dépense n'est engagée, les deux dépendances
externes étant explicitement gratuites.

Réserve de fraîcheur : `NEXT_SESSION_PROMPT.md` et `MORPHOLOGIE-TRACK.md` datent du 07/06, deux
mois avant le dernier commit, et leur objet est marqué livré. Leur consigne « attends mon go
avant de créer des fichiers » y est littérale mais son contexte est périmé.

Ni `HANDOFF.md`, ni `REPRISE.md`, ni `CLAUDE.md`, ni `AGENTS.md` n'existent ici. Fichiers lus :
`README.md`, `NEXT_SESSION_PROMPT.md`, `MORPHOLOGIE-TRACK.md`, `docs/pedagogy-redesign-plan.md`,
`docs/translator-pedagogy-brainstorm.md`, `worker/*`, `tools/tehilim-scaffold.mjs`,
`tools/reports/*.json`, `liturgy/*.html` (extraits), `CURRICULUM.md`, `assets/translit.js`,
`git log/status`.
