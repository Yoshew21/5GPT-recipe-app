// SPA Recettes - Vanilla JS + IndexedDB
// Données: categories, recipes
// Images: data URL base64

// ===== THEME MANAGEMENT =====
const THEME_KEY = "recipe_app_theme";

function getStoredTheme() {
  return localStorage.getItem(THEME_KEY) || "light";
}

function setStoredTheme(theme) {
  localStorage.setItem(THEME_KEY, theme);
}

function applyTheme(theme) {
  if (theme === "dark") {
    document.documentElement.setAttribute("data-theme", "dark");
  } else {
    document.documentElement.removeAttribute("data-theme");
  }
  updateThemeIcon(theme);
}

function updateThemeIcon(theme) {
  const icon = document.getElementById("themeIcon");
  if (icon) {
    icon.textContent = theme === "dark" ? "🌙" : "☀️";
  }
}

function toggleTheme() {
  const currentTheme = getStoredTheme();
  const newTheme = currentTheme === "light" ? "dark" : "light";
  setStoredTheme(newTheme);
  applyTheme(newTheme);
}

// Initialize theme on load
applyTheme(getStoredTheme());

// ===== APP LOGIC =====

const DB_NAME = "recipe_app_db";
const DB_VERSION = 1;

const STORES = {
  recipes: "recipes",
  categories: "categories",
  meta: "meta",
};

const DEFAULT_CATEGORIES = ["Desserts", "Plats principaux", "Petit-déjeuner", "Entrées", "Boissons"];

const $ = (sel) => document.querySelector(sel);

const views = {
  home: $("#view-home"),
  detail: $("#view-detail"),
  form: $("#view-form"),
  categories: $("#view-categories"),
  backup: $("#view-backup"),
};

const navButtons = Array.from(document.querySelectorAll("[data-route]"));

const state = {
  db: null,
  route: "home",
  recipes: [],
  categories: [],
  filterCategoryId: "all",
  search: "",
  currentRecipeId: null,
  formMode: "create", // create | edit
  pendingViewAfterSave: null, // detail | home
};

function uuid() {
  // crypto.randomUUID support is good in modern browsers, fallback otherwise
  if (crypto?.randomUUID) return crypto.randomUUID();
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

function nowISO() {
  return new Date().toISOString();
}

function clampNumber(n, min = 0) {
  const x = Number.isFinite(Number(n)) ? Number(n) : min;
  return Math.max(min, x);
}

async function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);

    req.onupgradeneeded = () => {
      const db = req.result;

      if (!db.objectStoreNames.contains(STORES.recipes)) {
        const store = db.createObjectStore(STORES.recipes, { keyPath: "id" });
        store.createIndex("by_name", "name", { unique: false });
        store.createIndex("by_categoryId", "categoryId", { unique: false });
        store.createIndex("by_updatedAt", "updatedAt", { unique: false });
      }

      if (!db.objectStoreNames.contains(STORES.categories)) {
        const store = db.createObjectStore(STORES.categories, { keyPath: "id" });
        store.createIndex("by_name", "name", { unique: true });
      }

      if (!db.objectStoreNames.contains(STORES.meta)) {
        db.createObjectStore(STORES.meta, { keyPath: "key" });
      }
    };

    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function tx(db, storeName, mode = "readonly") {
  return db.transaction(storeName, mode).objectStore(storeName);
}

