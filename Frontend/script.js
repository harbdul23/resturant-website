const API = ["5500", "5501"].includes(location.port) ? "http://localhost:5000" : "";
const page = document.body.dataset.page;
const $ = (id) => document.getElementById(id);
const money = (n) => "₦" + Number(n).toLocaleString();
const ICONS = { Burgers: "", Pizza: "🍕", Pasta: "🍝", Main: "🍗", Salads: "🥗", Desserts: "🍰", Local: "🍲", Drinks: "🥤", Sides: "🍟" };

function read(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key)) || fallback; } catch (e) { return fallback; }
}
function write(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) {}
}

let menuItems = [];
let cart = read("savora_cart", []);
let orderType = "pickup";
let deliveryFee = 1000;
let whatsappNumber = "2348141339830";
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
let auth = read("savora_auth", null);
const authHeaders = () => (auth ? { Authorization: "Bearer " + auth.token } : {});

/* Cart and orders panels are added to every page here, outside the navbar */
document.body.insertAdjacentHTML("beforeend", `
  <div id="cart-overlay" onclick="closePanels()"></div>

  <aside id="cart-panel">
    <div class="cart-header">
      <h3>Your Order</h3>
      <div class="header-actions">
        <button onclick="openOrders()">My Orders</button>
        <button onclick="closePanels()">✕</button>
      </div>
    </div>
    <div id="cart-items"></div>
    <div class="cart-footer">
      <input id="cust-name" placeholder="Your name" autocomplete="name">
      <input id="cust-phone" placeholder="Phone number" inputmode="tel" autocomplete="tel">
      <div class="type-toggle">
        <button type="button" id="type-pickup" class="active" onclick="setOrderType('pickup')">Pickup</button>
        <button type="button" id="type-delivery" onclick="setOrderType('delivery')">Delivery</button>
      </div>
      <textarea id="cust-address" placeholder="Delivery address" rows="2" maxlength="200" hidden></textarea>
      <input id="cust-note" placeholder="Note for the kitchen (optional)" maxlength="300">
      <div class="cart-line" id="fee-line" hidden><span>Delivery fee</span><strong id="cart-fee">₦0</strong></div>
      <div class="cart-total"><span>Total</span><strong id="cart-total">₦0</strong></div>
      <button class="place-btn" onclick="placeOrder()">Place Order</button>
    </div>
  </aside>

  <aside id="orders-panel">
    <div class="cart-header">
      <h3>My Orders</h3>
      <div class="header-actions">
        <button onclick="openCart()">Back to cart</button>
        <button onclick="closePanels()">✕</button>
      </div>
    </div>
    <div id="orders-list"></div>
  </aside>
`);

/* SCROLL ANIMATIONS (sections fade in as you reach them) */

const REVEAL_SELECTOR = ".hero-content, .section-heading, .about-content, .faq-list details, .contact-section > *, .page-hero > *, .legal-card, .auth-card, .food-card:not(.skeleton-card)";
let revealObserver = null;

function revealOnScroll(root = document) {
  if (!("IntersectionObserver" in window)) return;
  if (window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  if (!revealObserver) {
    revealObserver = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        const el = entry.target;
        revealObserver.unobserve(el);
        el.classList.add("in-view");
        setTimeout(() => { el.classList.remove("reveal", "in-view"); el.style.transitionDelay = ""; }, 1000);
      });
    }, { threshold: 0.12 });
  }
  root.querySelectorAll(REVEAL_SELECTOR).forEach((el, i) => {
    if (el.dataset.revealed) return;
    el.dataset.revealed = "1";
    if (el.getBoundingClientRect().top < window.innerHeight) return;   // already on screen, no animation
    el.style.transitionDelay = (i % 6) * 70 + "ms";
    el.classList.add("reveal");
    revealObserver.observe(el);
  });
}

/* TOAST MESSAGES */

function toast(message, type = "info") {
  let box = $("toast-box");
  if (!box) {
    document.body.insertAdjacentHTML("beforeend", '<div id="toast-box" aria-live="polite"></div>');
    box = $("toast-box");
  }
  const el = document.createElement("div");
  el.className = "toast " + type;
  el.textContent = message;
  box.appendChild(el);
  setTimeout(() => el.classList.add("hide"), 3200);
  setTimeout(() => el.remove(), 3700);
}

