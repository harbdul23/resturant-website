const express = require("express");
const cors = require("cors");
const crypto = require("crypto");
const path = require("path");

const db = require("./database");

const app = express();
const PORT = process.env.PORT || 5000;
const DELIVERY_FEE = Number(process.env.DELIVERY_FEE) || 1000;   // naira, change in Render settings
const WHATSAPP_NUMBER = "2348141339830";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "";          // set this, never put it in the code
const STATUSES = ["pending", "preparing", "ready", "delivered", "cancelled"];
const RES_STATUSES = ["pending", "confirmed", "cancelled"];
const OPEN_TIME = "08:00";       // opening hours (every day), change to your real hours
const CLOSE_TIME = "22:00";
const LAST_BOOKING = "21:00";

app.set("trust proxy", 1);

/* MIDDLEWARE */

app.use(cors());
app.use(express.json());

// Serves the website itself (index.html, menu.html, ...)
app.use(express.static(path.join(__dirname, "../Frontend")));


/* API HOME */

app.get("/api/config", (req, res) => {
    res.json({ deliveryFee: DELIVERY_FEE, whatsapp: WHATSAPP_NUMBER, hours: { open: OPEN_TIME, close: CLOSE_TIME, lastBooking: LAST_BOOKING } });
});

app.get("/api", (req, res) => {
    res.json({ message: "Welcome to Savora Restaurant API", status: "running" });
});


/* MENU */

app.get("/api/menu", (req, res) => {
    db.all("SELECT * FROM menu ORDER BY id ASC", [], (error, rows) => {
        if (error) {
            console.error(error.message);
            return res.status(500).json({ error: "Unable to retrieve menu" });
        }
        res.json(rows);
    });
});

app.get("/api/menu/:id", (req, res) => {
    db.get("SELECT * FROM menu WHERE id = ?", [req.params.id], (error, row) => {
        if (error) return res.status(500).json({ error: "Database error" });
        if (!row) return res.status(404).json({ error: "Food item not found" });
        res.json(row);
    });
});


/* ACCOUNTS */

function hashPassword(password, salt = crypto.randomBytes(16).toString("hex")) {
    return { salt, hash: crypto.scryptSync(password, salt, 64).toString("hex") };
}

function getUser(req, callback) {
    const header = req.headers.authorization || "";
    const token = header.startsWith("Bearer ") ? header.slice(7) : "";
    if (!token) return callback(null);
    db.get(
        `SELECT users.id, users.name, users.phone, users.email
         FROM sessions JOIN users ON users.id = sessions.user_id
         WHERE sessions.token = ? AND sessions.created_at > datetime('now', '-30 days')`,
        [token],
        (error, row) => callback(error ? null : row || null)
    );
}

function startSession(user, res, status = 200) {
    const token = crypto.randomBytes(32).toString("hex");
    db.run("INSERT INTO sessions (token, user_id) VALUES (?, ?)", [token, user.id], (error) => {
        if (error) return res.status(500).json({ error: "Could not sign you in." });
        res.status(status).json({
            token,
            user: { id: user.id, name: user.name, phone: user.phone, email: user.email },
        });
    });
}

// Slows down password guessing: 20 sign-in attempts per 15 minutes per visitor
const attempts = {};
function tooManyAttempts(req) {
    const now = Date.now();
    attempts[req.ip] = (attempts[req.ip] || []).filter((t) => now - t < 15 * 60 * 1000);
    attempts[req.ip].push(now);
    return attempts[req.ip].length > 20;
}

app.post("/api/auth/register", (req, res) => {
    if (tooManyAttempts(req)) return res.status(429).json({ error: "Too many attempts. Try again in 15 minutes." });

    const name = String(req.body.name || "").trim();
    const phone = String(req.body.phone || "").replace(/[\s-]/g, "");
    const email = String(req.body.email || "").trim().toLowerCase();
    const password = String(req.body.password || "");

    if (name.length < 2) return res.status(400).json({ error: "Please enter your name." });
    if (!/^\+?\d{7,15}$/.test(phone)) return res.status(400).json({ error: "Enter a valid phone number, for example +2348012345678." });
    if (email && !/^\S+@\S+\.\S+$/.test(email)) return res.status(400).json({ error: "That email address doesn't look right." });
    if (password.length < 6) return res.status(400).json({ error: "Your password needs at least 6 characters." });
    if (req.body.agreed !== true) return res.status(400).json({ error: "Please agree to the terms to continue." });

    const { salt, hash } = hashPassword(password);
    db.run(
        "INSERT INTO users (name, phone, email, password_salt, password_hash) VALUES (?, ?, ?, ?, ?)",
        [name, phone, email || null, salt, hash],
        function (error) {
            if (error) {
                const taken = String(error.message).includes("UNIQUE");
                return res.status(taken ? 409 : 500).json({
                    error: taken
                        ? "An account with this phone number or email already exists. Try logging in."
                        : "Could not create your account.",
                });
            }
            startSession({ id: this.lastID, name, phone, email }, res, 201);
        }
    );
});

