const express = require("express");
const multer = require("multer");
const path = require("path");
const fs = require("fs");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.urlencoded({ extended: true }));
app.use(express.static("public"));
app.use("/uploads", express.static("uploads"));

if (!fs.existsSync("uploads")) {
  fs.mkdirSync("uploads");
}

const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, "uploads/");
  },
  filename: function (req, file, cb) {
    cb(null, Date.now() + path.extname(file.originalname));
  }
});

const upload = multer({ storage });

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "login.html"));
});

app.post("/login", (req, res) => {
  const { id, pw } = req.body;

  if (id === "admin" && pw === "1234") {
    res.redirect("/upload.html");
  } else {
    res.send("아이디 또는 비밀번호 틀림");
  }
});

app.post("/upload", upload.single("video"), (req, res) => {
  const filePath = req.file.path;

  res.send(`
    <h2>업로드 완료</h2>
    <p>서버 정상 작동 중</p>
    <p>${filePath}</p>
  `);
});

app.listen(PORT, () => {
  console.log("server running on port " + PORT);
});