/* MOBILE MENU BUTTON */

(function () {
  const bar = document.querySelector(".navbar");
  const links = bar && bar.querySelector(".nav-links");
  if (!links) return;
  const btn = document.createElement("button");
  btn.className = "menu-toggle";
  btn.setAttribute("aria-label", "Open menu");
  btn.textContent = "☰";
  btn.onclick = () => {
    const open = links.classList.toggle("open");
    btn.textContent = open ? "✕" : "☰";
  };
  links.addEventListener("click", (e) => {
    if (e.target.tagName === "A") { links.classList.remove("open"); btn.textContent = "☰"; }
  });
  bar.appendChild(btn);
})();

/* FLOATING CART BAR (phones) */

document.body.insertAdjacentHTML("beforeend", '<button id="cart-bar" class="cart-bar" hidden onclick="openCart()"></button>');

function refreshCartBar() {
  const bar = $("cart-bar");
  if (!bar) return;
  if (cart.length === 0) { bar.hidden = true; return; }
  const total = cart.reduce((sum, id) => {
    const f = menuItems.find((x) => x.id === id);
    return sum + (f ? f.price : 0);
  }, 0);
  bar.innerHTML = `<span>🛒 ${cart.length} item${cart.length > 1 ? "s" : ""}${total ? " · " + money(total) : ""}</span><strong>View order →</strong>`;
  bar.hidden = false;
}

/* SITE FOOTER (the same on every page) */

document.querySelectorAll("footer").forEach((f) => f.remove());
document.body.insertAdjacentHTML("beforeend", `
  <footer class="site-footer">
    <div class="footer-grid">
      <div>
        <div class="footer-logo">SAVORA</div>
        <p>Fresh ingredients, beautiful flavors and meals made for you.</p>
        <a class="footer-reserve" href="reserve.html">Reserve a table</a>
      </div>
      <div>
        <h4>EXPLORE</h4>
        <a href="index.html#home">Home</a>
        <a href="menu.html">Full menu</a>
        <a href="reserve.html">Reserve a table</a>
        <a href="index.html#about">Our story</a>
        <a href="index.html#faq">FAQ</a>
        <a href="index.html#contact">Contact</a>
      </div>
      <div>
        <h4>VISIT US</h4>
        <p>No. 24, Kunle Thompson Street, Dada Estate, Osogbo, Osun State</p>
        <p class="open-hours"></p>
        <a href="tel:+2348141339830">+234 814 133 9830</a>
        <a href="mailto:Opeyemiabdulrahman23@gmail.com">Opeyemiabdulrahman23@gmail.com</a>
        <a href="https://wa.me/2348141339830" target="_blank" rel="noopener">Chat on WhatsApp</a>
      </div>
      <div>
        <h4>LEGAL</h4>
        <a href="privacy.html">Privacy Policy</a>
        <a href="terms.html">Terms of Service</a>
      </div>
    </div>
    <div class="footer-bottom">© 2026 Savora Restaurant, Osogbo. All rights reserved.</div>
  </footer>
`);

/* OPENING HOURS */

let openHours = { open: "08:00", close: "22:00" };

const fmt12 = (hhmm) => {
  const [h, m] = hhmm.split(":").map(Number);
  return ((h + 11) % 12 + 1) + ":" + String(m).padStart(2, "0") + (h % 24 < 12 ? " AM" : " PM");
};

function lagosMinutes() {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: "Africa/Lagos", hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(new Date());
  const get = (t) => Number(parts.find((p) => p.type === t).value);
  return (get("hour") % 24) * 60 + get("minute");
}

