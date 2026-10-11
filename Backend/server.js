const express = require("express");
const cors = require("cors");
const crypto = require("crypto");
const path = require("path");

const db = require("./database");

const app = express();
const PORT = process.env.PORT || 5000;

app.set("trust proxy", 1);

/* MIDDLEWARE */

app.use(cors());
app.use(express.json());

// Serves the website itself (index.html, menu.html, ...)
app.use(express.static(path.join(__dirname, "../Frontend")));


/* API HOME */

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
        const total = items.reduce((sum, i) => sum + i.price * i.quantity, 0);
        const token = crypto.randomUUID();

        db.run(
            "INSERT INTO orders (customer_name, phone, items, total, token, user_id) VALUES (?, ?, ?, ?, ?, ?)",
            [customer_name, phone, JSON.stringify(items), total, token, user ? user.id : null],
            function (err) {
                if (err) {
                    console.error(err.message);
                    return res.status(500).json({ error: "Could not save order" });
                }
                res.status(201).json({ orderId: this.lastID, total, items, token });
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
            `SELECT id, items, total, status, created_at
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