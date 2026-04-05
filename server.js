const express = require("express");
const cors = require("cors");
const multer = require("multer");
const path = require("path");
const mysql = require("mysql2");
const fs = require("fs");
const { exec } = require("child_process");

const app = express();
const PORT = process.env.PORT || 5000;

if (!fs.existsSync("uploads")) fs.mkdirSync("uploads");
if (!fs.existsSync("uploads/videos")) fs.mkdirSync("uploads/videos", { recursive: true });
if (!fs.existsSync("frames")) fs.mkdirSync("frames");

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(express.static(path.join(__dirname, "public")));
app.use("/uploads", express.static("uploads"));
app.use("/frames", express.static("frames"));

app.get("/", (req, res) => {
  res.redirect("/login.html");
});

const db = mysql.createConnection({
  host: "junction.proxy.rlwy.net",
  user: "root",
  password: "uXLlzlUcfWYHaSXqVihQFxzhGnjcxbZR",
  database: "railway",
  port: 50160
});

db.connect(err => {
  if (err) console.error(err);
  else console.log("DB connected");
});

app.post("/login", (req, res) => {
  const { userid, pwd } = req.body;

  db.query(
    "SELECT * FROM users WHERE username=? AND password=?",
    [userid, pwd],
    (err, results) => {
      if (err) return res.send("DB error");
      if (results.length > 0) res.redirect("/index.html");
      else res.send("login fail");
    }
  );
});

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    if (file.mimetype.startsWith("image")) cb(null, "uploads/");
    else if (file.mimetype.startsWith("video")) cb(null, "uploads/videos/");
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, Date.now() + "-" + Math.round(Math.random() * 1e9) + ext);
  }
});

const upload = multer({ storage: storage });

app.post("/upload", upload.fields([
  { name: "images", maxCount: 5 },
  { name: "videos", maxCount: 2 }
]), (req, res) => {

  const description = req.body.description || "";

  const imageFiles = req.files["images"] || [];
  const videoFiles = req.files["videos"] || [];

  const imagePaths = imageFiles.map(f => f.filename).join(",");
  const videoPaths = videoFiles.map(f => "uploads/videos/" + f.filename);

  db.query(
    "INSERT INTO risks (zone_id, user_id, title, description, image_path, risk_level, status) VALUES (?, ?, ?, ?, ?, ?, ?)",
    [1, 1, "위험", description, imagePaths, 1, "미조치"],
    (err, result) => {
      if (err) {
        console.error(err);
        return res.send("DB fail");
      }

      videoPaths.forEach(videoPath => {
        exec(`python frame_extractor.py ${videoPath}`, (err, stdout, stderr) => {
          if (err) {
            console.error(err);
          } else {
            console.log(stdout);
          }
        });
      });

      res.send("ok");
    }
  );
});

app.listen(PORT, () => {
  console.log(`server running on port ${PORT}`);
});
