const sqlite3 = require("sqlite3").verbose();
const path = require("path");

const dbPath = process.env.DB_PATH || path.join(__dirname, "savora.db");

const db = new sqlite3.Database(dbPath, (error) => {
    if (error) {
        console.error("Database connection failed:", error.message);
    } else {
        console.log("Connected to SQLite database.");
    }
});


/* MENU TABLE */

db.run(`
    CREATE TABLE IF NOT EXISTS menu (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        description TEXT NOT NULL,
        price INTEGER NOT NULL,
        category TEXT NOT NULL,
        image TEXT NOT NULL
    )
`, (error) => {
    if (error) {
        console.error("Menu table error:", error.message);
        return;
    }
    console.log("Menu table ready.");
    insertInitialMenu(insertExtraMenu);
});


/* STARTER MENU (only on an empty table, so there are no duplicates) */

function insertInitialMenu(done) {
    db.get("SELECT COUNT(*) AS count FROM menu", (error, row) => {
        if (error) {
            console.error(error.message);
            return;
        }
        if (row.count > 0) return done();

        const foods = [
            ["Classic Burger", "Juicy beef burger with fresh vegetables and our special sauce.", 6500, "Burgers",
                "https://images.unsplash.com/photo-1568901346375-23c9450c58cd"],
            ["Chicken Pizza", "Crispy pizza topped with chicken, cheese and fresh herbs.", 8500, "Pizza",
                "https://images.unsplash.com/photo-1565299624946-b28f40a0ae38"],
            ["Creamy Pasta", "Creamy pasta prepared with herbs, parmesan and fresh ingredients.", 7000, "Pasta",
                "https://images.unsplash.com/photo-1473093295043-cdd812d0e601"],
            ["Grilled Chicken", "Tender grilled chicken served with vegetables and our house sauce.", 9000, "Main",
                "https://images.unsplash.com/photo-1532550907401-a500c9a57435"],
            ["Fresh Salad", "Fresh vegetables with avocado and a light house dressing.", 4500, "Salads",
                "https://images.unsplash.com/photo-1512621776951-a57141f2eefd"],
            ["Chocolate Dessert", "Rich chocolate dessert finished with fresh berries.", 4000, "Desserts",
                "https://images.unsplash.com/photo-1578985545062-69928b1d9587"]
        ];

        const statement = db.prepare(
            "INSERT INTO menu (name, description, price, category, image) VALUES (?, ?, ?, ?, ?)"
        );

        foods.forEach((food) => {
            statement.run(food, (err) => {
                if (err) console.error("Food insertion error:", err.message);
            });
        });

        statement.finalize(() => {
            console.log("Initial menu added.");
            done();
        });
    });
}


/*
    EXTRA MENU ITEMS (for the full menu page)
    An item is added only if its name is not already in the table.
    Add a photo later by putting an image link in the last field.
*/

function insertExtraMenu() {
    const extras = [
        ["Jollof Rice & Chicken", "Smoky party jollof rice served with grilled chicken and fried plantain.", 6000, "Local", ""],
        ["Pounded Yam & Egusi", "Soft pounded yam with rich egusi soup and assorted meat.", 7500, "Local", ""],
        ["Asun Peppered Goat", "Spicy grilled goat meat tossed with onions and peppers.", 6500, "Local", ""],
        ["Suya Platter", "Thinly sliced beef suya with yaji spice, onions and tomatoes.", 5000, "Local", ""],
        ["Chapman", "Chilled citrus and cucumber drink, served over ice.", 2500, "Drinks", ""],
        ["Fresh Fruit Smoothie", "Blended seasonal fruits, served cold.", 3000, "Drinks", ""],
        ["Zobo Drink", "Chilled hibiscus drink with ginger and pineapple.", 1500, "Drinks", ""],
        ["Puff-Puff", "Soft, golden fried dough balls dusted lightly with sugar.", 2000, "Sides", ""],
        ["Fried Plantain", "Sweet ripe plantain fried until golden.", 1800, "Sides", ""]
    ];

    extras.forEach((food) => {
        db.run(
            `INSERT INTO menu (name, description, price, category, image)
             SELECT ?, ?, ?, ?, ?
             WHERE NOT EXISTS (SELECT 1 FROM menu WHERE name = ?)`,
            [...food, food[0]],
            (error) => {
                if (error) console.error("Extra menu error:", error.message);
            }
        );
    });
}


/* ORDERS TABLE */

db.run(`
    CREATE TABLE IF NOT EXISTS orders (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        customer_name TEXT NOT NULL,
        phone TEXT NOT NULL,
        items TEXT NOT NULL,
        total REAL NOT NULL,
        status TEXT DEFAULT 'pending',
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
    )
`, (error) => {
    if (error) {
        console.error("Orders table error:", error.message);
        return;
    }
    // Adds the token column if it is missing (the error is ignored if it already exists)
    db.run("ALTER TABLE orders ADD COLUMN token TEXT", () => {});
    db.run("ALTER TABLE orders ADD COLUMN user_id INTEGER", () => {});
});

/* ACCOUNTS */

db.run(`
    CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        phone TEXT NOT NULL UNIQUE,
        email TEXT UNIQUE,
        password_salt TEXT NOT NULL,
        password_hash TEXT NOT NULL,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
    )
`);

db.run(`
    CREATE TABLE IF NOT EXISTS sessions (
        token TEXT PRIMARY KEY,
        user_id INTEGER NOT NULL,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
    )
`);

module.exports = db;