async function idbGetAll(storeName) {
  return new Promise((resolve, reject) => {
    const store = tx(state.db, storeName, "readonly");
    const req = store.getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}

async function idbPut(storeName, value) {
  return new Promise((resolve, reject) => {
    const store = tx(state.db, storeName, "readwrite");
    const req = store.put(value);
    req.onsuccess = () => resolve(true);
    req.onerror = () => reject(req.error);
  });
}

async function idbDelete(storeName, key) {
  return new Promise((resolve, reject) => {
    const store = tx(state.db, storeName, "readwrite");
    const req = store.delete(key);
    req.onsuccess = () => resolve(true);
    req.onerror = () => reject(req.error);
  });
}

async function idbClear(storeName) {
  return new Promise((resolve, reject) => {
    const store = tx(state.db, storeName, "readwrite");
    const req = store.clear();
    req.onsuccess = () => resolve(true);
    req.onerror = () => reject(req.error);
  });
}

async function idbGet(storeName, key) {
  return new Promise((resolve, reject) => {
    const store = tx(state.db, storeName, "readonly");
    const req = store.get(key);
    req.onsuccess = () => resolve(req.result ?? null);
    req.onerror = () => reject(req.error);
  });
}

async function ensureSeedData() {
  const seeded = await idbGet(STORES.meta, "seeded");
  if (seeded?.value) return;

  const existingCats = await idbGetAll(STORES.categories);
  if (existingCats.length === 0) {
    for (const name of DEFAULT_CATEGORIES) {
      await idbPut(STORES.categories, { id: uuid(), name, createdAt: nowISO(), updatedAt: nowISO() });
    }
  }

  await idbPut(STORES.meta, { key: "seeded", value: true });
}

function setRoute(route, params = {}) {
  state.route = route;
  if (params.recipeId) state.currentRecipeId = params.recipeId;

  for (const [key, el] of Object.entries(views)) {
    el.classList.toggle("is-active", key === route);
  }
  for (const btn of navButtons) {
    btn.setAttribute("aria-current", btn.dataset.route === route ? "page" : "false");
  }

  // update hash for deep-link-ish navigation
  const hash = route === "detail" && state.currentRecipeId ? `#detail:${state.currentRecipeId}` : `#${route}`;
  if (location.hash !== hash) history.pushState({}, "", hash);

  render();
}

function parseHash() {
  const h = (location.hash || "").replace(/^#/, "");
  if (!h) return { route: "home" };
  if (h.startsWith("detail:")) return { route: "detail", recipeId: h.split(":")[1] };
  if (["home", "new", "form", "categories", "backup"].includes(h)) {
    if (h === "new") return { route: "form" };
    return { route: h === "form" ? "form" : h };
  }
  return { route: "home" };
}

function showConfirm({ title, message, danger = false, confirmText = "Confirmer" }) {
  const dialog = $("#confirmDialog");
  $("#confirmTitle").textContent = title;
  $("#confirmMessage").textContent = message;
  const ok = $("#confirmOkBtn");
  ok.textContent = confirmText;
  ok.classList.toggle("btn--danger", danger);

  return new Promise((resolve) => {
    const onClose = () => {
      dialog.removeEventListener("close", onClose);
      resolve(dialog.returnValue === "confirm");
    };
    dialog.addEventListener("close", onClose, { once: true });
    dialog.showModal();
  });
}

function escapeHtml(str) {
  return String(str || "").replace(/[&<>"']/g, (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m]));
}

function categoryNameById(id) {
  if (!id) return "—";
  const c = state.categories.find((x) => x.id === id);
  return c ? c.name : "—";
}

function formatMinutes(mins) {
  const m = clampNumber(mins, 0);
  return `${m} min`;
}

function recipeTotalTime(r) {
  return clampNumber(r.prepTime, 0) + clampNumber(r.cookTime, 0);
}

function getFilteredRecipes() {
  let list = [...state.recipes];

  // search
  if (state.search.trim()) {
    const q = state.search.trim().toLowerCase();
    list = list.filter((r) => (r.name || "").toLowerCase().includes(q));
  }

  // category
  if (state.filterCategoryId !== "all") {
    list = list.filter((r) => r.categoryId === state.filterCategoryId);
  }

  // sort
  list.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
  return list;
}

function renderHome() {
  const grid = $("#recipesGrid");
  const empty = $("#emptyState");

  const list = getFilteredRecipes();
  grid.innerHTML = "";

  if (list.length === 0) {
    empty.style.display = "block";
  } else {
    empty.style.display = "none";
  }

  for (const r of list) {
    const card = document.createElement("div");
    card.className = "card recipe";

    const hero = document.createElement("div");
    hero.className = "thumb";
    hero.innerHTML = `
      ${r.imageDataUrl ? `<img alt="${escapeHtml(r.name)}" src="${r.imageDataUrl}">` : ""}
      <div class="badge">${escapeHtml(categoryNameById(r.categoryId))}</div>
    `;

    const body = document.createElement("div");
    body.className = "recipe__body";
    body.innerHTML = `
      <h3 class="recipe__title">${escapeHtml(r.name)}</h3>
      <div class="recipe__meta">
        <span class="pill">⏱️ ${formatMinutes(recipeTotalTime(r))}</span>
        <span class="pill">👤 ${escapeHtml(r.servings ?? "—")} portions</span>
        <span class="pill">📌 ${escapeHtml(r.difficulty || "—")}</span>
      </div>
      <div class="recipe__actions">
        <button class="btn btn--primary" type="button">Voir</button>
        <button class="btn" type="button">Modifier</button>
      </div>
    `;

    const [btnView, btnEdit] = body.querySelectorAll("button");
    btnView.addEventListener("click", () => setRoute("detail", { recipeId: r.id }));
    btnEdit.addEventListener("click", async () => {
      await loadFormForEdit(r.id);
      setRoute("form");
    });

    card.addEventListener("dblclick", () => setRoute("detail", { recipeId: r.id }));

    card.appendChild(hero);
    card.appendChild(body);
    grid.appendChild(card);
  }
}

function renderDetail() {
  const wrap = $("#detailCard");
  const r = state.recipes.find((x) => x.id === state.currentRecipeId);

  if (!r) {
    wrap.innerHTML = `<div class="detail__body"><p class="muted">Recette introuvable.</p></div>`;
    return;
  }

  const ingredients = Array.isArray(r.ingredients) ? r.ingredients : [];
  const ingList = ingredients
    .filter((i) => (i.name || "").trim())
    .map((i) => `<li>${escapeHtml(i.name)} — ${escapeHtml(i.quantity ?? "")} ${escapeHtml(i.unit ?? "")}</li>`)
    .join("");

  wrap.innerHTML = `
    <div class="detail__hero">
      ${r.imageDataUrl ? `<img alt="${escapeHtml(r.name)}" src="${r.imageDataUrl}">` : ""}
    </div>
    <div class="detail__body">
      <div class="detail__title">
        <div>
          <h2>${escapeHtml(r.name)}</h2>
          <div class="muted tiny">Créée: ${escapeHtml(new Date(r.createdAt).toLocaleString())} • Modifiée: ${escapeHtml(new Date(r.updatedAt).toLocaleString())}</div>
        </div>
        <div class="pill">${escapeHtml(categoryNameById(r.categoryId))}</div>
      </div>

      ${r.description ? `<p class="pre">${escapeHtml(r.description)}</p>` : `<p class="muted">Aucune description.</p>`}

      <div class="detail__grid">
        <div class="detail__box">
          <h3>Infos</h3>
          <ul class="list">
            <li>Préparation: ${formatMinutes(r.prepTime)}</li>
            <li>Cuisson: ${formatMinutes(r.cookTime)}</li>
            <li>Total: ${formatMinutes(recipeTotalTime(r))}</li>
            <li>Portions: ${escapeHtml(r.servings ?? "—")}</li>
            <li>Difficulté: ${escapeHtml(r.difficulty || "—")}</li>
          </ul>
        </div>

        <div class="detail__box">
          <h3>Ingrédients</h3>
          ${ingList ? `<ul class="list">${ingList}</ul>` : `<p class="muted">Aucun ingrédient.</p>`}
        </div>

        <div class="detail__box" style="grid-column: span 12;">
          <h3>Instructions</h3>
          ${r.instructions ? `<div class="pre">${escapeHtml(r.instructions)}</div>` : `<p class="muted">Aucune instruction.</p>`}
        </div>
      </div>
    </div>
  `;
}

function setSelectOptions(selectEl, options, { includeAll = false, allLabel = "Toutes" } = {}) {
  selectEl.innerHTML = "";
  if (includeAll) {
    const opt = document.createElement("option");
    opt.value = "all";
    opt.textContent = allLabel;
    selectEl.appendChild(opt);
  }
  for (const o of options) {
    const opt = document.createElement("option");
    opt.value = o.id;
    opt.textContent = o.name;
    selectEl.appendChild(opt);
  }
}

function renderFilters() {
  const filter = $("#categoryFilter");
  setSelectOptions(filter, state.categories, { includeAll: true, allLabel: "Toutes les catégories" });
  filter.value = state.filterCategoryId || "all";
}

function renderCategorySelectInForm(selectedId) {
  const sel = $("#category");
  const options = [{ id: "", name: "— Aucune —" }, ...state.categories];
  setSelectOptions(sel, options, { includeAll: false });
  sel.value = selectedId ?? "";
}

function renderFormPhoto(dataUrl) {
  const img = $("#photoPreview");
  const empty = $("#photoPreviewEmpty");
  const remove = $("#removePhotoBtn");

  if (dataUrl) {
    img.src = dataUrl;
    img.style.display = "block";
    empty.style.display = "none";
    remove.style.display = "inline-flex";
  } else {
    img.removeAttribute("src");
    img.style.display = "none";
    empty.style.display = "block";
    remove.style.display = "none";
  }
}

function addIngredientRow({ name = "", quantity = "", unit = "" } = {}) {
  const list = $("#ingredientsList");
  const row = document.createElement("div");
  row.className = "ing";
  row.innerHTML = `
    <div class="field">
      <label>Nom</label>
      <input class="ing-name" placeholder="Ex: Farine" value="${escapeHtml(name)}" />
    </div>
    <div class="field">
      <label>Quantité</label>
      <input class="ing-qty" placeholder="Ex: 200" value="${escapeHtml(quantity)}" />
    </div>
    <div class="field">
      <label>Unité</label>
      <input class="ing-unit" placeholder="Ex: g" value="${escapeHtml(unit)}" />
    </div>
    <button type="button" class="btn btn--small btn--danger">Supprimer</button>
  `;
  row.querySelector("button").addEventListener("click", () => row.remove());
  list.appendChild(row);
}

function readIngredientsFromForm() {
  const rows = Array.from(document.querySelectorAll(".ing"));
  return rows.map((row) => ({
    name: row.querySelector(".ing-name").value.trim(),
    quantity: row.querySelector(".ing-qty").value.trim(),
    unit: row.querySelector(".ing-unit").value.trim(),
  }));
}

function clearFormIngredients() {
  $("#ingredientsList").innerHTML = "";
}

function setFormTimestamps(r) {
  const el = $("#timestamps");
  if (!r) {
    el.textContent = "";
    return;
  }
  el.textContent = `Créée: ${new Date(r.createdAt).toLocaleString()} • Modifiée: ${new Date(r.updatedAt).toLocaleString()}`;
}

function setFormMode(mode) {
  state.formMode = mode;
  $("#formTitle").textContent = mode === "edit" ? "Modifier la recette" : "Nouvelle recette";
  $("#formSubtitle").textContent = mode === "edit" ? "Modifie les champs puis enregistre." : "Tous les champs peuvent être modifiés plus tard.";
}

function resetForm() {
  $("#recipeId").value = "";
  $("#name").value = "";
  $("#description").value = "";
  $("#prepTime").value = 0;
  $("#cookTime").value = 0;
  $("#servings").value = 2;
  $("#difficulty").value = "facile";
  $("#instructions").value = "";
  $("#photo").value = "";
  $("#recipeForm").dataset.imageDataUrl = "";
  renderFormPhoto("");
  clearFormIngredients();
  addIngredientRow();
  renderCategorySelectInForm("");
  setFormTimestamps(null);
  setFormMode("create");
}

async function loadFormForEdit(id) {
  const r = state.recipes.find((x) => x.id === id);
  if (!r) return;

  $("#recipeId").value = r.id;
  $("#name").value = r.name ?? "";
  $("#description").value = r.description ?? "";
  $("#prepTime").value = clampNumber(r.prepTime, 0);
  $("#cookTime").value = clampNumber(r.cookTime, 0);
  $("#servings").value = clampNumber(r.servings ?? 2, 1);
  $("#difficulty").value = r.difficulty ?? "facile";
  $("#instructions").value = r.instructions ?? "";
  $("#photo").value = "";

  $("#recipeForm").dataset.imageDataUrl = r.imageDataUrl ?? "";
  renderFormPhoto(r.imageDataUrl ?? "");
  renderCategorySelectInForm(r.categoryId ?? "");

  clearFormIngredients();
  const ings = Array.isArray(r.ingredients) && r.ingredients.length ? r.ingredients : [{ name: "", quantity: "", unit: "" }];
  for (const i of ings) addIngredientRow(i);

  setFormTimestamps(r);
  setFormMode("edit");
}

async function refreshData() {
  state.categories = await idbGetAll(STORES.categories);
  state.categories.sort((a, b) => (a.name || "").localeCompare(b.name || "", "fr"));

  state.recipes = await idbGetAll(STORES.recipes);
}

function renderCategoriesAdmin() {
  const list = $("#categoriesList");
  list.innerHTML = "";

  for (const c of state.categories) {
    const usedCount = state.recipes.filter((r) => r.categoryId === c.id).length;

    const row = document.createElement("div");
    row.className = "cat";
    row.innerHTML = `
      <div>
        <div class="cat__name">${escapeHtml(c.name)}</div>
        <div class="muted tiny">${usedCount} recette(s)</div>
      </div>
      <button class="btn btn--small" type="button">Renommer</button>
      <button class="btn btn--small btn--danger" type="button">Supprimer</button>
    `;

    const [btnRename, btnDelete] = row.querySelectorAll("button");

    btnRename.addEventListener("click", async () => {
      const next = prompt("Nouveau nom de catégorie :", c.name);
      if (!next) return;

      const name = next.trim();
      if (!name) return;

      // Unique-ish check
      if (state.categories.some((x) => x.id !== c.id && x.name.toLowerCase() === name.toLowerCase())) {
        alert("Une catégorie avec ce nom existe déjà.");
        return;
      }

      const updated = { ...c, name, updatedAt: nowISO() };
      await idbPut(STORES.categories, updated);
      await bootRender();
    });

    btnDelete.addEventListener("click", async () => {
      if (usedCount > 0) {
        alert("Suppression impossible: cette catégorie est utilisée par des recettes.");
        return;
      }
      const ok = await showConfirm({
        title: "Supprimer la catégorie",
        message: `Supprimer "${c.name}" ?`,
        danger: true,
      });
      if (!ok) return;
      await idbDelete(STORES.categories, c.id);
      await bootRender();
    });

    list.appendChild(row);
  }
}

function renderBackup() {
  $("#importStatus").textContent = "";
}

function render() {
  // route-specific render
  if (state.route === "home") {
    renderFilters();
    renderHome();
  }
  if (state.route === "detail") renderDetail();
  if (state.route === "form") {
    // keep selects in sync
    const selected = $("#category").value;
    renderCategorySelectInForm(selected);
  }
  if (state.route === "categories") renderCategoriesAdmin();
  if (state.route === "backup") renderBackup();
}

async function bootRender() {
  await refreshData();
  // keep current filter stable if possible
  if (state.filterCategoryId !== "all" && !state.categories.some((c) => c.id === state.filterCategoryId)) {
    state.filterCategoryId = "all";
  }
  render();
}

async function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error);
    reader.onload = () => resolve(String(reader.result));
    reader.readAsDataURL(file);
  });
}

// --- Events

function bindEvents() {
  // Theme toggle
  const themeToggleBtn = $("#themeToggle");
  if (themeToggleBtn) {
    themeToggleBtn.addEventListener("click", toggleTheme);
  }

  // nav
  for (const btn of navButtons) {
    btn.addEventListener("click", async () => {
      const route = btn.dataset.route;
      if (route === "new") {
        resetForm();
        setRoute("form");
        return;
      }
      setRoute(route);
    });
  }

  $("#createRecipeBtn").addEventListener("click", () => {
    resetForm();
    setRoute("form");
  });
  $("#emptyCreateBtn").addEventListener("click", () => {
    resetForm();
    setRoute("form");
  });

  $("#backToListBtn").addEventListener("click", () => setRoute("home"));

  $("#editRecipeBtn").addEventListener("click", async () => {
    const id = state.currentRecipeId;
    await loadFormForEdit(id);
    setRoute("form");
  });

  $("#deleteRecipeBtn").addEventListener("click", async () => {
    const r = state.recipes.find((x) => x.id === state.currentRecipeId);
    if (!r) return;

    const ok = await showConfirm({
      title: "Supprimer la recette",
      message: `Supprimer "${r.name}" ? Cette action est irréversible.`,
      danger: true,
      confirmText: "Supprimer",
    });
    if (!ok) return;

    await idbDelete(STORES.recipes, r.id);
    state.currentRecipeId = null;
    await bootRender();
    setRoute("home");
  });

  $("#cancelFormBtn").addEventListener("click", () => {
    if (state.formMode === "edit" && $("#recipeId").value) {
      setRoute("detail", { recipeId: $("#recipeId").value });
    } else {
      setRoute("home");
    }
  });

  $("#addIngredientBtn").addEventListener("click", () => addIngredientRow());

  $("#photo").addEventListener("change", async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const dataUrl = await fileToDataUrl(file);
    $("#recipeForm").dataset.imageDataUrl = dataUrl;
    renderFormPhoto(dataUrl);
  });

  $("#removePhotoBtn").addEventListener("click", () => {
    $("#recipeForm").dataset.imageDataUrl = "";
    $("#photo").value = "";
    renderFormPhoto("");
  });

  $("#saveAndViewBtn").addEventListener("click", () => {
    state.pendingViewAfterSave = "detail";
    $("#recipeForm").requestSubmit();
  });

  $("#recipeForm").addEventListener("submit", async (e) => {
    e.preventDefault();

    const id = $("#recipeId").value || uuid();
    const mode = $("#recipeId").value ? "edit" : "create";

    const name = $("#name").value.trim();
    if (!name) {
      alert("Le nom de la recette est obligatoire.");
      $("#name").focus();
      return;
    }

    const recipe = {
      id,
      name,
      description: $("#description").value.trim(),
      prepTime: clampNumber($("#prepTime").value, 0),
      cookTime: clampNumber($("#cookTime").value, 0),
      servings: clampNumber($("#servings").value, 1),
      difficulty: $("#difficulty").value,
      categoryId: $("#category").value || "",
      imageDataUrl: $("#recipeForm").dataset.imageDataUrl || "",
      ingredients: readIngredientsFromForm(),
      instructions: $("#instructions").value.trim(),
      createdAt: mode === "edit" ? (state.recipes.find((r) => r.id === id)?.createdAt || nowISO()) : nowISO(),
      updatedAt: nowISO(),
    };

    await idbPut(STORES.recipes, recipe);
    await bootRender();

    state.pendingViewAfterSave = state.pendingViewAfterSave || null;
    const view = state.pendingViewAfterSave;
    state.pendingViewAfterSave = null;

    if (view === "detail") {
      state.currentRecipeId = id;
      setRoute("detail", { recipeId: id });
    } else {
      setRoute("home");
    }

    // keep form timestamps updated if we stay on form (not used here)
  });

  $("#searchInput").addEventListener("input", async (e) => {
    state.search = e.target.value || "";
    renderHome();
  });

  $("#categoryFilter").addEventListener("change", (e) => {
    state.filterCategoryId = e.target.value;
    renderHome();
  });

  // categories
  $("#categoryCreateForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const input = $("#newCategoryName");
    const name = (input.value || "").trim();
    if (!name) return;

    if (state.categories.some((c) => c.name.toLowerCase() === name.toLowerCase())) {
      alert("Cette catégorie existe déjà.");
      return;
    }

    await idbPut(STORES.categories, { id: uuid(), name, createdAt: nowISO(), updatedAt: nowISO() });
    input.value = "";
    await bootRender();
  });

  // backup
  $("#exportBtn").addEventListener("click", async () => {
    const data = await exportData();
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);

    const a = document.createElement("a");
    a.href = url;
    a.download = `recettes_backup_${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  });

  $("#importBtn").addEventListener("click", async () => {
    const file = $("#importFile").files?.[0];
    if (!file) {
      $("#importStatus").textContent = "Choisis un fichier JSON.";
      return;
    }

    try {
      const text = await file.text();
      const json = JSON.parse(text);
      const merge = $("#importMerge").checked;
      const result = await importData(json, { merge });
      $("#importStatus").textContent = `Import OK: ${result.recipes} recette(s), ${result.categories} catégorie(s).`;
      await bootRender();
      setRoute("home");
    } catch (err) {
      $("#importStatus").textContent = `Erreur import: ${err?.message || err}`;
    }
  });

  $("#resetBtn").addEventListener("click", async () => {
    const ok = await showConfirm({
      title: "Réinitialiser",
      message: "Supprimer toutes les recettes et catégories ?",
      danger: true,
      confirmText: "Tout supprimer",
    });
    if (!ok) return;

    await idbClear(STORES.recipes);
    await idbClear(STORES.categories);
    await idbPut(STORES.meta, { key: "seeded", value: false });
    await ensureSeedData();
    await bootRender();
    setRoute("home");
  });

  // hash / back
  window.addEventListener("popstate", async () => {
    const { route, recipeId } = parseHash();
    if (route === "detail" && recipeId) state.currentRecipeId = recipeId;
    if (route === "form") {
      // opening form via back: just show empty create form
      resetForm();
    }
    setRoute(route === "home" ? "home" : route, { recipeId });
  });
}

async function exportData() {
  const recipes = await idbGetAll(STORES.recipes);
  const categories = await idbGetAll(STORES.categories);

  return {
    schema: "recipe-app-backup-v1",
    exportedAt: nowISO(),
    recipes,
    categories,
  };
}

function validateImportPayload(payload) {
  if (!payload || typeof payload !== "object") throw new Error("JSON invalide.");
  if (!Array.isArray(payload.recipes) || !Array.isArray(payload.categories)) {
    throw new Error("Le JSON doit contenir recipes[] et categories[].");
  }
}

async function importData(payload, { merge = true } = {}) {
  validateImportPayload(payload);

  const incomingCategories = payload.categories.map((c) => ({
    id: c.id || uuid(),
    name: String(c.name || "").trim(),
    createdAt: c.createdAt || nowISO(),
    updatedAt: c.updatedAt || nowISO(),
  })).filter((c) => c.name);

  const incomingRecipes = payload.recipes.map((r) => ({
    id: r.id || uuid(),
    name: String(r.name || "").trim(),
    description: String(r.description || ""),
    prepTime: clampNumber(r.prepTime, 0),
    cookTime: clampNumber(r.cookTime, 0),
    servings: clampNumber(r.servings ?? 2, 1),
    difficulty: r.difficulty || "facile",
    categoryId: r.categoryId || "",
    imageDataUrl: r.imageDataUrl || "",
    ingredients: Array.isArray(r.ingredients) ? r.ingredients : [],
    instructions: String(r.instructions || ""),
    createdAt: r.createdAt || nowISO(),
    updatedAt: r.updatedAt || nowISO(),
  })).filter((r) => r.name);

  if (!merge) {
    await idbClear(STORES.recipes);
    await idbClear(STORES.categories);
  }

  // categories: avoid duplicates by name (case-insensitive) when merging
  if (merge) {
    const existing = await idbGetAll(STORES.categories);
    const existingByName = new Map(existing.map((c) => [c.name.toLowerCase(), c]));
    for (const c of incomingCategories) {
      const found = existingByName.get(c.name.toLowerCase());
      if (!found) await idbPut(STORES.categories, c);
    }
  } else {
    for (const c of incomingCategories) await idbPut(STORES.categories, c);
  }

  // recipes: upsert by id
  for (const r of incomingRecipes) await idbPut(STORES.recipes, r);

  return { recipes: incomingRecipes.length, categories: incomingCategories.length };
}

// --- Init
async function init() {
  state.db = await openDb();
  await ensureSeedData();
  await refreshData();

  bindEvents();

  // initial UI setup
  renderFilters();
  $("#searchInput").value = "";
  state.search = "";
  state.filterCategoryId = "all";

  // start on hash route if present
  const { route, recipeId } = parseHash();
  if (route === "detail" && recipeId) state.currentRecipeId = recipeId;
  if (route === "form") resetForm();
  setRoute(route === "home" ? "home" : route, { recipeId });

  // If no categories (edge), seed again
  if (state.categories.length === 0) {
    await ensureSeedData();
    await bootRender();
  }

  // If no recipes, show empty state
  renderHome();
}

init().catch((err) => {
  console.error(err);
  alert("Erreur au démarrage de l'application (IndexedDB). Voir la console.");
});