app.post("/api/auth/login", (req, res) => {
    if (tooManyAttempts(req)) return res.status(429).json({ error: "Too many attempts. Try again in 15 minutes." });

    const ident = String(req.body.identifier || "").trim().toLowerCase().replace(/[\s-]/g, "");
    const password = String(req.body.password || "");

    db.get("SELECT * FROM users WHERE phone = ? OR email = ?", [ident, ident], (error, user) => {
        const wrong = () => res.status(401).json({ error: "Wrong phone number, email or password." });
        if (error || !user) return wrong();
        const { hash } = hashPassword(password, user.password_salt);
        const same = crypto.timingSafeEqual(Buffer.from(hash, "hex"), Buffer.from(user.password_hash, "hex"));
        if (!same) return wrong();
        startSession(user, res);
    });
});

app.post("/api/auth/logout", (req, res) => {
    const header = req.headers.authorization || "";
    db.run("DELETE FROM sessions WHERE token = ?", [header.slice(7)], () => res.json({ ok: true }));
});


/* PLACE AN ORDER */

app.post("/api/orders", (req, res) => {
    getUser(req, (user) => saveOrder(req, res, user));
});

function saveOrder(req, res, user) {
    const { customer_name, phone, cart } = req.body;
    const order_type = req.body.order_type === "delivery" ? "delivery" : "pickup";
    const address = String(req.body.address || "").trim().slice(0, 200);
    const note = String(req.body.note || "").trim().slice(0, 300);

    if (order_type === "delivery" && address.length < 5) {
        return res.status(400).json({ error: "Please enter your delivery address." });
    }

    if (!customer_name || !phone || !Array.isArray(cart) || cart.length === 0) {
        return res.status(400).json({ error: "Name, phone and cart are required" });
    }

    const counts = {};
    cart.forEach((id) => (counts[id] = (counts[id] || 0) + 1));
    const ids = Object.keys(counts);
    const placeholders = ids.map(() => "?").join(",");

    // Prices always come from the database, never from the browser
    db.all(`SELECT id, name, price FROM menu WHERE id IN (${placeholders})`, ids, (error, foods) => {
        if (error) {
            console.error(error.message);
            return res.status(500).json({ error: "Could not process order" });
        }

        const items = foods.map((f) => ({
            id: f.id,
            name: f.name,
            price: f.price,
            quantity: counts[f.id],
        }));
        const subtotal = items.reduce((sum, i) => sum + i.price * i.quantity, 0);
        const delivery_fee = order_type === "delivery" ? DELIVERY_FEE : 0;
        const total = subtotal + delivery_fee;
        const token = crypto.randomUUID();

        db.run(
            "INSERT INTO orders (customer_name, phone, items, total, token, user_id, order_type, address, note, delivery_fee) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            [customer_name, phone, JSON.stringify(items), total, token, user ? user.id : null, order_type, address, note, delivery_fee],
            function (err) {
                if (err) {
                    console.error(err.message);
                    return res.status(500).json({ error: "Could not save order" });
                }
                res.status(201).json({ orderId: this.lastID, total, items, token, order_type, address, note, delivery_fee });
            }
        );
    });
}


/* ORDER HISTORY (this browser's orders, plus the logged-in account's orders) */

app.post("/api/orders/history", (req, res) => {
    const tokens = Array.isArray(req.body.tokens)
        ? req.body.tokens.filter((t) => typeof t === "string").slice(0, 50)
        : [];

    getUser(req, (user) => {
        if (tokens.length === 0 && !user) return res.json([]);

        const conditions = [];
        const params = [];
        if (tokens.length) {
            conditions.push(`token IN (${tokens.map(() => "?").join(",")})`);
            params.push(...tokens);
        }
        if (user) {
            conditions.push("user_id = ?");
            params.push(user.id);
        }

        db.all(
            `SELECT id, items, total, status, created_at, order_type, address, note, delivery_fee
             FROM orders WHERE ${conditions.join(" OR ")} ORDER BY id DESC`,
            params,
            (error, rows) => {
                if (error) {
                    console.error(error.message);
                    return res.status(500).json({ error: "Could not load orders" });
                }
                res.json(rows.map((r) => ({ ...r, items: JSON.parse(r.items) })));
            }
        );
    });
});


/* ADMIN DASHBOARD (the password comes from the ADMIN_PASSWORD setting) */

const adminTokens = new Map();   // login code -> expiry time (kept in memory, cleared on restart)

function isAdmin(req) {
    const match = (req.headers.authorization || "").match(/^Bearer (.+)$/);
    const expires = match && adminTokens.get(match[1]);
    return Boolean(expires && expires > Date.now());
}

