# FAIT — Track morphologie générative (noté + livré 2026-06-07)

> **Livré 2026-06-07.** 8 leçons `morpho-001..008-en.html` dans `C:/dev/projects/ulpan-hebrew/` (le repo vivant — l'ambiguïté de chemin ci-dessous est résolue, `admin/alyah/...` est un mirror mort). Interface EN (glose dans le champ `fr`, comme les 510 leçons existantes). Liées depuis `index.html` (`#cat-morpho`) + `CURRICULUM.md`. Track transversal (comme cursive/prayers), distinct des leçons séquentielles 28-30 sur les binyanim. Rendu vérifié headless : 0 erreur JS, word-lists/quiz/exercices auto OK. Spec d'origine conservée ci-dessous.

## Intention (mots de Jonas)

"racines, verbes, noms" — enseigner **la machine de l'hébreu**, pas du vocab à mémoriser.
Le but : que Jonas **décode et dérive** un mot inconnu (racine + patron → sens + toute la famille),
au lieu d'apprendre les mots un par un. Déclencheur : l'explication de בהצלחה (préposition ב +
nom הצלחה, ה final = féminin + nom d'action du binyan hif'il, patron הַ_ָ_ָה).

## Méthode pédagogique (la "méthode בהצלחה")

Chaque concept se présente ainsi, et c'est ce qui doit être reproduit partout :
1. **Décomposer** le mot (préfixe / racine / patron / suffixe).
2. **Isoler le patron** (le moule génératif).
3. **3-4 exemples qui s'enchaînent** sur le même moule → impression de débloquer des dizaines de mots d'un coup.
Exemple type : hif'il שם פעולה הַ_ָ_ָה → הצלחה (succès), הדרכה (formation), הזמנה (invitation), הצהרה (déclaration).

## Contenu du track

1. **שורש (shoresh) — le système des racines.** Racines triconsonantiques, le sens vit dans la racine.
   Familles de mots autour d'une racine. Ex : כ-ת-ב → כָּתַב (écrire), מִכְתָּב (lettre), כְּתֹבֶת (adresse), הַכְתָּבָה (dictée).
2. **בניינים — les 7 patrons verbaux.** Pa'al (קל), Nif'al, Pi'el, Pu'al, Hif'il, Huf'al, Hitpa'el.
   Pour chacun : fonction (action simple / passif / intensif / causatif / réfléchi), reconnaissance
   (préfixes + voyelles), et exemples sur UNE même racine pour voir le sens muter.
   Ex racine ל-מ-ד : לָמַד (apprendre, pa'al) / לִימֵּד (enseigner, pi'el) / הִתְלַמֵּד.
3. **שם פעולה (noms d'action) par binyan — table générative.**
   - Hif'il → הַ_ָ_ָה (הצלחה, הדרכה)
   - Pi'el → _י_ו_ (דיבור parler, טיול balade, ביקור visite)
   - Pa'al → _ְ_י_ָה (כתיבה écriture, קריאה lecture)
4. **משקלים usuels (noun patterns).** Métiers (קטלן : שחקן acteur, רקדן danseur), lieux,
   instruments, abstraits. Reconnaître le moule → deviner la catégorie de sens.
5. **Atelier décodage.** Exercices "mot inconnu → trouve racine + binyan/mishkal → devine le sens
   + la famille". C'est la charge utile : le réflexe génératif, pas la liste.

## Découpage suggéré (6-8 leçons)

- M1 Système des racines (shoresh) + familles de mots
- M2 Pa'al & Nif'al
- M3 Pi'el & Pu'al
- M4 Hif'il & Huf'al (avec le שם פעולה הַ_ָ_ָה — l'exemple בהצלחה / הדרכה)
- M5 Hitpa'el (réfléchi)
- M6 Noms d'action par binyan — table générative complète
- M7 Mishkalim usuels (métiers / lieux / instruments / abstraits)
- M8 Atelier décodage (mot inconnu → racine + patron → sens)

## Format (suivre les conventions existantes)

- Pattern HTML + `app.js` (helpers `R()`, `addMiniQuiz`, `addCulturalText`) comme les autres leçons.
- Anglo-translit (ch=ח, tz=צ, kh=כ), **niqqud ON** sur le vocab, registre israélien moderne.
- **No emojis**, no AI-tells (pas de "delve", "tapestry", pas de tirets cabossés).
- Mini-quiz par leçon + exercices de décodage (mot → racine + patron).
- Numérotation : trouver le bloc libre, ou un mini-cours transversal "Morphologie" lié depuis `index.html` + `CURRICULUM.md`.

## À confirmer demain

- **Chemin canonique du projet** : les fichiers leçon sont dans `C:/dev/projects/ulpan-hebrew/`,
  mais `NEXT_SESSION_PROMPT.md` cite `C:/dev/projects/admin/alyah/ulpan/hebrew-beginner/`. Vérifier
  lequel est le repo vivant (ou si c'est un mirror) AVANT d'écrire des leçons, sinon double source.
- Place dans la numérotation (bloc dédié vs intercalé).
