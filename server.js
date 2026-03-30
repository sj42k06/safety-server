const express = require("express");
const cors = require("cors");
const multer = require("multer");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.get("/", (req, res) => {
  res.redirect("/login.html");
});

app.use(express.static(path.join(__dirname, "public")));
app.use("/uploads", express.static("uploads"));

const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, "uploads/");
  },
  filename: function (req, file, cb) {
    cb(null, Date.now() + "-" + file.originalname);
  }
});

const upload = multer({ storage: storage });

app.post("/login", (req, res) => {
  const { userid, pwd } = req.body;

  if (userid === "admin" && pwd === "1234") {
    res.redirect("/index.html");
  } else {
    res.send("<script>alert('로그인 실패'); location.href='/login.html'</script>");
  }
});

app.post("/upload", upload.single("image"), (req, res) => {
  res.redirect("/index.html");
});

app.listen(PORT, () => {
  console.log(`server running on port ${PORT}`);
});
