"use strict";

const STORAGE_KEY = "papertrail-books-v1";

const PALETTE = [
  { name: "Rose", value: "#dba8a1" },
  { name: "Sage", value: "#a7b9a0" },
  { name: "Butter", value: "#d7bd8e" },
  { name: "Blue", value: "#a8b8cc" },
  { name: "Lilac", value: "#c4afd0" },
  { name: "Terracotta", value: "#bd8b72" },
  { name: "Forest", value: "#6e8278" },
  { name: "Plum", value: "#6d647b" }
];
const COLORS = PALETTE.map(c => c.value);

const STATUS_LABELS = {
  want: "Want to read",
  reading: "Reading now",
  finished: "Finished"
};
const STATUS_ORDER = Object.keys(STATUS_LABELS);

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

const bookModal = $("#bookModal");
const detailModal = $("#detailModal");
const bookForm = $("#bookForm");

let books = loadBooks();
let activeFilter = "all";
let selectedColor = COLORS[0];
let editingId = null;
let activeBookId = null;
let selectedRating = 0;
let toastTimer;

/* ---------- Helpers ---------- */

const createId = () =>
  crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;

const findBook = id => books.find(book => book.id === id);

function escapeHTML(value) {
  return String(value ?? "").replace(/[&<>"']/g, char => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[char]);
}

function safeImageURL(value) {
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) ? url.href : "";
  } catch {
    return "";
  }
}

const formatDate = iso => (iso ? new Date(iso).toLocaleDateString() : "");
const stars = rating => "★".repeat(rating) + "☆".repeat(5 - rating);

function averageOf(ratings) {
  return ratings.length
    ? (ratings.reduce((sum, r) => sum + r, 0) / ratings.length).toFixed(1)
    : null;
}

function showToast(message) {
  const toast = $("#toast");
  toast.textContent = message;
  toast.classList.add("visible");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove("visible"), 2800);
}

/* ---------- Storage ---------- */

function sanitizeBooks(list) {
  if (!Array.isArray(list)) return [];

  return list
    .filter(b => b && typeof b.id === "string" && typeof b.title === "string" && typeof b.author === "string")
    .map(b => ({
      ...b,
      color: COLORS.includes(b.color) ? b.color : COLORS[0],
      status: STATUS_LABELS[b.status] ? b.status : "want",
      reviews: Array.isArray(b.reviews)
        ? b.reviews.filter(r => Number.isInteger(r?.rating) && r.rating >= 1 && r.rating <= 5)
        : []
    }));
}

function loadBooks() {
  try {
    return sanitizeBooks(JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]"));
  } catch (error) {
    console.error("Could not load books:", error);
    return [];
  }
}

function saveBooks() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(books));
    return true;
  } catch (error) {
    console.error("Could not save books:", error);
    showToast("Couldn't save. Your browser storage may be full or blocked.");
    return false;
  }
}

// Runs a change and rolls it back if saving fails.
function commit(change) {
  const backup = structuredClone(books);
  change();
  if (saveBooks()) return true;
  books = backup;
  return false;
}

/* ---------- Modals ---------- */

function openModal(modal) {
  modal.hidden = false;
  document.body.style.overflow = "hidden";
}

function closeModal(modal) {
  modal.hidden = true;
  if (modal === bookModal) editingId = null;
  if (modal === detailModal) activeBookId = null;
  if (bookModal.hidden && detailModal.hidden) document.body.style.overflow = "";
}

function setColor(color) {
  selectedColor = color;
  $$(".color-swatch").forEach(swatch => {
    const chosen = swatch.dataset.color === color;
    swatch.classList.toggle("chosen", chosen);
    swatch.setAttribute("aria-pressed", String(chosen));
  });
}

function renderColorPicker() {
  $("#colorPicker").innerHTML = PALETTE.map(({ name, value }) => `
    <button type="button" class="color-swatch" data-color="${value}"
      style="--swatch:${value}" aria-label="${name}" aria-pressed="false"></button>`).join("");
  setColor(selectedColor);
}

// Opens the form empty (add) or filled in (edit).
function openBookForm(book = null) {
  editingId = book ? book.id : null;
  bookForm.reset();

  if (book) {
    bookForm.title.value = book.title;
    bookForm.author.value = book.author;
    bookForm.cover.value = book.cover || "";
    bookForm.description.value = book.description || "";
    bookForm.status.value = book.status;
  }

  setColor(book ? book.color : COLORS[0]);
  $("#modalTitle").textContent = book ? "Edit book" : "Add a book";
  $("#bookSubmit").textContent = book ? "Save changes" : "Add to shelf";

  openModal(bookModal);
  setTimeout(() => bookForm.title.focus(), 50);
}

