const express = require("express");
const mysql = require("mysql2");
const multer = require("multer");
const path = require("path");
const app = express();
const port = process.env.PORT || 8080;

const db = mysql.createPool({
  host: process.env.MYSQLHOST,
  user: process.env.MYSQLUSER,
  password: process.env.MYSQLPASSWORD,
  database: process.env.MYSQLDATABASE,
  port: process.env.MYSQLPORT,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
});

app.use(express.json());
app.use(express.static("public"));

const upload = multer({ dest: "uploads/" });

app.post("/upload", upload.single("video"), (req, res) => {
  const { type, result, area } = req.body;
  const fileName = req.file ? req.file.filename : null;

  const sql = "INSERT INTO records (time, file, type, result, area) VALUES (NOW(), ?, ?, ?, ?)";
  const values = [fileName, type, result, area];

  db.query(sql, values, (err, data) => {
    if (err) {
      console.error(err);
      return res.status(500).send("DB Error");
    }
    res.send({ success: true });
  });
});

app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});