function updateOpenBadge() {
  const toMin = (s) => { const [h, m] = s.split(":").map(Number); return h * 60 + m; };
  const now = lagosMinutes();
  const isOpen = now >= toMin(openHours.open) && now < toMin(openHours.close);
  document.querySelectorAll(".open-badge").forEach((el) => {
    el.className = "open-badge " + (isOpen ? "is-open" : "is-closed");
    el.textContent = isOpen ? "Open now · until " + fmt12(openHours.close) : "Closed now · opens " + fmt12(openHours.open);
  });
  document.querySelectorAll(".open-hours").forEach((el) => {
    el.textContent = "Open daily " + fmt12(openHours.open) + " – " + fmt12(openHours.close);
  });
}

/* DISH POP-UP */

document.body.insertAdjacentHTML("beforeend", `
  <div id="dish-modal" class="dish-modal" hidden onclick="if (event.target === this) closeDish()">
    <div class="dish-box">
      <button class="dish-close" onclick="closeDish()" aria-label="Close">✕</button>
      <div id="dish-body"></div>
    </div>
  </div>
`);

function openDish(id) {
  const f = menuItems.find((x) => x.id === id);
  if (!f) return;
  $("dish-body").innerHTML = `
    ${f.image
      ? `<img class="dish-img" src="${f.image}" alt="${f.name}">`
      : `<div class="dish-img food-emoji">${ICONS[f.category] || "🍽"}</div>`}
    <div class="dish-info">
      <h3>${f.name} ${f.popular ? '<span class="badge-inline">Popular</span>' : ""}</h3>
      <p class="dish-cat">${f.category}</p>
      <p>${f.description}</p>
      <div class="food-bottom">
        <span class="food-price">${money(f.price)}</span>
        <button class="add-button" onclick="addToCart(${f.id}); closeDish()">Add to order</button>
      </div>
    </div>`;
  $("dish-modal").hidden = false;
}

function closeDish() { $("dish-modal").hidden = true; }
document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeDish(); });

/* MENU */

async function loadMenu() {
  const box = $("menu-container");
  if (!box) return;
  box.innerHTML = Array.from({ length: 6 }, () => `
    <article class="food-card skeleton-card">
      <div class="sk sk-img"></div>
      <div class="food-info"><div class="sk sk-line w60"></div><div class="sk sk-line"></div><div class="sk sk-line w40"></div></div>
    </article>`).join("");
  setTimeout(() => {
    if (box.querySelector(".skeleton-card")) {
      box.insertAdjacentHTML("afterbegin", '<p class="sk-note">Warming up the kitchen... the first visit can take up to a minute.</p>');
    }
  }, 6000);
  try {
    const response = await fetch(API + "/api/menu");
    menuItems = await response.json();
    if (page === "menu") {
      renderFilters();
      displayMenu(menuItems);
    } else {
      displayMenu(menuItems.slice(0, 6));
    }
    renderCart();
  } catch (error) {
    box.innerHTML = "<p class='cart-empty'>Unable to connect to the restaurant server.</p>";
  }
}

function displayMenu(list) {
  const box = $("menu-container");
  if (!list.length) {
    box.innerHTML = "<p class='cart-empty'>No dishes match your search.</p>";
    return;
  }
  box.innerHTML = list.map((f) => `
    <article class="food-card" onclick="openDish(${f.id})">
      ${f.popular ? '<span class="badge">Popular</span>' : ""}
      ${f.image
        ? `<img src="${f.image}" alt="${f.name}" data-cat="${f.category}">`
        : `<div class="food-emoji">${ICONS[f.category] || "🍽"}</div>`}
      <div class="food-info">
        <h3>${f.name}</h3>
        <p>${f.description}</p>
        <div class="food-bottom">
          <span class="food-price">${money(f.price)}</span>
          <button class="add-button" onclick="event.stopPropagation(); addToCart(${f.id})">Add</button>
        </div>
      </div>
    </article>`).join("");

  box.querySelectorAll("img").forEach((img) => {
    img.onerror = () => {
      img.outerHTML = `<div class="food-emoji">${ICONS[img.dataset.cat] || "🍽"}</div>`;
    };
  });
  revealOnScroll(box);
}

function renderFilters() {
  const box = $("filters");
  if (!box) return;
  const cats = ["All", ...new Set(menuItems.map((f) => f.category))];
  box.innerHTML = cats
    .map((c, i) => `<button class="filter-btn${i === 0 ? " active" : ""}" onclick="filterMenu('${c}', this)">${c}</button>`)
    .join("");
}