/* ---------- Rendering ---------- */

function getVisibleBooks() {
  const query = $("#searchInput").value.trim().toLocaleLowerCase();

  return books.filter(book =>
    (activeFilter === "all" || book.status === activeFilter) &&
    `${book.title} ${book.author}`.toLocaleLowerCase().includes(query)
  ).sort(SORTERS[$("#sortSelect").value]);
}

function updateStats() {
  const ratings = books.flatMap(book => book.reviews.map(r => r.rating));
  const average = averageOf(ratings);

  $("#totalBooks").textContent = books.length;
  $("#finishedBooks").textContent = books.filter(b => b.status === "finished").length;
  $("#averageRating").innerHTML = average ? `${average} <span class="star">★</span>` : "–";
}

function renderBookshelf() {
  const shelf = $("#bookshelf");
  const visible = getVisibleBooks();
  const noBooksYet = books.length === 0;

  $("#shelfCount").textContent =
    visible.length === 1 ? "1 book" : `${visible.length} books`;

  if (!visible.length) {
    shelf.innerHTML = `
      <div class="empty-shelf">
        <h3>${noBooksYet ? "Your shelf is empty" : "No books match"}</h3>
        <p>${noBooksYet
          ? "Add the first book you own or want to read."
          : "Try a different search or filter."}</p>
        ${noBooksYet ? '<button class="btn" id="emptyAddButton" type="button">Add your first book</button>' : ""}
      </div>`;
    return;
  }

  shelf.innerHTML = visible.map((book, index) => {
    const cover = safeImageURL(book.cover);
    const label = `${escapeHTML(book.title)} by ${escapeHTML(book.author)}`;

    return `
      <article class="book" data-book-id="${escapeHTML(book.id)}" role="button" tabindex="0"
        aria-label="${label}, ${escapeHTML(STATUS_LABELS[book.status])}" title="${label}"
        style="background:${book.color};animation-delay:${Math.min(index * 35, 350)}ms">
        <span class="book-status-dot ${book.status}"></span>
        <div class="book-cover ${cover ? "has-image" : ""}">
          ${cover
            ? `<img src="${escapeHTML(cover)}" alt="" loading="lazy">`
            : `<span class="book-title">${escapeHTML(book.title)}</span>
               <span class="book-author">${escapeHTML(book.author)}</span>`}
        </div>
      </article>`;
  }).join("");
}

function renderReviews() {
  const container = $("#reviewList");
  const reviews = books
    .flatMap(book => book.reviews.map(review => ({ ...review, book })))
    .sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""));

  if (!reviews.length) {
    container.innerHTML = `
      <p class="reviews-empty">
        No reviews yet. Open a book on your shelf and write what you thought of it.
      </p>`;
    return;
  }

  container.innerHTML = reviews.map(({ book, rating, text, createdAt }) => {
    const cover = safeImageURL(book.cover);

    return `
      <article class="review-card">
        <div class="review-card-top">
          <div class="review-mini-cover" style="background:${book.color}">
            ${cover
              ? `<img src="${escapeHTML(cover)}" alt="" loading="lazy">`
              : escapeHTML(book.title.slice(0, 2))}
          </div>
          <div>
            <div class="review-book-title">${escapeHTML(book.title)}</div>
            <div class="review-book-author">${escapeHTML(book.author)}</div>
          </div>
        </div>
        <div class="review-stars" role="img" aria-label="${rating} out of 5 stars">${stars(rating)}</div>
        <p class="review-text">${escapeHTML(text)}</p>
        <div class="review-footer">
          <span class="review-date">${escapeHTML(formatDate(createdAt))}</span>
          <button class="small-action" data-open-book="${escapeHTML(book.id)}" type="button">Open book</button>
        </div>
      </article>`;
  }).join("");
}

function renderAll() {
  renderBookshelf();
  renderReviews();
  renderInsights();
  updateStats();
}

function renderExistingReviews(book) {
  if (!book.reviews.length) {
    return '<p class="muted">No reviews yet.</p>';
  }

  return book.reviews.map(review => `
    <article class="existing-review">
      <div class="review-stars" role="img" aria-label="${review.rating} out of 5 stars">${stars(review.rating)}</div>
      <p>${escapeHTML(review.text)}</p>
      <time>${escapeHTML(formatDate(review.createdAt))}</time>
      <button type="button" class="small-action" data-delete-review="${escapeHTML(review.id)}">Delete review</button>
    </article>`).join("");
}

