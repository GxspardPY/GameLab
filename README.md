# GameLab — version collaborative

GameLab garde son interface, les jaquettes, les fiches au clic, le tri par prix et les tarifs Steam actualisés par GitHub Actions. **Nouveau :** vos deux comptes utilisent la **même liste partagée Supabase** (ajouts, favoris, statuts, suppression). Les changements arrivent presque immédiatement grâce aux notifications Supabase ; un contrôle toutes les 15 secondes prend le relais si nécessaire.

## 1 — Créer le projet Supabase (gratuit pour un petit groupe)

1. Ouvre https://supabase.com/dashboard et crée un projet.
2. Dans **SQL Editor → New query**, colle **tout `supabase.sql`**, puis clique sur **Run**. Ne saute pas cette étape : elle installe les tables, les permissions de sécurité (RLS) et les fonctions permettant de créer et rejoindre un groupe.
3. Dans **Project Settings → API Keys** (ou *Connect* selon l'interface), récupère **Project URL** et **anon / publishable key**. Ne copie **JAMAIS** une clé `service_role` ou `secret` dans un site public.
4. Ouvre `config.js` dans VS Code : remplace les deux valeurs `REMPLACER_...` par l'URL et **la clé publique**. Exemple :

```js
window.GAMELAB_SUPABASE = {
  url: 'https://ton-projet.supabase.co',
  anonKey: 'ta-cle-publique-anon-ou-sb_publishable'
};
```

5. Dans **Authentication → Providers → Email**, laisse l'authentification e-mail activée. Si la confirmation par e-mail est active, chaque utilisateur devra cliquer sur le lien du mail avant de se connecter.
6. Dans **Authentication → URL Configuration**, définis **Site URL** sur `https://gxspardpy.github.io/GameLab/` et ajoute cette même adresse aux **Redirect URLs** si nécessaire.

> La clé `anon` est publique par conception ; la sécurité repose sur les règles RLS installées par `supabase.sql`. L'**invitation de groupe** doit en revanche rester entre vous deux. N'envoie jamais tes mots de passe ni des clés secrètes.

## 2 — Mettre à jour ton dépôt GitHub déjà créé

Dans VS Code :

1. Dézippe le projet et ouvre ce dossier.
2. Modifie `config.js` comme expliqué ci-dessus.
3. Copie les fichiers de cette version à la **racine** de ton dépôt GitHub existant : `index.html`, `style.css`, `script.js`, `config.js`, `catalogue.json`, `steam-data.json`, `update_steam.py`, ainsi que `.github/workflows/gamelab.yml`.
4. `supabase.sql` et `README.md` peuvent rester dans le dépôt ; ils ne sont pas envoyés au site par GitHub Pages.
5. Fais un commit et pousse les changements sur `main` (ou via GitHub **Add file → Upload files** pour les fichiers de la racine, puis mets aussi à jour le workflow sous `.github/workflows/`).
6. Dans **GitHub → Actions**, ouvre la nouvelle exécution **Actualiser Steam et publier** : vérifie qu'elle finit avec une coche verte.

Tu peux aussi tester localement depuis VS Code avec l'extension **Live Server**. Ne lance pas `index.html` en `file://` car les fichiers JSON se chargent par `fetch()`.

## 3 — Utiliser la même liste avec ton pote

1. Ouvre https://gxspardpy.github.io/GameLab/ et inscris-toi avec ton e-mail et ton mot de passe.
2. Confirme ton e-mail si demandé, puis connecte-toi.
3. Clique sur **Créer notre groupe**. GameLab importe les jeux de `catalogue.json` dans cette liste lors de la création.
4. Clique sur **Copier le code** et partage-le **en privé** à ton pote.
5. Ton pote ouvre la même URL, crée **son propre compte**, puis colle ton code dans **Rejoindre le groupe**.
6. Lorsque l'un ajoute, modifie ou supprime un jeu, l'autre voit la même liste. Les favoris et statuts sont **communs au groupe**, et non individuels.

## À savoir sur les prix

Les tarifs sont des **relevés** Steam France, pas des valeurs en direct à chaque ouverture. Le workflow GitHub récupère les jeux présents dans `catalogue.json` quatre fois par jour si Steam répond. Un **nouveau jeu ajouté depuis le site** se synchronise tout de suite, avec une image si son App ID est connu, mais son prix Steam n'est pas relevé automatiquement tant que son App ID ne figure pas également dans `catalogue.json`. Tu peux provisoirement saisir un prix manuel dans sa fiche.

## Dépannage

- **Écran « Supabase n'est pas encore configuré »** : remplis puis publie `config.js` ; vérifie que ce fichier est bien copié par GitHub Actions.
- **« relation ... does not exist » / « function ... does not exist »** : relance `supabase.sql` dans SQL Editor.
- **« new row violates row-level security policy »** : les règles SQL n'ont pas été appliquées, ou tu n'as pas rejoint le groupe.
- **Compte créé mais connexion impossible** : cherche le mail de confirmation dans tes mails/indésirables.
- **Page en cache** : Ctrl + F5 ; ouvre la dernière version déployée.
- **Prix indisponible** : vérifie `steam-data.json` et le workflow Steam GitHub. Les nouveaux jeux non présents dans `catalogue.json` ne sont pas récupérés automatiquement.

## Architecture

- `index.html` / `style.css` : interface.
- `script.js` : interface, authentification Supabase, lecture/écriture de la liste partagée, abonnement aux changements et vérification périodique.
- `config.js` : URL et clé **publique** Supabase.
- `supabase.sql` : SQL des tables, sécurité RLS, fonctions créer/rejoindre et notifications.
- `catalogue.json` : suggestions initiales et jeux surveillés par Steam.
- `update_steam.py` + `.github/workflows/gamelab.yml` : collecte des prix et publication GitHub Pages.
- `steam-data.json` : dernier relevé Steam.

Le projet est statique et compatible avec GitHub Pages. Ne stocke pas de données privées sensibles dans les descriptions de jeux : le code d'invitation donne accès à leur liste à toute personne authentifiée qui possède ce code.