let currentCat = "All";
let currentQuery = "";

function applyFilters() {
  const q = currentQuery.trim().toLowerCase();
  displayMenu(menuItems.filter((f) =>
    (currentCat === "All" || f.category === currentCat) &&
    (!q || (f.name + " " + f.description + " " + f.category).toLowerCase().includes(q))));
}

function filterMenu(cat, btn) {
  document.querySelectorAll(".filter-btn").forEach((b) => b.classList.remove("active"));
  btn.classList.add("active");
  currentCat = cat;
  applyFilters();
}

function setQuery(value) {
  currentQuery = value;
  applyFilters();
}

/* CART */

function updateCart() {
  write("savora_cart", cart);
  $("cart-count").textContent = cart.length;
  renderCart();
}

function addToCart(id) {
  cart.push(id);
  updateCart();
  const f = menuItems.find((x) => x.id === id);
  toast(f ? `Added ${f.name} to your order` : "Added to your order", "success");
}
function addOne(id) { cart.push(id); updateCart(); }

function removeOne(id) {
  const i = cart.indexOf(id);
  if (i > -1) cart.splice(i, 1);
  updateCart();
}

function removeAll(id) {
  cart = cart.filter((x) => x !== id);
  updateCart();
}

function renderCart() {
  refreshCartBar();
  const box = $("cart-items");
  let total = 0;

  if (cart.length === 0) {
    box.innerHTML = "<p class='cart-empty'>Your order is empty. Add something from the menu.</p>";
    $("cart-total").textContent = money(0);
    return;
  }

  const counts = {};
  cart.forEach((id) => (counts[id] = (counts[id] || 0) + 1));

  box.innerHTML = Object.keys(counts).map((key) => {
    const id = Number(key);
    const food = menuItems.find((f) => f.id === id);
    if (!food) return "";
    const qty = counts[key];
    total += food.price * qty;
    const thumb = food.image
      ? `<img src="${food.image}" alt="${food.name}">`
      : `<div class="cart-emoji">${ICONS[food.category] || "🍽"}</div>`;
    return `
      <div class="cart-row">
        ${thumb}
        <div class="cart-info">
          <strong>${food.name}</strong>
          <span>${money(food.price * qty)}</span>
        </div>
        <div class="cart-qty">
          <button onclick="removeOne(${id})">−</button>
          <span>${qty}</span>
          <button onclick="addOne(${id})">+</button>
        </div>
        <button class="cart-remove" onclick="removeAll(${id})" aria-label="Remove ${food.name}">🗑</button>
      </div>`;
  }).join("");

  const fee = orderType === "delivery" ? deliveryFee : 0;
  $("cart-fee").textContent = money(fee);
  $("cart-total").textContent = money(total + fee);
}

function show(id) {
  ["cart-panel", "orders-panel"].forEach((p) => $(p).classList.remove("open"));
  $(id).classList.add("open");
  $("cart-overlay").classList.add("open");
}

function closePanels() {
  ["cart-panel", "orders-panel", "cart-overlay"].forEach((id) => $(id).classList.remove("open"));
}

function openCart() {
  renderCart();
  show("cart-panel");
}

function setOrderType(type) {
  orderType = type;
  $("type-pickup").classList.toggle("active", type === "pickup");
  $("type-delivery").classList.toggle("active", type === "delivery");
  $("cust-address").hidden = type !== "delivery";
  $("fee-line").hidden = type !== "delivery";
  renderCart();
}

function whatsappLink(o) {
  const lines = [
    `Hello Savora, I placed order #${o.id}:`,
    ...o.items.map((i) => `${i.quantity} × ${i.name}`),
    o.order_type === "delivery" ? `Delivery to: ${o.address}` : "Pickup",
    o.note ? `Note: ${o.note}` : null,
    `Total: ${money(o.total)}`,
  ].filter(Boolean);
  return "https://wa.me/" + whatsappNumber + "?text=" + encodeURIComponent(lines.join("\n"));
}