function openBookDetails(id) {
  const book = findBook(id);
  if (!book) return;

  activeBookId = id;
  selectedRating = 0;

  const cover = safeImageURL(book.cover);
  const average = averageOf(book.reviews.map(r => r.rating));
  const reviewCount = book.reviews.length === 1 ? "1 review" : `${book.reviews.length} reviews`;

  $("#detailContent").innerHTML = `
    <div class="detail-layout">
      <div class="detail-cover" style="background:${book.color}">
        ${cover ? `<img src="${escapeHTML(cover)}" alt="Cover of ${escapeHTML(book.title)}">` : escapeHTML(book.title)}
      </div>
      <div class="detail-info">
        <h2 id="detailTitle">${escapeHTML(book.title)}</h2>
        <p class="muted">by ${escapeHTML(book.author)}</p>
        <div class="detail-meta">
          <span class="status-pill">${escapeHTML(STATUS_LABELS[book.status])}</span>
          ${average ? `<span class="status-pill">★ ${average} · ${reviewCount}</span>` : ""}
        </div>
      </div>
    </div>

    <p class="detail-description ${book.description ? "" : "muted"}">${
      book.description ? escapeHTML(book.description) : "No notes yet. Use “Edit book” to add some."
    }</p>

    <div class="detail-actions">
      <button type="button" id="editBookButton">Edit book</button>
      <button type="button" id="cycleStatusButton">Change status</button>
      <button type="button" class="delete-button" id="deleteBookButton">Remove book</button>
    </div>

    <hr class="detail-divider">

    <h3 class="detail-section-title">Write a review</h3>
    <div class="rating-input" role="group" aria-label="Your rating">
      ${[1, 2, 3, 4, 5].map(n =>
        `<button type="button" class="rating-star" data-rating="${n}" aria-label="${n} star${n > 1 ? "s" : ""}" aria-pressed="false">★</button>`
      ).join("")}
    </div>

    <form class="review-form" id="reviewForm">
      <label class="field-label" for="reviewText">What did you think?</label>
      <textarea id="reviewText" maxlength="2000" required placeholder="A sentence or two is plenty."></textarea>
      <button type="submit" class="btn btn-block">Save review</button>
    </form>

    <div class="existing-reviews">${renderExistingReviews(book)}</div>`;

  openModal(detailModal);
}

/* ---------- Actions ---------- */

function handleBookSubmit(event) {
  event.preventDefault();

  const data = new FormData(bookForm);
  const title = String(data.get("title") || "").trim();
  const author = String(data.get("author") || "").trim();
  const coverInput = String(data.get("cover") || "").trim();
  const cover = coverInput ? safeImageURL(coverInput) : "";

  if (!title || !author) {
    showToast("Please add both a title and an author.");
    return;
  }
  if (coverInput && !cover) {
    showToast("The cover link must start with http:// or https://");
    return;
  }

  const fields = {
    title,
    author,
    cover,
    description: String(data.get("description") || "").trim(),
    status: String(data.get("status") || "want"),
    color: selectedColor
  };

  if (editingId) {
    const id = editingId;
    if (!commit(() => stampFinished(Object.assign(findBook(id), fields)))) return;

    closeModal(bookModal);
    renderAll();
    openBookDetails(id);
    showToast("Changes saved.");
    return;
  }

  const book = { id: createId(), ...fields, reviews: [], createdAt: new Date().toISOString() };
  if (!commit(() => books.unshift(stampFinished(book)))) return;

  activeFilter = "all";
  $$(".filter-tab").forEach(tab => tab.classList.toggle("selected", tab.dataset.filter === "all"));
  $("#searchInput").value = "";

  closeModal(bookModal);
  renderAll();
  showToast(`Added “${book.title}” to your shelf.`);
}

function handleReviewSubmit(event) {
  event.preventDefault();

  const text = $("#reviewText").value.trim();
  if (!selectedRating) return showToast("Pick a star rating first.");
  if (!text) return showToast("Write a few words before saving.");

  const id = activeBookId;
  const review = { id: createId(), rating: selectedRating, text, createdAt: new Date().toISOString() };
  if (!commit(() => findBook(id).reviews.unshift(review))) return;

  renderAll();
  openBookDetails(id);
  showToast("Review saved.");
}

function deleteReview(reviewId) {
  const id = activeBookId;
  if (!confirm("Delete this review?")) return;

  const book = findBook(id);
  if (!commit(() => { book.reviews = book.reviews.filter(r => r.id !== reviewId); })) return;

  renderAll();
  openBookDetails(id);
  showToast("Review deleted.");
}

