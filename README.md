# GameLab — votre collection de jeux à deux

Site web sombre et responsive (HTML / CSS / JavaScript), **hébergeable gratuitement sur GitHub Pages**.

## Le site sait faire quoi ?

- Pochettes officielles Steam pour les jeux dont on connaît l'App ID.
- Fiche au clic : image, résumé, genre, joueurs, statut, lien Steam, prix et date du relevé.
- Prix français en euros et promotions, via un **relevé périodique Steam effectué par GitHub Actions**.
- Tri **prix croissant / décroissant**, par remise, ou alphabétique (jeux sans tarif à la fin).
- Recherche, filtres, favoris, progression, budget des jeux non terminés et roulette.
- Ajout et modification personnels, sauvegarde et transfert JSON.
- Fonctionne aussi sur téléphone.

### 1) Tester dans VS Code

1. Décompresse `GameLab.zip` et ouvre le dossier `GameLab` dans VS Code.
2. Installe l'extension **Live Server** (ou lance `python -m http.server 5500` dans le dossier).
3. Ouvre `index.html` via Live Server, généralement `http://127.0.0.1:5500`.

> Évite d'ouvrir directement `file:///.../index.html` : le navigateur peut bloquer la lecture des fichiers JSON.

### 2) Mettre en ligne (GitHub Pages)

1. Crée un dépôt GitHub **public**, par exemple `gamelab`.
2. Ajoute **tout le contenu du dossier GameLab à la racine** du dépôt : `index.html`, `style.css`, `script.js`, `catalogue.json`, `steam-data.json`, `.github/workflows/gamelab.yml`, `scripts/update_steam.py`.
3. Utilise `main` comme branche principale.
4. Dans **Settings → Pages → Build and deployment → Source**, sélectionne **GitHub Actions** (et non « Deploy from a branch »).
5. Dans **Actions**, ouvre « Actualiser Steam et publier », puis **Run workflow**. Si GitHub demande d'activer Actions, accepte.
6. La première exécution récupère les prix FR et publie la page. Ton adresse sera du type : `https://TON-PSEUDO.github.io/gamelab/`.

Le workflow se relance normalement quatre fois par jour, **sans garantie d'exécution à l'heure exacte**. Les prix et les images sont issus de l'API publique de la boutique Steam ; ses réponses peuvent échouer ou ne pas renseigner certains jeux. Aucun prix n'est inventé. L'heure du dernier relevé est affichée sur le site. Ce ne sont **pas des prix temps réel**.

Si GitHub refuse de pousser `steam-data.json` : regarde **Settings → Actions → General → Workflow permissions**. Si le workflow échoue, consulte son journal. Pour un dépôt avec des règles de branche strictes, autorise le bot à mettre à jour le fichier ou retire l'étape de commit et conserve simplement l'artefact publié.

### 3) Ajouter un nouveau jeu pour vous deux

`catalogue.json` contient la liste **commune et publique**. Ouvre ce fichier, puis ajoute un objet :

```json
{
  "name": "Nouveau jeu",
  "appid": 620,
  "genre": "Énigmes / Coop",
  "players": "2 joueurs",
  "description": "Un petit résumé de votre jeu."
}
```

Remplace `620` par l'identifiant du jeu choisi, visible dans son URL Steam (`store.steampowered.com/app/620/`). Enregistre et pousse le fichier vers GitHub : le workflow repart, puis vos deux navigateurs verront le même jeu.

Les entrées `Left Left Left` et `Scam With Your Friends` n'ont **pas d'App ID confirmé**, donc pas de prix ni de pochette attribués au hasard. Une fois leurs pages Steam retrouvées, renseigne l'App ID.

### 4) Important : ce qui est partagé et ce qui ne l'est pas

- **Partagé :** le catalogue présent dans `catalogue.json`, les pochettes et les relevés de prix publiés sur GitHub.
- **Personnel :** favoris, statuts, changements et jeux ajoutés par le bouton **Ajouter un jeu** sont stockés dans le `localStorage` de chaque navigateur. Ton pote ne voit **pas automatiquement** ces modifications.
- **Pour partager une sélection sans modifier GitHub :** exporte le JSON, puis ton pote l'importe.
- **Pour modifier ensemble la même liste en direct :** il faut ajouter un service de synchronisation et des règles d'accès, par exemple Supabase. GitHub Pages ne fournit pas de base de données.

### Fichiers

- `index.html` : structure et panneaux.
- `style.css` : design responsive.
- `script.js` : logique, fiches, filtres, stockage.
- `catalogue.json` : liste commune de jeux et descriptions.
- `steam-data.json` : dernier relevé de Steam (vide avant le premier workflow).
- `scripts/update_steam.py` : relève prix, réductions, infos et jaquettes de Steam.
- `.github/workflows/gamelab.yml` : actualise et publie le site.

Aucune clé privée Steam / GitHub n'est stockée dans le site.