async function placeOrder() {
  if (cart.length === 0) return toast("Your order is empty. Add something from the menu first.");

  const customer_name = $("cust-name").value.trim();
  const phone = $("cust-phone").value.trim();
  if (!customer_name || !phone) return toast("Please enter your name and phone number.");
  const address = $("cust-address").value.trim();
  const note = $("cust-note").value.trim();
  if (orderType === "delivery" && address.length < 5) return toast("Please enter your delivery address.");

  try {
    const response = await fetch(API + "/api/orders", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders() },
      body: JSON.stringify({ customer_name, phone, cart, order_type: orderType, address, note }),
    });
    const data = await response.json();
    if (!response.ok) return toast(data.error, "error");

    saveOrderToken(data.token);
    $("cust-note").value = "";
    cart = [];
    updateCart();
    toast(`Order #${data.orderId} placed! Total: ${money(data.total)}`, "success");
    openOrders();
  } catch (error) {
    toast("Could not reach the server. Is it running?", "error");
  }
}

/* ORDER HISTORY */

function getOrderTokens() { return read("savora_orders", []); }

function saveOrderToken(token) {
  const saved = getOrderTokens();
  saved.push(token);
  write("savora_orders", saved);
}

async function openOrders() {
  show("orders-panel");
  const box = $("orders-list");
  const tokens = getOrderTokens();

  if (tokens.length === 0 && !auth) {
    box.innerHTML = "<p class='cart-empty'>You haven't placed any orders yet.</p>";
    return;
  }

  box.innerHTML = "<p class='cart-empty'>Loading your orders...</p>";

  try {
    const response = await fetch(API + "/api/orders/history", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders() },
      body: JSON.stringify({ tokens }),
    });
    const orders = await response.json();

    if (!Array.isArray(orders) || orders.length === 0) {
      box.innerHTML = "<p class='cart-empty'>No orders found.</p>";
      return;
    }

    box.innerHTML = orders.map((o) => `
      <div class="order-card">
        <div class="order-top">
          <strong>Order #${o.id}</strong>
          <span class="order-status s-${esc(o.status)}">${esc(o.status)}</span>
        </div>
        <small>${new Date(o.created_at.replace(" ", "T") + "Z").toLocaleString()}</small>
        <ul>${o.items.map((i) => `<li>${i.quantity} × ${i.name}</li>`).join("")}</ul>
        <p class="order-meta">${o.order_type === "delivery" ? "Delivery to: " + esc(o.address) + " (fee " + money(o.delivery_fee) + ")" : "Pickup"}${o.note ? "<br>Note: " + esc(o.note) : ""}</p>
        <strong>${money(o.total)}</strong>
        <a class="wa-btn" target="_blank" rel="noopener" href="${whatsappLink(o)}">Send this order on WhatsApp</a>
      </div>`).join("");
  } catch (error) {
    box.innerHTML = "<p class='cart-empty'>Could not load your orders. Is the server running?</p>";
  }
}

/* ACCOUNT */

async function logout() {
  try { await fetch(API + "/api/auth/logout", { method: "POST", headers: authHeaders() }); } catch (e) {}
  auth = null;
  try { localStorage.removeItem("savora_auth"); } catch (e) {}
  location.href = "index.html";
}

function setupAuth() {
  const link = $("auth-link");
  if (!auth || !link) return;
  link.textContent = "Log out (" + auth.user.name.split(" ")[0] + ")";
  link.href = "#";
  link.onclick = (e) => { e.preventDefault(); logout(); };
  $("cust-name").value = auth.user.name;
  $("cust-phone").value = auth.user.phone;
}

/* START */

fetch(API + "/api/config")
  .then((r) => r.json())
  .then((c) => { deliveryFee = c.deliveryFee; whatsappNumber = c.whatsapp; if (c.hours) openHours = c.hours; renderCart(); updateOpenBadge(); })
  .catch(() => {});

setupAuth();

$("cart-count").textContent = cart.length;
renderCart();
loadMenu();

updateOpenBadge();
setInterval(updateOpenBadge, 60000);
revealOnScroll();