function deleteBook() {
  const book = findBook(activeBookId);
  if (!book || !confirm(`Remove “${book.title}” from your shelf?`)) return;

  const id = book.id;
  if (!commit(() => { books = books.filter(b => b.id !== id); })) return;

  closeModal(detailModal);
  renderAll();
  showToast("Book removed.");
}

function cycleBookStatus() {
  const id = activeBookId;
  const book = findBook(id);
  const next = STATUS_ORDER[(STATUS_ORDER.indexOf(book.status) + 1) % STATUS_ORDER.length];

  if (!commit(() => { book.status = next; stampFinished(book); })) return;

  renderAll();
  openBookDetails(id);
  showToast(`Status: ${STATUS_LABELS[next]}`);
}

function editActiveBook() {
  const book = findBook(activeBookId);
  if (!book) return;
  closeModal(detailModal);
  openBookForm(book);
}

/* ---------- Events ---------- */

bookForm.addEventListener("submit", handleBookSubmit);

$("#colorPicker").addEventListener("click", event => {
  const swatch = event.target.closest(".color-swatch");
  if (swatch) setColor(swatch.dataset.color);
});

document.addEventListener("click", event => {
  if (event.target.closest("#openAddModal, #addFromShelf, #emptyAddButton")) openBookForm();
});

$("#closeAddModal").addEventListener("click", () => closeModal(bookModal));
$("#closeDetailModal").addEventListener("click", () => closeModal(detailModal));

[bookModal, detailModal].forEach(modal =>
  modal.addEventListener("click", event => {
    if (event.target === modal) closeModal(modal);
  })
);

document.addEventListener("keydown", event => {
  if (event.key !== "Escape") return;
  closeModal(bookModal);
  closeModal(detailModal);
});

$$(".filter-tab").forEach(tab =>
  tab.addEventListener("click", () => {
    activeFilter = tab.dataset.filter;
    $$(".filter-tab").forEach(item => item.classList.toggle("selected", item === tab));
    renderBookshelf();
  })
);

$("#searchInput").addEventListener("input", renderBookshelf);

$("#bookshelf").addEventListener("click", event => {
  const book = event.target.closest("[data-book-id]");
  if (book) openBookDetails(book.dataset.bookId);
});

$("#bookshelf").addEventListener("keydown", event => {
  if (event.key !== "Enter" && event.key !== " ") return;
  const book = event.target.closest("[data-book-id]");
  if (!book) return;
  event.preventDefault();
  openBookDetails(book.dataset.bookId);
});

$("#reviewList").addEventListener("click", event => {
  const button = event.target.closest("[data-open-book]");
  if (button) openBookDetails(button.dataset.openBook);
});

$("#detailContent").addEventListener("click", event => {
  const target = event.target;
  const ratingButton = target.closest("[data-rating]");
  const deleteButton = target.closest("[data-delete-review]");

  if (ratingButton) {
    selectedRating = Number(ratingButton.dataset.rating);
    $$(".rating-star", $("#detailContent")).forEach(star => {
      const value = Number(star.dataset.rating);
      star.classList.toggle("selected", value <= selectedRating);
      star.setAttribute("aria-pressed", String(value === selectedRating));
    });
  } else if (deleteButton) {
    deleteReview(deleteButton.dataset.deleteReview);
  } else if (target.closest("#editBookButton")) {
    editActiveBook();
  } else if (target.closest("#deleteBookButton")) {
    deleteBook();
  } else if (target.closest("#cycleStatusButton")) {
    cycleBookStatus();
  }
});

$("#detailContent").addEventListener("submit", event => {
  if (event.target.id === "reviewForm") handleReviewSubmit(event);
});

/* ---------- Sorting, stats, theme, backup, lookup ---------- */

const GOAL_KEY = "papertrail-goal";
const THEME_KEY = "papertrail-theme";

const bookRating = book => Number(averageOf(book.reviews.map(r => r.rating))) || 0;

const SORTERS = {
  added: () => 0,
  title: (a, b) => a.title.localeCompare(b.title),
  author: (a, b) => a.author.localeCompare(b.author),
  rating: (a, b) => bookRating(b) - bookRating(a)
};

// Remembers when a book was first marked finished, for the stats.
function stampFinished(book) {
  if (book.status === "finished" && !book.finishedAt) book.finishedAt = new Date().toISOString();
  return book;
}

function getGoal() {
  try { return Number(localStorage.getItem(GOAL_KEY)) || 20; } catch { return 20; }
}

