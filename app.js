const express = require("express");
const path = require("path");
const cors = require("cors");
const { open } = require("sqlite");
const sqlite3 = require("sqlite3");
const app = express();
const axios = require("axios");
const port = process.env.PORT || 3000;
const dbPath = path.join(__dirname, "roxiler.db");
app.use(cors());

let db = null;

const initializeDBAndServer = async () => {
  try {
    db = await open({
      filename: dbPath,
      driver: sqlite3.Database,
    });

    const response = await axios.get(
      "https://s3.amazonaws.com/roxiler.com/product_transaction.json"
    );
    const data = response.data;

    await db.run(`CREATE TABLE IF NOT EXISTS transactions (
      id INTEGER PRIMARY KEY,
      title TEXT,
      price REAL,
      description TEXT,
      category TEXT,
      image TEXT,
      sold BOOLEAN,
      dateOfSale TEXT
    )`);

    const insertStmt = await db.prepare(
      "INSERT OR IGNORE INTO transactions (id, title, price, description, category, image, sold, dateOfSale) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
    );
    data.forEach(async (item) => {
      await insertStmt.run(
        item.id,
        item.title,
        item.price,
        item.description,
        item.category,
        item.image,
        item.sold,
        item.dateOfSale
      );
    });
    await insertStmt.finalize();
    app.listen(port, () => {
      console.log(`Server Running at http://localhost:${port}/`);
    });
  } catch (e) {
    console.error(`DB Error: ${e.message}`);
    process.exit(1);
  }
};

initializeDBAndServer();

const monthAbbreviationToNumeric = {
  Jan: "01",
  Feb: "02",
  Mar: "03",
  Apr: "04",
  May: "05",
  Jun: "06",
  Jul: "07",
  Aug: "08",
  Sep: "09",
  Oct: "10",
  Nov: "11",
  Dec: "12",
};

app.get("/transactions", async (req, res) => {
  try {
    const { page = 1, perPage = 10, search = "", month = "Mar" } = req.query;
    const offSet = (page - 1) * perPage;
    let query = `SELECT * FROM transactions`;

    if (search || month) {
      query += " WHERE";
      if (search) {
        query += ` (title LIKE '%${search}%' OR description LIKE '%${search}%' OR price LIKE '%${search}%')`;
        if (month) {
          query += " AND";
        }
      }
      if (month) {
        const numericMonth = monthAbbreviationToNumeric[month];
        if (numericMonth) {
          query += ` strftime('%m', dateOfSale) = '${numericMonth}'`;
        } else {
          res.status(400).json({ error: "Invalid month abbreviation" });
          return;
        }
      }
    }

    query += ` LIMIT ${perPage} OFFSET ${offSet}`;

    const transactions = await db.all(query);
    res.json(transactions);
  } catch (error) {
    console.error(error.message);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

app.get("/statistics", async (req, res) => {
  try {
    const { month = "Mar" } = req.query;
    const numericMonth = monthAbbreviationToNumeric[month];
    if (!numericMonth) {
      res.status(400).json({ error: "Invalid month abbreviation" });
      return;
    }
    const statistics = await db.get(
      'SELECT SUM(price) as totalSaleAmount, COUNT(*) as totalSoldItems, COUNT(CASE WHEN sold = 0 THEN 1 END) as totalNotSoldItems FROM transactions WHERE strftime("%m", dateOfSale) = ?',
      [numericMonth]
    );

    res.json(statistics);
  } catch (error) {
    console.error(error.message);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

app.get("/bar-chart", async (req, res) => {
  try {
    const { month } = req.query;

    const numericMonth = monthAbbreviationToNumeric[month];
    if (!numericMonth) {
      res.status(400).json({ error: "Invalid month abbreviation" });
      return;
    }

    // Define price ranges
    const priceRanges = [
      { min: 0, max: 100 },
      { min: 101, max: 200 },
      { min: 201, max: 300 },
      { min: 301, max: 400 },
      { min: 401, max: 500 },
      { min: 501, max: 600 },
      { min: 601, max: 700 },
      { min: 701, max: 800 },
      { min: 801, max: 900 },
      { min: 901, max: Number.MAX_SAFE_INTEGER },
    ];

    const result = {};

    for (const range of priceRanges) {
      const { min, max } = range;

      const count = await db.get(
        'SELECT COUNT(*) as itemCount FROM transactions WHERE strftime("%m", dateOfSale) = ? AND price >= ? AND price <= ?',
        [numericMonth, min, max]
      );

      result[`${min}-${max === Number.MAX_SAFE_INTEGER ? "above" : max}`] =
        count.itemCount;
    }

    res.json(result);
  } catch (error) {
    console.error(error.message);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

app.get("/pie-chart", async (req, res) => {
  try {
    const { month } = req.query;
    const numericMonth = monthAbbreviationToNumeric[month];
    if (!numericMonth) {
      res.status(400).json({ error: "Invalid month abbreviation" });
      return;
    }
    let query = `
      SELECT category, COUNT(*) as itemCount 
      FROM transactions 
      WHERE strftime('%m', dateOfSale) = ? 
      GROUP BY category
    `;

    let categoriesQuery = await db.all(query, [numericMonth]);

    const result = {};
    categoriesQuery.forEach(({ category, itemCount }) => {
      result[category] = itemCount;
    });

    res.json(result);
  } catch (error) {
    console.error(error.message);
    res.status(500).json({ error: "Internal server error" });
  }
});
