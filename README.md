# 5GPT Recipe App (SPA)

Application web single-page (HTML/CSS/JS) pour gérer des recettes :
- CRUD recettes (création / modification / suppression)
- Ingrédients dynamiques
- Catégories personnalisées (CRUD avec blocage de suppression si utilisée)
- Photos (upload + preview) stockées en base64
- Persistance via **IndexedDB**
- Export / Import JSON

## Lancer en local

### Option 1 (simple)
Ouvre `index.html` dans ton navigateur.

> Remarque: certains navigateurs peuvent restreindre IndexedDB en `file://`.  
> Si tu as un souci, utilise l’option 2.

### Option 2 (recommandée)
Servir le dossier avec un petit serveur statique :

```bash
# Python
python -m http.server 5173

# puis ouvre
http://localhost:5173
```

## Structure des données

- `categories` : `{ id, name, createdAt, updatedAt }`
- `recipes` : `{ id, name, description, prepTime, cookTime, servings, difficulty, categoryId, imageDataUrl, ingredients[], instructions, createdAt, updatedAt }`

Export JSON:
- `schema: recipe-app-backup-v1`
- `recipes[]`, `categories[]`