function renderInsights() {
  const year = new Date().getFullYear();
  const goal = getGoal();
  const finished = books.filter(b => b.finishedAt && new Date(b.finishedAt).getFullYear() === year);
  const perMonth = Array.from({ length: 12 }, (_, m) =>
    finished.filter(b => new Date(b.finishedAt).getMonth() === m).length);
  const maxMonth = Math.max(1, ...perMonth);
  const progress = Math.min(100, Math.round((finished.length / goal) * 100));

  $("#insightsGrid").innerHTML = `
    <article class="insight-card">
      <h3>${year} reading goal</h3>
      <p class="goal-line"><strong>${finished.length}</strong> of
        <label class="visually-hidden" for="goalInput">Books to read this year</label>
        <input id="goalInput" type="number" min="1" max="999" value="${goal}"> books</p>
      <div class="progress" role="img" aria-label="${progress}% of your goal"><span style="width:${progress}%"></span></div>
    </article>

    <article class="insight-card">
      <h3>Finished each month</h3>
      <div class="month-chart">
        ${perMonth.map((n, m) => `
          <div class="month-col">
            <span class="month-count">${n || ""}</span>
            <div class="month-bar" style="height:${(n / maxMonth) * 100}%"></div>
            <span class="month-name">${new Date(2000, m, 1).toLocaleString(undefined, { month: "narrow" })}</span>
          </div>`).join("")}
      </div>
    </article>

    <article class="insight-card">
      <h3>Shelf breakdown</h3>
      ${STATUS_ORDER.map(status => {
        const count = books.filter(b => b.status === status).length;
        const width = books.length ? (count / books.length) * 100 : 0;
        return `<div class="breakdown-row"><span>${STATUS_LABELS[status]}</span><div class="progress"><span style="width:${width}%"></span></div><strong>${count}</strong></div>`;
      }).join("")}
    </article>`;
}

$("#insightsGrid").addEventListener("change", event => {
  if (event.target.id !== "goalInput") return;
  const goal = Math.min(999, Math.max(1, Math.round(Number(event.target.value)) || 20));
  try { localStorage.setItem(GOAL_KEY, goal); } catch { /* storage unavailable */ }
  renderInsights();
});

$("#sortSelect").addEventListener("change", renderBookshelf);

function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
}

function initialTheme() {
  try {
    const saved = localStorage.getItem(THEME_KEY);
    if (saved) return saved;
  } catch { /* storage unavailable */ }
  return matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

$("#themeToggle").addEventListener("click", () => {
  const next = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
  applyTheme(next);
  try { localStorage.setItem(THEME_KEY, next); } catch { /* storage unavailable */ }
});

$("#exportButton").addEventListener("click", () => {
  if (!books.length) return showToast("Nothing to export yet.");
  const blob = new Blob([JSON.stringify(books, null, 2)], { type: "application/json" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = `papertrail-backup-${new Date().toISOString().slice(0, 10)}.json`;
  link.click();
  URL.revokeObjectURL(link.href);
});

$("#importButton").addEventListener("click", () => $("#importFile").click());

$("#importFile").addEventListener("change", async event => {
  const file = event.target.files[0];
  event.target.value = "";
  if (!file) return;

  try {
    const incoming = sanitizeBooks(JSON.parse(await file.text()));
    const known = new Set(books.map(b => b.id));
    const fresh = incoming.filter(b => !known.has(b.id));
    if (!fresh.length) return showToast("No new books found in that file.");
    if (!commit(() => { books.push(...fresh); })) return;
    renderAll();
    showToast(`Imported ${fresh.length} book${fresh.length > 1 ? "s" : ""}.`);
  } catch {
    showToast("That file isn't a valid papertrail backup.");
  }
});

$("#lookupButton").addEventListener("click", async event => {
  const button = event.currentTarget;
  const title = bookForm.title.value.trim();
  const author = bookForm.author.value.trim();
  if (!title) return showToast("Type a title first.");

  const params = new URLSearchParams({ title, limit: "1", fields: "title,author_name,cover_i" });
  if (author) params.set("author", author);

  button.disabled = true;
  button.textContent = "Searching…";

  try {
    const response = await fetch(`https://openlibrary.org/search.json?${params}`);
    if (!response.ok) throw new Error(response.status);
    const [match] = (await response.json()).docs;
    if (!match) return showToast("No match found. You can fill it in by hand.");

    if (!author && match.author_name) bookForm.author.value = match.author_name[0];
    if (!bookForm.cover.value.trim() && match.cover_i) {
      bookForm.cover.value = `https://covers.openlibrary.org/b/id/${match.cover_i}-L.jpg`;
    }
    showToast("Filled in what we found.");
  } catch {
    showToast("Couldn't reach Open Library. Check your connection.");
  } finally {
    button.disabled = false;
    button.textContent = "Find author and cover";
  }
});

applyTheme(initialTheme());
renderColorPicker();
renderAll();