app.post("/api/admin/login", (req, res) => {
    if (!ADMIN_PASSWORD) return res.status(503).json({ error: "The admin password has not been set on the server." });
    if (tooManyAttempts(req)) return res.status(429).json({ error: "Too many attempts. Try again later." });

    const given = crypto.createHash("sha256").update(String(req.body.password || "")).digest();
    const real = crypto.createHash("sha256").update(ADMIN_PASSWORD).digest();
    if (!crypto.timingSafeEqual(given, real)) return res.status(401).json({ error: "Wrong password." });

    const token = crypto.randomBytes(32).toString("hex");
    adminTokens.set(token, Date.now() + 12 * 60 * 60 * 1000);
    res.json({ token });
});

app.get("/api/admin/orders", (req, res) => {
    if (!isAdmin(req)) return res.status(401).json({ error: "Please log in again." });
    db.all(
        `SELECT id, customer_name, phone, items, total, status, order_type, address, note, delivery_fee, created_at
         FROM orders ORDER BY id DESC LIMIT 200`,
        [],
        (error, rows) => {
            if (error) {
                console.error(error.message);
                return res.status(500).json({ error: "Could not load orders" });
            }
            res.json(rows.map((r) => ({ ...r, items: JSON.parse(r.items) })));
        }
    );
});

app.post("/api/admin/orders/:id/status", (req, res) => {
    if (!isAdmin(req)) return res.status(401).json({ error: "Please log in again." });
    const status = String(req.body.status || "");
    if (!STATUSES.includes(status)) return res.status(400).json({ error: "Unknown status." });
    db.run("UPDATE orders SET status = ? WHERE id = ?", [status, req.params.id], function (error) {
        if (error) return res.status(500).json({ error: "Could not update the order." });
        if (this.changes === 0) return res.status(404).json({ error: "Order not found." });
        res.json({ ok: true });
    });
});


/* RESERVATIONS */

app.post("/api/reservations", (req, res) => {
    if (tooManyAttempts(req)) return res.status(429).json({ error: "Too many requests. Please try again later." });

    const name = String(req.body.name || "").trim().slice(0, 60);
    const phone = String(req.body.phone || "").trim().slice(0, 30);
    const date = String(req.body.date || "");
    const time = String(req.body.time || "");
    const guests = Number(req.body.guests);
    const note = String(req.body.note || "").trim().slice(0, 300);

    const today = new Date().toLocaleDateString("en-CA", { timeZone: "Africa/Lagos" });
    const nowTime = new Date().toLocaleTimeString("en-GB", { timeZone: "Africa/Lagos", hour: "2-digit", minute: "2-digit", hour12: false });

    if (!name || phone.length < 7) return res.status(400).json({ error: "Please enter your name and phone number." });
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || isNaN(Date.parse(date)) || date < today) {
        return res.status(400).json({ error: "Please choose today or a future date." });
    }
    if (!/^\d{2}:\d{2}$/.test(time) || time < OPEN_TIME || time > LAST_BOOKING) {
        return res.status(400).json({ error: `Bookings are between ${OPEN_TIME} and ${LAST_BOOKING}.` });
    }
    if (date === today && time < nowTime) return res.status(400).json({ error: "That time has already passed today." });
    if (!Number.isInteger(guests) || guests < 1 || guests > 20) {
        return res.status(400).json({ error: "Guests must be between 1 and 20. For bigger groups, please call us." });
    }

    db.run(
        "INSERT INTO reservations (name, phone, date, time, guests, note) VALUES (?, ?, ?, ?, ?, ?)",
        [name, phone, date, time, guests, note],
        function (error) {
            if (error) {
                console.error(error.message);
                return res.status(500).json({ error: "Could not save your reservation." });
            }
            res.status(201).json({ id: this.lastID });
        }
    );
});

app.get("/api/admin/reservations", (req, res) => {
    if (!isAdmin(req)) return res.status(401).json({ error: "Please log in again." });
    db.all(
        `SELECT id, name, phone, date, time, guests, note, status, created_at
         FROM reservations WHERE date >= date('now', '-1 day') ORDER BY date, time LIMIT 300`,
        [],
        (error, rows) => {
            if (error) return res.status(500).json({ error: "Could not load reservations" });
            res.json(rows);
        }
    );
});

app.post("/api/admin/reservations/:id/status", (req, res) => {
    if (!isAdmin(req)) return res.status(401).json({ error: "Please log in again." });
    const status = String(req.body.status || "");
    if (!RES_STATUSES.includes(status)) return res.status(400).json({ error: "Unknown status." });
    db.run("UPDATE reservations SET status = ? WHERE id = ?", [status, req.params.id], function (error) {
        if (error) return res.status(500).json({ error: "Could not update the reservation." });
        if (this.changes === 0) return res.status(404).json({ error: "Reservation not found." });
        res.json({ ok: true });
    });
});


/* START SERVER */

app.listen(PORT, () => {
    console.log(`
  🍽  SAVORA RESTAURANT

  Website and API running on:
  http://localhost:${PORT}

  Menu API:
  http://localhost:${PORT}/api/menu
  `);
});