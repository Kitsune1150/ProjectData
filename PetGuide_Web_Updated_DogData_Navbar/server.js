require("dotenv").config();

const express = require("express");
const fs = require("fs/promises");
const crypto = require("crypto");
const path = require("path");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { MongoClient, ObjectId } = require("mongodb");
const catBreeds = require("./data/cats.json");

const app = express();
const PORT = process.env.PORT || 3000;
const MONGODB_URI = process.env.MONGODB_URI || "mongodb://127.0.0.1:27017";
const DB_NAME = process.env.DB_NAME || "petguide";
const JWT_SECRET = process.env.JWT_SECRET || "dev_secret_change_me";

let db;

app.use(express.json({ limit: "7mb" }));
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, "public")));

function cleanPet(body) {
  return {
    name: String(body.name || "").trim(),
    scientificName: String(body.scientificName || "").trim(),
    category: String(body.category || "").trim(),
    description: String(body.description || "").trim(),
    characteristics: String(body.characteristics || "").trim(),
    personality: String(body.personality || "").trim(),
    difficulty: String(body.difficulty || "ง่าย").trim(),
    energy: String(body.energy || "ปานกลาง").trim(),
    size: String(body.size || "กลาง").trim(),
    grooming: String(body.grooming || "ปานกลาง").trim(),
    lifespan: String(body.lifespan || "").trim(),
    food: String(body.food || "").trim(),
    care: String(body.care || "").trim(),
    specialFeatures: String(body.specialFeatures || "").trim(),
    image: String(body.image || "").trim(),
    recommended: Boolean(body.recommended)
  };
}

function auth(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) return res.status(401).json({ message: "กรุณาเข้าสู่ระบบ" });

  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    return res.status(401).json({ message: "Token ไม่ถูกต้องหรือหมดอายุ" });
  }
}

function adminOnly(req, res, next) {
  if (req.user.role !== "admin") {
    return res.status(403).json({ message: "เฉพาะ Admin เท่านั้น" });
  }
  next();
}

app.post("/api/admin/upload-image", auth, adminOnly, async (req, res) => {
  const match = /^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(req.body.imageData || "");
  if (!match) return res.status(400).json({ message: "รองรับไฟล์ JPG, PNG หรือ WebP เท่านั้น" });

  const [, mimeType, encoded] = match;
  const imageBuffer = Buffer.from(encoded, "base64");
  if (imageBuffer.length > 5 * 1024 * 1024) {
    return res.status(413).json({ message: "รูปภาพต้องมีขนาดไม่เกิน 5 MB" });
  }

  const validSignature = mimeType === "jpeg"
    ? imageBuffer[0] === 0xff && imageBuffer[1] === 0xd8 && imageBuffer[2] === 0xff
    : mimeType === "png"
      ? imageBuffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
      : imageBuffer.toString("ascii", 0, 4) === "RIFF" && imageBuffer.toString("ascii", 8, 12) === "WEBP";
  if (!validSignature) return res.status(400).json({ message: "ชนิดไฟล์ไม่ตรงกับข้อมูลรูปภาพ" });

  const extension = mimeType === "jpeg" ? "jpg" : mimeType;
  const filename = `${crypto.randomBytes(16).toString("hex")}.${extension}`;
  const imageDirectory = path.join(__dirname, "public", "images");
  await fs.mkdir(imageDirectory, { recursive: true });
  await fs.writeFile(path.join(imageDirectory, filename), imageBuffer, { flag: "wx" });
  res.status(201).json({ image: `/images/${filename}` });
});

// ---------- Auth ----------
app.post("/api/auth/register", async (req, res) => {
  try {
    const { username, email, password } = req.body;
    if (!username || !email || !password) {
      return res.status(400).json({ message: "กรุณากรอกข้อมูลให้ครบ" });
    }
    if (password.length < 6) {
      return res.status(400).json({ message: "รหัสผ่านต้องมีอย่างน้อย 6 ตัวอักษร" });
    }

    const users = db.collection("users");
    const exists = await users.findOne({ email: email.toLowerCase().trim() });
    if (exists) return res.status(409).json({ message: "อีเมลนี้มีผู้ใช้แล้ว" });

    const passwordHash = await bcrypt.hash(password, 10);
    const result = await users.insertOne({
      username: username.trim(),
      email: email.toLowerCase().trim(),
      password: passwordHash,
      role: "user",
      createdAt: new Date()
    });

    res.status(201).json({ message: "สมัครสมาชิกสำเร็จ", id: result.insertedId });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "เกิดข้อผิดพลาดในระบบ" });
  }
});

app.post("/api/auth/login", async (req, res) => {
  try {
    const { email, password } = req.body;
    const user = await db.collection("users").findOne({ email: String(email || "").toLowerCase().trim() });
    if (!user || !(await bcrypt.compare(password || "", user.password))) {
      return res.status(401).json({ message: "อีเมลหรือรหัสผ่านไม่ถูกต้อง" });
    }

    const token = jwt.sign(
      { id: user._id.toString(), username: user.username, role: user.role },
      JWT_SECRET,
      { expiresIn: "2h" }
    );

    res.json({
      token,
      user: { id: user._id, username: user.username, email: user.email, role: user.role }
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "เกิดข้อผิดพลาดในระบบ" });
  }
});

app.get("/api/auth/me", auth, async (req, res) => {
  const user = await db.collection("users").findOne(
    { _id: new ObjectId(req.user.id) },
    { projection: { password: 0 } }
  );
  res.json(user);
});

// ---------- Categories ----------
app.get("/api/categories", async (req, res) => {
  const data = await db.collection("categories").find().sort({ name: 1 }).toArray();
  res.json(data);
});

app.post("/api/categories", auth, adminOnly, async (req, res) => {
  const name = String(req.body.name || "").trim();
  const description = String(req.body.description || "").trim();
  if (!name) return res.status(400).json({ message: "กรุณาระบุชื่อประเภท" });

  const result = await db.collection("categories").insertOne({
    name, description, createdAt: new Date()
  });
  res.status(201).json({ _id: result.insertedId, name, description });
});

app.put("/api/categories/:id", auth, adminOnly, async (req, res) => {
  const id = new ObjectId(req.params.id);
  await db.collection("categories").updateOne(
    { _id: id },
    {
      $set: {
        name: String(req.body.name || "").trim(),
        description: String(req.body.description || "").trim(),
        updatedAt: new Date()
      }
    }
  );
  res.json({ message: "แก้ไขประเภทสำเร็จ" });
});

app.delete("/api/categories/:id", auth, adminOnly, async (req, res) => {
  await db.collection("categories").deleteOne({ _id: new ObjectId(req.params.id) });
  res.json({ message: "ลบประเภทสำเร็จ" });
});

// ---------- Pets CRUD ----------
app.get("/api/pets", async (req, res) => {
  const filter = {};
  const { search, category, difficulty, size, energy } = req.query;

  if (search) {
    filter.$or = [
      { name: { $regex: search, $options: "i" } },
      { scientificName: { $regex: search, $options: "i" } },
      { description: { $regex: search, $options: "i" } }
    ];
  }
  if (category) filter.category = category;
  if (difficulty) filter.difficulty = difficulty;
  if (size) filter.size = size;
  if (energy) filter.energy = energy;

  const pets = await db.collection("pets").find(filter).sort({ createdAt: -1 }).toArray();
  res.json(pets);
});

app.get("/api/pets/recommended/list", async (req, res) => {
  const pets = await db.collection("pets").find({ recommended: true }).sort({ createdAt: -1 }).limit(8).toArray();
  res.json(pets);
});

app.get("/api/pets/:id", async (req, res) => {
  try {
    const pet = await db.collection("pets").findOne({ _id: new ObjectId(req.params.id) });
    if (!pet) return res.status(404).json({ message: "ไม่พบข้อมูลสัตว์" });
    res.json(pet);
  } catch {
    res.status(400).json({ message: "ID ไม่ถูกต้อง" });
  }
});

app.post("/api/pets", auth, adminOnly, async (req, res) => {
  const pet = cleanPet(req.body);
  if (!pet.name || !pet.category) {
    return res.status(400).json({ message: "กรุณาระบุชื่อและประเภทสัตว์" });
  }
  pet.createdAt = new Date();
  pet.updatedAt = new Date();

  const result = await db.collection("pets").insertOne(pet);
  res.status(201).json({ ...pet, _id: result.insertedId });
});

app.put("/api/pets/:id", auth, adminOnly, async (req, res) => {
  const pet = cleanPet(req.body);
  pet.updatedAt = new Date();

  const result = await db.collection("pets").updateOne(
    { _id: new ObjectId(req.params.id) },
    { $set: pet }
  );
  if (!result.matchedCount) return res.status(404).json({ message: "ไม่พบข้อมูลสัตว์" });
  res.json({ message: "แก้ไขข้อมูลสำเร็จ" });
});

app.delete("/api/pets/:id", auth, adminOnly, async (req, res) => {
  const result = await db.collection("pets").deleteOne({ _id: new ObjectId(req.params.id) });
  if (!result.deletedCount) return res.status(404).json({ message: "ไม่พบข้อมูลสัตว์" });
  await db.collection("favorites").deleteMany({ petId: req.params.id });
  res.json({ message: "ลบข้อมูลสำเร็จ" });
});

// ---------- Favorites ----------
app.get("/api/favorites", auth, async (req, res) => {
  const rows = await db.collection("favorites").find({ userId: req.user.id }).toArray();
  const ids = rows.map(x => {
    try { return new ObjectId(x.petId); } catch { return null; }
  }).filter(Boolean);

  const pets = await db.collection("pets").find({ _id: { $in: ids } }).toArray();
  res.json(pets);
});

app.post("/api/favorites/:petId", auth, async (req, res) => {
  const petId = req.params.petId;
  const pet = await db.collection("pets").findOne({ _id: new ObjectId(petId) });
  if (!pet) return res.status(404).json({ message: "ไม่พบสัตว์" });

  await db.collection("favorites").updateOne(
    { userId: req.user.id, petId },
    { $setOnInsert: { userId: req.user.id, petId, createdAt: new Date() } },
    { upsert: true }
  );
  res.json({ message: "เพิ่มรายการโปรดแล้ว" });
});

app.delete("/api/favorites/:petId", auth, async (req, res) => {
  await db.collection("favorites").deleteOne({ userId: req.user.id, petId: req.params.petId });
  res.json({ message: "นำออกจากรายการโปรดแล้ว" });
});

// ---------- Comments ----------
app.get("/api/pets/:id/comments", async (req, res) => {
  const comments = await db.collection("comments")
    .find({ petId: req.params.id })
    .sort({ createdAt: -1 })
    .toArray();
  res.json(comments);
});

app.post("/api/pets/:id/comments", auth, async (req, res) => {
  const text = String(req.body.comment || "").trim();
  if (!text) return res.status(400).json({ message: "กรุณาเขียนความคิดเห็น" });

  const doc = {
    petId: req.params.id,
    userId: req.user.id,
    username: req.user.username,
    comment: text,
    rating: Math.min(5, Math.max(1, Number(req.body.rating) || 5)),
    createdAt: new Date()
  };
  const result = await db.collection("comments").insertOne(doc);
  res.status(201).json({ ...doc, _id: result.insertedId });
});

// ---------- Admin ----------
app.get("/api/admin/stats", auth, adminOnly, async (req, res) => {
  const [pets, categories, users, comments] = await Promise.all([
    db.collection("pets").countDocuments(),
    db.collection("categories").countDocuments(),
    db.collection("users").countDocuments(),
    db.collection("comments").countDocuments()
  ]);
  res.json({ pets, categories, users, comments });
});

const samplePets = [
  {
    "name": "ไทยบางแก้ว",
    "scientificName": "Thai Bangkaew",
    "category": "สุนัข",
    "description": "ลำตัวทรงสี่เหลี่ยม อกลึก หางเป็นพุ่มม้วนขึ้น กะโหลกหนา หูตั้งเป็นรูปสามเหลี่ยม",
    "characteristics": "ลำตัวทรงสี่เหลี่ยม อกลึก หางเป็นพุ่มม้วนขึ้น กะโหลกหนา หูตั้งเป็นรูปสามเหลี่ยม",
    "personality": "ฉลาด ตื่นตัวสูง หวงถิ่นฐาน มีสัญชาตญาณเฝ้าบ้านและอารักขาดีเยี่ยม",
    "difficulty": "ปานกลาง",
    "energy": "ไม่ระบุในเอกสาร",
    "size": "กลาง",
    "grooming": "ปานกลางถึงสูง (ต้องการการออกกำลังกาย ฝึกวินัย และแปรงขนสัปดาห์ละ 2-3 ครั้ง)",
    "lifespan": "10 – 12 ปี",
    "food": "",
    "care": "ปานกลางถึงสูง (ต้องการการออกกำลังกาย ฝึกวินัย และแปรงขนสัปดาห์ละ 2-3 ครั้ง)",
    "specialFeatures": "ขนสองชั้น หนา สั้นถึงปานกลาง มีแผงคอคล้ายสิงโต",
    "image": "",
    "recommended": false,
    "coat": "ขนสองชั้น หนา สั้นถึงปานกลาง มีแผงคอคล้ายสิงโต",
    "friendliness": "ปานกลาง (ซื่อสัตย์และหวงเจ้าของมาก แต่ระแวงคนแปลกหน้า)",
    "beginnerSuitable": "ไม่เหมาะ (ต้องการเจ้าของที่มีความเป็นผู้นำและจ่าฝูงสูง)",
    "healthIssues": "โรคข้อสะโพกเสื่อม, โรคตาสืบสายพันธุ์, โรคผิวหนังอักเสบจากความอับชื้น",
    "monthlyCost": "ประมาณ 2,000 – 3,500 บาท"
  },
  {
    "name": "เชทแลนด์ ชีพด็อก",
    "scientificName": "Shetland Sheepdog",
    "category": "สุนัข",
    "description": "คล้ายคอลลี่ขนาดย่อส่วน ใบหน้ายาวเรียว หูกึ่งตั้งปลายตก รูปร่างสง่างาม",
    "characteristics": "คล้ายคอลลี่ขนาดย่อส่วน ใบหน้ายาวเรียว หูกึ่งตั้งปลายตก รูปร่างสง่างาม",
    "personality": "ฉลาดติดอันดับต้นๆ เรียนรู้ไว ว่าง่าย ชอบทำกิจกรรม และมีสัญชาตญาณต้อนสัตว์",
    "difficulty": "ปานกลาง",
    "energy": "ไม่ระบุในเอกสาร",
    "size": "กลาง",
    "grooming": "สูง (ต้องแปรงขนสม่ำเสมอเพื่อป้องกันขนพันกัน และต้องได้ปล่อยพลัง)",
    "lifespan": "12 – 14 ปี",
    "food": "",
    "care": "สูง (ต้องแปรงขนสม่ำเสมอเพื่อป้องกันขนพันกัน และต้องได้ปล่อยพลัง)",
    "specialFeatures": "ขนสองชั้น ยาว สลวยและหนาแน่น มีแผงคอและแผงอกชัดเจน",
    "image": "",
    "recommended": false,
    "coat": "ขนสองชั้น ยาว สลวยและหนาแน่น มีแผงคอและแผงอกชัดเจน",
    "friendliness": "สูง (เข้ากับครอบครัวและเด็กได้ดีเยี่ยม)",
    "beginnerSuitable": "ปานกลาง (ฝึกง่าย แต่ต้องรับมือเรื่องการดูแลขนและการเห่าได้)",
    "healthIssues": "ความผิดปกติของดวงตา (Sheltie Eye Syndrome), โรคข้อสะโพกเสื่อม, ภาวะแพ้ยาบางชนิด (MDR1 gene mutant)",
    "monthlyCost": "ประมาณ 2,500 – 4,000 บาท (รวมค่า grooming)"
  },
  {
    "name": "อเมริกัน แฮร์เลส เทอร์เรีย",
    "scientificName": "American Hairless Terrier",
    "category": "สุนัข",
    "description": "ลำตัวมีกล้ามเนื้อสมส่วน หูตั้ง รูปทรงปราดเปรียว ผิวหนังมีลายจุดหรือสีต่างๆ",
    "characteristics": "ลำตัวมีกล้ามเนื้อสมส่วน หูตั้ง รูปทรงปราดเปรียว ผิวหนังมีลายจุดหรือสีต่างๆ",
    "personality": "กระตือรือร้น ร่าเริง ชอบเล่น ซุกซนตามสไตล์เทอร์เรีย แต่ไม่ก้าวร้าว",
    "difficulty": "ปานกลาง",
    "energy": "ไม่ระบุในเอกสาร",
    "size": "เล็กถึงกลาง",
    "grooming": "ปานกลาง (ไม่ต้องแปรงขน แต่ต้องดูแลผิวหนัง ทาครีมกันแดด หรือใส่เสื้อกันหนาว)",
    "lifespan": "12 – 16 ปี",
    "food": "",
    "care": "ปานกลาง (ไม่ต้องแปรงขน แต่ต้องดูแลผิวหนัง ทาครีมกันแดด หรือใส่เสื้อกันหนาว)",
    "specialFeatures": "ไร้ขน (Skin/Hairless) ผิวหนังเรียบเนียน หรือบางตัวอาจมีขนสั้นบางนุ่มบางจุด",
    "image": "",
    "recommended": false,
    "coat": "ไร้ขน (Skin/Hairless) ผิวหนังเรียบเนียน หรือบางตัวอาจมีขนสั้นบางนุ่มบางจุด",
    "friendliness": "สูง (ขี้อ้อน ปรับตัวเข้ากับทุกคนในบ้านได้ดี)",
    "beginnerSuitable": "เหมาะมาก (ดูแลเรื่องขนง่าย เหมาะกับคนเป็นภูมิแพ้)",
    "healthIssues": "ผิวหนังไหม้แดด (Sunburn), รอยขีดข่วนตามผิวหนัง, โรคผิวหนังอักเสบ/แพ้ง่าย",
    "monthlyCost": "ประมาณ 1,500 – 3,000 บาท"
  },
  {
    "name": "เฟรนช์ บูลด็อก",
    "scientificName": "French Bulldog",
    "category": "สุนัข",
    "description": "หน้าหักย่น จมูกบี้ หูตั้งคล้ายค้างคาว (Bat ears) ลำตัวหนาแน่น อกกลมแน่น",
    "characteristics": "หน้าหักย่น จมูกบี้ หูตั้งคล้ายค้างคาว (Bat ears) ลำตัวหนาแน่น อกกลมแน่น",
    "personality": "อารมณ์ดี ชอบนอน ชิลๆ ไม่ค่อยเห่า ติดเจ้าของ",
    "difficulty": "ปานกลาง",
    "energy": "ไม่ระบุในเอกสาร",
    "size": "เล็ก",
    "grooming": "ปานกลาง (ต้องเช็ดทำความสะอาดรอยย่นบนใบหน้าเป็นประจำ และระวังเรื่องอากาศร้อน)",
    "lifespan": "10 – 12 ปี",
    "food": "",
    "care": "ปานกลาง (ต้องเช็ดทำความสะอาดรอยย่นบนใบหน้าเป็นประจำ และระวังเรื่องอากาศร้อน)",
    "specialFeatures": "ขนสั้น เรียบ สลวย ติดผิวหนัง",
    "image": "",
    "recommended": false,
    "coat": "ขนสั้น เรียบ สลวย ติดผิวหนัง",
    "friendliness": "สูงมาก (เป็นมิตรกับคนแปลกหน้าและสัตว์อื่นได้ง่าย)",
    "beginnerSuitable": "เหมาะมาก (ไม่ต้องใช้พื้นที่/เวลาออกกำลังกายเยอะ เลี้ยงในคอนโดได้)",
    "healthIssues": "ทางเดินหายใจอุดกั้น (BOAS), ฮีทสโตรก (Heatstroke), โรคผิวหนังตามรอยย่น, ตาดิ่ง/ตาแห้ง",
    "monthlyCost": "ประมาณ 2,500 – 4,500 บาท (อาจมีค่ารักษาพยาบาลเพิ่ม)"
  },
  {
    "name": "บีเกิล",
    "scientificName": "Beagle",
    "category": "สุนัข",
    "description": "หูตกแนบแก้ม ดวงตากลมโต อกแน่น ปลายหางมีสีขาวเพื่อสังเกตง่ายเวลาดมกลิ่น",
    "characteristics": "หูตกแนบแก้ม ดวงตากลมโต อกแน่น ปลายหางมีสีขาวเพื่อสังเกตง่ายเวลาดมกลิ่น",
    "personality": "แอ็กทีฟ พลังงานสูง อยากรู้อยากเห็น ใช้จมูกดมกลิ่นตลอดเวลา และเห็นแก่กิน",
    "difficulty": "ปานกลาง",
    "energy": "ไม่ระบุในเอกสาร",
    "size": "เล็กถึงกลาง",
    "grooming": "ปานกลาง (ขนดูแลรักษาง่าย แต่ต้องเน้นการออกกำลังกายเพื่อเผาผลาญพลังงาน)",
    "lifespan": "12 – 15 ปี",
    "food": "",
    "care": "ปานกลาง (ขนดูแลรักษาง่าย แต่ต้องเน้นการออกกำลังกายเพื่อเผาผลาญพลังงาน)",
    "specialFeatures": "ขนสั้น หนา ทนทานต่อสภาพอากาศ",
    "image": "",
    "recommended": false,
    "coat": "ขนสั้น หนา ทนทานต่อสภาพอากาศ",
    "friendliness": "สูงมาก (เข้ากับเด็กและสัตว์เลี้ยงตัวอื่นได้ดีเยี่ยม)",
    "beginnerSuitable": "ปานกลาง (ใจดีเลี้ยงง่าย แต่ซน ดื้อ และชอบเห่าตามสัญชาตญาณสุนัขล่าสัตว์)",
    "healthIssues": "โรคอ้วน, หูอักเสบจากความอับชื้น (เนื่องจากหูตก), โรคข้อสะโพกเสื่อม",
    "monthlyCost": "ประมาณ 2,000 – 3,500 บาท"
  },
  {
    "name": "ไทยหลังอาน",
    "scientificName": "Thai Ridgeback",
    "category": "สุนัข",
    "description": "รูปร่างเพรียว มีกล้ามเนื้อชัดเจน ลิ้นอาจมีปานดำ หูตั้งทรงสามเหลี่ยม หางดาบ",
    "characteristics": "รูปร่างเพรียว มีกล้ามเนื้อชัดเจน ลิ้นอาจมีปานดำ หูตั้งทรงสามเหลี่ยม หางดาบ",
    "personality": "ฉลาด รักอิสระ คล่องแคล่ว กระโดดสูง มีสัญชาตญาณการเฝ้าบ้านและล่าสัตว์สูง",
    "difficulty": "ง่าย",
    "energy": "ไม่ระบุในเอกสาร",
    "size": "กลางถึงใหญ่",
    "grooming": "ต่ำถึงปานกลาง (ขนสั้นดูแลรักษาง่ายมาก แต่ต้องการพื้นที่และการฝึกวินัย)",
    "lifespan": "12 – 14 ปี",
    "food": "",
    "care": "ต่ำถึงปานกลาง (ขนสั้นดูแลรักษาง่ายมาก แต่ต้องการพื้นที่และการฝึกวินัย)",
    "specialFeatures": "ขนสั้นมากถึงสั้น เรียบเนียน จุดเด่นคือมีแนวขนย้อนกลับบนแผ่นหลัง (อาน)",
    "image": "",
    "recommended": false,
    "coat": "ขนสั้นมากถึงสั้น เรียบเนียน จุดเด่นคือมีแนวขนย้อนกลับบนแผ่นหลัง (อาน)",
    "friendliness": "ปานกลาง (รักและจงรักภักดีต่อคนในครอบครัว แต่มีความเป็นตัวของตัวเองสูง)",
    "beginnerSuitable": "ไม่เหมาะ (มีความเป็นสุนัขป่า/สัญชาตญาณล่าสูง ต้องการผู้เลี้ยงที่มีประสบการณ์)",
    "healthIssues": "โรคถุงน้ำใต้ผิวหนังบริเวณอาน (Dermoid Sinus), โรคข้อสะโพกเสื่อม",
    "monthlyCost": "ประมาณ 2,000 – 4,000 บาท"
  },
  {
    "name": "โชโลอิตซ์ควนทลี",
    "scientificName": "Xoloitzcuintli",
    "category": "สุนัข",
    "description": "รูปร่างสมส่วน ผิวหนังหนาทนทาน มีรอยย่นบริเวณหน้าผากเมื่อตื่นตัว หูตั้งใหญ่คล้ายค้างคาว ดวงตาอัลมอนด์",
    "characteristics": "รูปร่างสมส่วน ผิวหนังหนาทนทาน มีรอยย่นบริเวณหน้าผากเมื่อตื่นตัว หูตั้งใหญ่คล้ายค้างคาว ดวงตาอัลมอนด์",
    "personality": "สงบ ฉลาด สง่างาม มีสัญชาตญาณเฝ้าบ้านสูง รักความสะอาด ไวต่อความรู้สึกของเจ้าของ",
    "difficulty": "ปานกลาง",
    "energy": "ไม่ระบุในเอกสาร",
    "size": "มี 3 ขนาด (ทอย: เล็ก / มินิเอเจอร์: กลาง / สแตนดาร์ด: ใหญ่)",
    "grooming": "ปานกลาง (ไม่ต้องแปรงขน แต่ต้องคอยดูแลผิวหนัง เช็ดทำความสะอาด ทาครีมกันแดด และสวมเสื้อผ้าให้ความอบอุ่น)",
    "lifespan": "12 – 15 ปี",
    "food": "",
    "care": "ปานกลาง (ไม่ต้องแปรงขน แต่ต้องคอยดูแลผิวหนัง เช็ดทำความสะอาด ทาครีมกันแดด และสวมเสื้อผ้าให้ความอบอุ่น)",
    "specialFeatures": "ส่วนใหญ่ไร้ขน (Hairless) มีผิวหนังเรียบตึง หรือชนิดมีขนสั้นเรียบติดผิวหนัง (Coated)",
    "image": "",
    "recommended": false,
    "coat": "ส่วนใหญ่ไร้ขน (Hairless) มีผิวหนังเรียบตึง หรือชนิดมีขนสั้นเรียบติดผิวหนัง (Coated)",
    "friendliness": "ปานกลางถึงสูง (รักและติดครอบครัวมาก แต่จะสงวนท่าทีและระแวงคนแปลกหน้า)",
    "beginnerSuitable": "ปานกลาง (เลี้ยงง่ายเรื่องความสะอาดและเหมาะกับคนแพ้ขนสัตว์ แต่ต้องการการเข้าสังคมตั้งแต่เด็ก)",
    "healthIssues": "ปัญหาผิวหนัง (ผิวแห้ง, ไหม้แดด, สิวสุนัข), ปัญหาสุขภาพฟัน (ในพันธุ์ไร้ขนมักมีฟันไม่ครบตามธรรมชาติ)",
    "monthlyCost": "ประมาณ 2,000 – 4,000 บาท"
  },
  {
    "name": "ชิวาวา",
    "scientificName": "Chihuahua",
    "category": "สุนัข",
    "description": "สุนัขขนาดเล็กมาก หูตั้ง ตากลมโต ร่าเริงและตื่นตัว",
    "characteristics": "สุนัขขนาดเล็กมาก หูตั้ง ตากลมโต ร่าเริงและตื่นตัว",
    "personality": "ร่าเริง ขี้เล่น ตื่นตัว กล้าหาญ และมักผูกพันกับเจ้าของ",
    "difficulty": "ง่าย",
    "energy": "ไม่ระบุในเอกสาร",
    "size": "ขนาดเล็ก",
    "grooming": "ดูแลง่าย",
    "lifespan": "ประมาณ 12–20 ปี",
    "food": "",
    "care": "ดูแลง่าย",
    "specialFeatures": "ขนสั้น / ขนยาว",
    "image": "",
    "recommended": false,
    "coat": "ขนสั้น / ขนยาว",
    "friendliness": "ปานกลาง",
    "beginnerSuitable": "เหมาะสม",
    "healthIssues": "ปัญหาเกี่ยวกับฟัน โรคหัวใจ ลูกสะบ้าหลุด และภาวะน้ำตาลในเลือดต่ำ",
    "monthlyCost": "ประมาณ 1,100–2,400 บาท"
  },
  {
    "name": "ชิสุ",
    "scientificName": "Shih Tzu",
    "category": "สุนัข",
    "description": "สุนัขขนาดเล็ก รูปร่างกะทัดรัด ใบหน้าสั้น ดวงตากลม และมีขนยาวคลุมลำตัว",
    "characteristics": "สุนัขขนาดเล็ก รูปร่างกะทัดรัด ใบหน้าสั้น ดวงตากลม และมีขนยาวคลุมลำตัว",
    "personality": "เป็นมิตร ร่าเริง ขี้เล่น และชอบอยู่ใกล้เจ้าของ",
    "difficulty": "ปานกลาง",
    "energy": "ไม่ระบุในเอกสาร",
    "size": "ขนาดเล็ก",
    "grooming": "ปานกลางถึงสูง",
    "lifespan": "ประมาณ 10–16 ปี",
    "food": "",
    "care": "ปานกลางถึงสูง",
    "specialFeatures": "ขนสั้น / ขนยาว",
    "image": "",
    "recommended": false,
    "coat": "ขนสั้น / ขนยาว",
    "friendliness": "ปานกลาง",
    "beginnerSuitable": "เหมาะสม",
    "healthIssues": "ปัญหาฟัน โรคตา ปัญหาระบบทางเดินหายใจ และโรคผิวหนัง",
    "monthlyCost": "1,500 - 3,500 บาทต่อเดือน"
  },
  {
    "name": "มอลทีส",
    "scientificName": "Maltese",
    "category": "สุนัข",
    "description": "สุนัขตัวเล็ก ขนสีขาวยาวคลุมลำตัว ใบหน้ากลม ตาสีเข้ม",
    "characteristics": "สุนัขตัวเล็ก ขนสีขาวยาวคลุมลำตัว ใบหน้ากลม ตาสีเข้ม",
    "personality": "ร่าเริง ขี้เล่น อ่อนโยน และชอบอยู่ใกล้เจ้าของ",
    "difficulty": "ปานกลาง",
    "energy": "ไม่ระบุในเอกสาร",
    "size": "ขนาดเล็ก",
    "grooming": "สูง ต้องแปรงขนเป็นประจำเพื่อป้องกันขนพันกัน",
    "lifespan": "ประมาณ 12–15 ปี",
    "food": "",
    "care": "สูง ต้องแปรงขนเป็นประจำเพื่อป้องกันขนพันกัน",
    "specialFeatures": "ขนยาว สีขาว นุ่มและตรง",
    "image": "",
    "recommended": false,
    "coat": "ขนยาว สีขาว นุ่มและตรง",
    "friendliness": "สูง",
    "beginnerSuitable": "เหมาะสม",
    "healthIssues": "ปัญหาฟัน โรคสะบ้าเคลื่อน โรคตา และปัญหาทางเดินหายใจ",
    "monthlyCost": "ประมาณ 1,300–2,800 บาท"
  },
  {
    "name": "ยอร์กเชียร์ เทอร์เรีย",
    "scientificName": "Yorkshire Terrier",
    "category": "สุนัข",
    "description": "สุนัขตัวเล็ก รูปร่างกะทัดรัด ขนยาวสลวย หูตั้ง และมีลักษณะคล่องแคล่ว",
    "characteristics": "สุนัขตัวเล็ก รูปร่างกะทัดรัด ขนยาวสลวย หูตั้ง และมีลักษณะคล่องแคล่ว",
    "personality": "ร่าเริง กล้าหาญ กระตือรือร้น ฉลาด และตื่นตัวต่อสิ่งรอบตัว",
    "difficulty": "ยาก",
    "energy": "ไม่ระบุในเอกสาร",
    "size": "ขนาดเล็ก",
    "grooming": "สูง",
    "lifespan": "ประมาณ 11–15 ปี",
    "food": "",
    "care": "สูง",
    "specialFeatures": "ขนยาว ตรง ละเอียด สีดำแกมทอง",
    "image": "",
    "recommended": false,
    "coat": "ขนยาว ตรง ละเอียด สีดำแกมทอง",
    "friendliness": "สูง",
    "beginnerSuitable": "เหมาะสม",
    "healthIssues": "ปัญหาฟัน ลูกสะบ้าเคลื่อน ภาวะหลอดลมยุบ และปัญหาเกี่ยวกับตา",
    "monthlyCost": "ประมาณ 1,300–2,800 บาท"
  },
  {
    "name": "ปอมเมอเรเนียน",
    "scientificName": "Pomeranian",
    "category": "สุนัข",
    "description": "สุนัขตัวเล็ก ขนฟูแน่น ใบหน้าคล้ายสุนัขจิ้งจอก หูตั้ง และหางเป็นพวง",
    "characteristics": "สุนัขตัวเล็ก ขนฟูแน่น ใบหน้าคล้ายสุนัขจิ้งจอก หูตั้ง และหางเป็นพวง",
    "personality": "ร่าเริง ขี้เล่น ฉลาด ตื่นตัว และมีความกระตือรือร้นสูง",
    "difficulty": "ปานกลาง",
    "energy": "ไม่ระบุในเอกสาร",
    "size": "ขนาดเล็ก",
    "grooming": "ปานกลางถึงสูง",
    "lifespan": "ประมาณ 12–16 ปี",
    "food": "",
    "care": "ปานกลางถึงสูง",
    "specialFeatures": "ขนยาว ฟูหนา มีขนสองชั้น",
    "image": "",
    "recommended": false,
    "coat": "ขนยาว ฟูหนา มีขนสองชั้น",
    "friendliness": "สูง",
    "beginnerSuitable": "เหมาะสม",
    "healthIssues": "ปัญหาฟัน ลูกสะบ้าเคลื่อน หลอดลมยุบ และปัญหาผิวหนังหรือขน",
    "monthlyCost": "ประมาณ 1,500–3,000 บาท"
  },
  {
    "name": "ไชนีส เครสเต็ด",
    "scientificName": "Chinese Crested",
    "category": "สุนัข",
    "description": "สุนัขขนาดเล็ก รูปร่างเพรียว มีหูตั้ง และมีขนเด่นบริเวณหัว หาง และเท้า",
    "characteristics": "สุนัขขนาดเล็ก รูปร่างเพรียว มีหูตั้ง และมีขนเด่นบริเวณหัว หาง และเท้า",
    "personality": "ร่าเริง ขี้เล่น อ่อนโยน และผูกพันกับเจ้าของ",
    "difficulty": "ปานกลาง",
    "energy": "ไม่ระบุในเอกสาร",
    "size": "ขนาดเล็ก",
    "grooming": "ปานกลาง",
    "lifespan": "ประมาณ 13–18 ปี",
    "food": "",
    "care": "ปานกลาง",
    "specialFeatures": "ส่วนใหญ่ไม่มีขนตามลำตัว มีขนบริเวณศีรษะ หาง และปลายเท้า",
    "image": "",
    "recommended": false,
    "coat": "ส่วนใหญ่ไม่มีขนตามลำตัว มีขนบริเวณศีรษะ หาง และปลายเท้า",
    "friendliness": "สูง",
    "beginnerSuitable": "เหมาะสม",
    "healthIssues": "ปัญหาฟัน โรคผิวหนัง การแพ้แดด และปัญหากระดูกหรือข้อ",
    "monthlyCost": "ประมาณ 1,200–2,500 บาท"
  },
  {
    "name": "โกลเด้น รีทรีฟเวอร์",
    "scientificName": "Golden Retriever",
    "category": "สุนัข",
    "description": "โครงสร้างสมส่วน แข็งแรง หัวโต หน้าตาใจดี ตาประกายอารมณ์ดี",
    "characteristics": "โครงสร้างสมส่วน แข็งแรง หัวโต หน้าตาใจดี ตาประกายอารมณ์ดี",
    "personality": "กระตือรือร้น ชอบเล่นน้ำ ชอบคาบสิ่งของ อ่อนโยน มีพลังงานสูง",
    "difficulty": "ปานกลาง",
    "energy": "ไม่ระบุในเอกสาร",
    "size": "ใหญ่",
    "grooming": "ปานกลางถึงสูง (ผลัดขนเยอะ ต้องแปรงขนสม่ำเสมอและพาไปออกกำลังกาย)",
    "lifespan": "10 – 12 ปี",
    "food": "",
    "care": "ปานกลางถึงสูง (ผลัดขนเยอะ ต้องแปรงขนสม่ำเสมอและพาไปออกกำลังกาย)",
    "specialFeatures": "ขนสองชั้น ยาวปานกลาง เรียบหรือเป็นลอน กันน้ำได้ดี มีขนพุ่มบริเวณอก ขา และหาง",
    "image": "",
    "recommended": false,
    "coat": "ขนสองชั้น ยาวปานกลาง เรียบหรือเป็นลอน กันน้ำได้ดี มีขนพุ่มบริเวณอก ขา และหาง",
    "friendliness": "สูงมาก (ใจดี รักทุกคน เข้ากับเด็ก สัตว์อื่น และคนแปลกหน้าได้ดีเยี่ยม)",
    "beginnerSuitable": "เหมาะมาก (ว่าง่าย ฝึกง่าย เป็นสุนัขครอบครัวยอดนิยม)",
    "healthIssues": "โรคข้อสะโพก/ข้อศอกเสื่อม, โรคมะเร็ง, โรคจอประสาทตา/ต้อกระจก, โรคผิวหนังอักเสบ",
    "monthlyCost": "ประมาณ 3,000 – 5,000 บาท"
  },
  {
    "name": "ซามอยด์",
    "scientificName": "Samoyed",
    "category": "สุนัข",
    "description": "โครงสร้างสมส่วน แข็งแรง หัวโต หน้าตาใจดี ตาประกายอารมณ์ดี",
    "characteristics": "โครงสร้างสมส่วน แข็งแรง หัวโต หน้าตาใจดี ตาประกายอารมณ์ดี",
    "personality": "กระตือรือร้น ชอบเล่นน้ำ ชอบคาบสิ่งของ อ่อนโยน มีพลังงานสูง",
    "difficulty": "ปานกลาง",
    "energy": "ไม่ระบุในเอกสาร",
    "size": "ใหญ่",
    "grooming": "ปานกลางถึงสูง (ผลัดขนเยอะ ต้องแปรงขนสม่ำเสมอและพาไปออกกำลังกาย)",
    "lifespan": "10 – 12 ปี",
    "food": "",
    "care": "ปานกลางถึงสูง (ผลัดขนเยอะ ต้องแปรงขนสม่ำเสมอและพาไปออกกำลังกาย)",
    "specialFeatures": "ขนสองชั้น ยาวปานกลาง เรียบหรือเป็นลอน กันน้ำได้ดี มีขนพุ่มบริเวณอก ขา และหาง",
    "image": "",
    "recommended": false,
    "coat": "ขนสองชั้น ยาวปานกลาง เรียบหรือเป็นลอน กันน้ำได้ดี มีขนพุ่มบริเวณอก ขา และหาง",
    "friendliness": "สูงมาก (ใจดี รักทุกคน เข้ากับเด็ก สัตว์อื่น และคนแปลกหน้าได้ดีเยี่ยม)",
    "beginnerSuitable": "เหมาะมาก (ว่าง่าย ฝึกง่าย เป็นสุนัขครอบครัวยอดนิยม)",
    "healthIssues": "โรคข้อสะโพก/ข้อศอกเสื่อม, โรคมะเร็ง, โรคตาริดสีดวง/ต้อกระจก, โรคผิวหนังอักเสบ",
    "monthlyCost": "ประมาณ 3,000 – 5,000 บาท"
  },
  {
    "name": "อลาสกัน มาลามิวท์",
    "scientificName": "Alaskan Malamute",
    "category": "สุนัข",
    "description": "ตัวโต อกหนา ลำตัวมีกล้ามเนื้อแน่น หน้าตาคล้ายหมาป่าแต่สง่างาม หางเป็นพุ่มแกว่งพาดหลัง",
    "characteristics": "ตัวโต อกหนา ลำตัวมีกล้ามเนื้อแน่น หน้าตาคล้ายหมาป่าแต่สง่างาม หางเป็นพุ่มแกว่งพาดหลัง",
    "personality": "แข็งแรง อิสระ ชอบทำกิจกรรมกลางแจ้ง ไม่ค่อยเห่าแต่ชอบหอน",
    "difficulty": "ปานกลาง",
    "energy": "ไม่ระบุในเอกสาร",
    "size": "ใหญ่ถึงใหญ่ยักษ์",
    "grooming": "สูง (ขนหนาแน่นต้องการการแปรงขนสม่ำเสมอ และต้องการการออกกำลังกายหนัก)",
    "lifespan": "10 – 14 ปี",
    "food": "",
    "care": "สูง (ขนหนาแน่นต้องการการแปรงขนสม่ำเสมอ และต้องการการออกกำลังกายหนัก)",
    "specialFeatures": "ขนสองชั้น หนาแน่นและหยาบ ช่วยป้องกันความหนาวเย็น",
    "image": "",
    "recommended": false,
    "coat": "ขนสองชั้น หนาแน่นและหยาบ ช่วยป้องกันความหนาวเย็น",
    "friendliness": "สูง (รักครอบครัวและเป็นมิตรกับคน แต่มีสัญชาตญาณความเป็นผู้นำสูงกับสุนัขตัวอื่น)",
    "beginnerSuitable": "ไม่เหมาะ (ตัวใหญ่ กำลังเยอะ และดื้อรั้นหากเจ้าของไม่มีความเป็นผู้นำ)",
    "healthIssues": "โรคข้อสะโพกเสื่อม, กระเพาะอาหารบิดหมุน (Bloat), โรคต่อมไทรอยด์ทำงานต่ำ",
    "monthlyCost": "ประมาณ 4,000 – 7,000 บาท"
  },
  {
    "name": "อัฟกัน ฮาวนด์",
    "scientificName": "Afghan Hound",
    "category": "สุนัข",
    "description": "สุนัขขนาดใหญ่ รูปร่างสูงเพรียวและสง่างาม ขายาว ลำตัวแข็งแรงแต่ไม่หนา ใบหน้ายาว หูยาวตก หางยาวและมักโค้งเป็นวงบริเวณปลายหาง",
    "characteristics": "สุนัขขนาดใหญ่ รูปร่างสูงเพรียวและสง่างาม ขายาว ลำตัวแข็งแรงแต่ไม่หนา ใบหน้ายาว หูยาวตก หางยาวและมักโค้งเป็นวงบริเวณปลายหาง",
    "personality": "สุขุม รักอิสระ อ่อนโยน และมีความสง่างาม มีความเป็นตัวของตัวเองสูง",
    "difficulty": "ปานกลาง",
    "energy": "ไม่ระบุในเอกสาร",
    "size": "ขนาดใหญ่",
    "grooming": "สูง ต้องแปรงขนและหวีขนเป็นประจำเพื่อป้องกันขนพันกัน",
    "lifespan": "ประมาณ 12–14 ปี",
    "food": "",
    "care": "สูง ต้องแปรงขนและหวีขนเป็นประจำเพื่อป้องกันขนพันกัน",
    "specialFeatures": "ขนยาว ละเอียด นุ่มและตรง ปกคลุมลำตัวเป็นส่วนใหญ่ ขนบริเวณศีรษะและหูยาวเด่นชัด",
    "image": "",
    "recommended": false,
    "coat": "ขนยาว ละเอียด นุ่มและตรง ปกคลุมลำตัวเป็นส่วนใหญ่ ขนบริเวณศีรษะและหูยาวเด่นชัด",
    "friendliness": "ปานกลางถึงสูง",
    "beginnerSuitable": "ค่อนข้างไม่เหมาะ เนื่องจากต้องใช้เวลาในการดูแลขน ออกกำลังกาย และฝึกอย่างสม่ำเสมอ",
    "healthIssues": "ภาวะสะโพกผิดปกติ โรคต้อกระจก ปัญหาต่อมไทรอยด์ และปัญหาสุขภาพที่เกี่ยวข้องกับระบบทางเดินอาหารหรือการแพ้ยาบางชนิด",
    "monthlyCost": "ประมาณ 2,000–5,000 บาท"
  },
  {
    "name": "ลาบราดอร์ รีทรีฟเวอร์",
    "scientificName": "Labrador Retriever",
    "category": "สุนัข",
    "description": "สุนัขขนาดใหญ่ รูปร่างแข็งแรง ลำตัวสมส่วน ปากค่อนข้างใหญ่ หูตกขนาดปานกลาง",
    "characteristics": "สุนัขขนาดใหญ่ รูปร่างแข็งแรง ลำตัวสมส่วน ปากค่อนข้างใหญ่ หูตกขนาดปานกลาง",
    "personality": "เป็นมิตร ร่าเริง ฉลาด กระตือรือร้น ชอบเล่นและทำกิจกรรมร่วมกับเจ้าของ เข้ากับคนและสัตว์อื่นได้ดี และมีความต้องการออกกำลังกายค่อนข้างสูง",
    "difficulty": "ปานกลาง",
    "energy": "ไม่ระบุในเอกสาร",
    "size": "ขนาดใหญ่",
    "grooming": "ปานกลาง",
    "lifespan": "ประมาณ 10–12 ปี",
    "food": "",
    "care": "ปานกลาง",
    "specialFeatures": "ขนสั้น หนาแน่น และค่อนข้างแข็ง มีขนชั้นในที่ช่วยป้องกันน้ำและความเย็น มีสีหลัก ได้แก่ ดำ เหลือง และช็อกโกแลต",
    "image": "",
    "recommended": false,
    "coat": "ขนสั้น หนาแน่น และค่อนข้างแข็ง มีขนชั้นในที่ช่วยป้องกันน้ำและความเย็น มีสีหลัก ได้แก่ ดำ เหลือง และช็อกโกแลต",
    "friendliness": "สูง",
    "beginnerSuitable": "เหมาะสม",
    "healthIssues": "ข้อสะโพกเสื่อม ข้อศอกเสื่อม โรคอ้วน ปัญหาข้อและเอ็น โรคตา และภาวะหูอักเสบ",
    "monthlyCost": "ประมาณ 2,000–4,500 บาท"
  },
  {
    "name": "ดัลเมเชียน",
    "scientificName": "Dalmatian",
    "category": "สุนัข",
    "description": "สุนัขขนาดใหญ่ รูปร่างแข็งแรงและเพรียว ลำตัวสมส่วน ขายาวและมีกล้ามเนื้อ ศีรษะได้สัดส่วนกับลำตัว หูตกขนาดปานกลาง",
    "characteristics": "สุนัขขนาดใหญ่ รูปร่างแข็งแรงและเพรียว ลำตัวสมส่วน ขายาวและมีกล้ามเนื้อ ศีรษะได้สัดส่วนกับลำตัว หูตกขนาดปานกลาง",
    "personality": "กระตือรือร้น ร่าเริง ฉลาด ขี้เล่น และมีพลังงานสูง ชอบทำกิจกรรมและออกกำลังกายร่วมกับเจ้าของ มีความผูกพันกับครอบครัว และสามารถเข้ากับคนและสัตว์อื่นได้เมื่อได้รับการเข้าสังคมอย่างเหมาะสม",
    "difficulty": "ปานกลาง",
    "energy": "ไม่ระบุในเอกสาร",
    "size": "ขนาดใหญ่",
    "grooming": "ปานกลาง",
    "lifespan": "ประมาณ 11–13 ปี",
    "food": "",
    "care": "ปานกลาง",
    "specialFeatures": "ขนสั้น เรียบ แน่น และเป็นมัน มีสีพื้นเป็นสีขาว มีจุดสีดำหรือสีน้ำตาลเข้มกระจายทั่วลำตัว",
    "image": "",
    "recommended": false,
    "coat": "ขนสั้น เรียบ แน่น และเป็นมัน มีสีพื้นเป็นสีขาว มีจุดสีดำหรือสีน้ำตาลเข้มกระจายทั่วลำตัว",
    "friendliness": "สูง",
    "beginnerSuitable": "เหมาะสม",
    "healthIssues": "หูหนวกหรือมีปัญหาการได้ยิน นิ่วในระบบทางเดินปัสสาวะ โรคข้อสะโพกเสื่อม ภูมิแพ้และปัญหาผิวหนัง รวมถึงปัญหาเกี่ยวกับดวงตา",
    "monthlyCost": "ประมาณ 2,000–4,500 บาท"
  },
  {
    "name": "โดเบอร์แมน",
    "scientificName": "Doberman",
    "category": "สุนัข",
    "description": "สุนัขขนาดใหญ่ รูปร่างสูงเพรียว แข็งแรง และมีกล้ามเนื้อชัดเจน ศีรษะเป็นทรงลิ่ม หูตั้งหรือหูตกตามการเลี้ยงและการตัดแต่ง หางค่อนข้างยาวตามธรรมชาติ",
    "characteristics": "สุนัขขนาดใหญ่ รูปร่างสูงเพรียว แข็งแรง และมีกล้ามเนื้อชัดเจน ศีรษะเป็นทรงลิ่ม หูตั้งหรือหูตกตามการเลี้ยงและการตัดแต่ง หางค่อนข้างยาวตามธรรมชาติ",
    "personality": "ฉลาด ซื่อสัตย์ ตื่นตัว กระตือรือร้น และผูกพันกับเจ้าของสูง มีสัญชาตญาณในการเฝ้าระวังและปกป้องครอบครัว ชอบทำกิจกรรมร่วมกับเจ้าของ และต้องการการฝึกที่สม่ำเสมอ",
    "difficulty": "ปานกลาง",
    "energy": "ไม่ระบุในเอกสาร",
    "size": "ขนาดใหญ่",
    "grooming": "ปานกลาง",
    "lifespan": "ประมาณ 10–12 ปี",
    "food": "",
    "care": "ปานกลาง",
    "specialFeatures": "ขนสั้น เรียบ ตรง และแนบไปกับลำตัว ขนค่อนข้างหนาแน่น มีสีดำ น้ำตาลแดง น้ำเงิน หรือสีน้ำตาลอ่อน โดยมักมีแต้มสีสนิมบริเวณใบหน้า หน้าอก ขา และหาง",
    "image": "",
    "recommended": false,
    "coat": "ขนสั้น เรียบ ตรง และแนบไปกับลำตัว ขนค่อนข้างหนาแน่น มีสีดำ น้ำตาลแดง น้ำเงิน หรือสีน้ำตาลอ่อน โดยมักมีแต้มสีสนิมบริเวณใบหน้า หน้าอก ขา และหาง",
    "friendliness": "ปานกลางถึงสูง",
    "beginnerSuitable": "ค่อนข้างไม่เหมาะ เนื่องจากเป็นสุนัขที่มีพลังงานสูง ต้องได้รับการฝึกอย่างสม่ำเสมอ และต้องการเจ้าของที่สามารถควบคุมและดูแลได้อย่างเหมาะสม",
    "healthIssues": "โรคกล้ามเนื้อหัวใจเสื่อม (Dilated Cardiomyopathy), โรคเลือดออกผิดปกติ (Von Willebrand Disease), ภาวะข้อสะโพกเสื่อม โรคไทรอยด์ และปัญหากระดูกหรือข้อต่อ",
    "monthlyCost": "ประมาณ 2,500–5,000 บาท"
  },
  {
    "name": "อิงลิช มาสทิฟ",
    "scientificName": "English Mastiff",
    "category": "สุนัข",
    "description": "ลำตัวใหญ่หนา กะโหลกใหญ่กว้าง หน้ามีย่นเล็กน้อย หน้าหน้ามืด (Black mask) อกลึก ดูน่าเกรงขาม",
    "characteristics": "ลำตัวใหญ่หนา กะโหลกใหญ่กว้าง หน้ามีย่นเล็กน้อย หน้าหน้ามืด (Black mask) อกลึก ดูน่าเกรงขาม",
    "personality": "สุภาพ ยักษ์ใหญ่ใจดี ชอบนอน ไม่ค่อยเห่า ปกป้องครอบครัวแบบเงียบๆ",
    "difficulty": "ปานกลาง",
    "energy": "ไม่ระบุในเอกสาร",
    "size": "ใหญ่ยักษ์ (Giant)",
    "grooming": "ปานกลาง (ดูแลขนง่าย แต่ต้องคอยเช็ดน้ำลาย และระวังเรื่องน้ำหนักตัว)",
    "lifespan": "6 – 12 ปี",
    "food": "",
    "care": "ปานกลาง (ดูแลขนง่าย แต่ต้องคอยเช็ดน้ำลาย และระวังเรื่องน้ำหนักตัว)",
    "specialFeatures": "ขนสั้น เรียบ สั้น แน่นติดผิวหนัง",
    "image": "",
    "recommended": false,
    "coat": "ขนสั้น เรียบ สั้น แน่นติดผิวหนัง",
    "friendliness": "สูง (สุภาพ อ่อนโยน สงบ และเข้ากับครอบครัวได้ดีมาก)",
    "beginnerSuitable": "ปานกลาง (ใจดี แต่พละกำลังเยอะมาก ต้องคุมให้อยู่ตั้งแต่ยังเล็ก)",
    "healthIssues": "โรคข้อสะโพก/ข้อศอกเสื่อม, กระเพาะอาหารบิดหมุน (Bloat), โรคหัวใจ, มะเร็งกระดูก",
    "monthlyCost": "ประมาณ 5,000 – 8,000 บาท (ปริมาณอาหารเยอะมาก)"
  },
  {
    "name": "เกรท เดน",
    "scientificName": "Great Dane",
    "category": "สุนัข",
    "description": "สูงโปร่ง สง่างาม กล้ามเนื้อชัดเจน หัวยาวทรงสี่เหลี่ยม ท่าทางดูเกรงขาม",
    "characteristics": "สูงโปร่ง สง่างาม กล้ามเนื้อชัดเจน หัวยาวทรงสี่เหลี่ยม ท่าทางดูเกรงขาม",
    "personality": "ยักษ์ใหญ่ผู้สุภาพ (Gentle Giant) ชอบคิดว่าตัวเองเป็นหมาตัวเล็ก ขี้อ้อน ชอบนั่งตัก",
    "difficulty": "ปานกลาง",
    "energy": "ไม่ระบุในเอกสาร",
    "size": "ใหญ่ยักษ์ (Giant)",
    "grooming": "ปานกลาง (ขนดูแลรักษาง่าย แต่ต้องการพื้นที่และปริมาณอาหารเยอะ)",
    "lifespan": "7 – 10 ปี",
    "food": "",
    "care": "ปานกลาง (ขนดูแลรักษาง่าย แต่ต้องการพื้นที่และปริมาณอาหารเยอะ)",
    "specialFeatures": "ขนสั้น แน่น เรียบเงา",
    "image": "",
    "recommended": false,
    "coat": "ขนสั้น แน่น เรียบเงา",
    "friendliness": "สูง (อารมณ์ดี สนิทสนมกับคนในบ้าน เข้ากับเด็กได้ดี)",
    "beginnerSuitable": "ปานกลาง (ใจดีและเลี้ยงง่าย แต่ตัวใหญ่มากต้องการการฝึกวินัย)",
    "healthIssues": "กระเพาะอาหารบิดหมุน (Bloat), โรคข้อสะโพกเสื่อม, โรคกล้ามเนื้อหัวใจโต (DCM)",
    "monthlyCost": "ประมาณ 4,500 – 7,500 บาท"
  },
  {
    "name": "ไอริช วูลฟ์ ฮาวด์",
    "scientificName": "Irish Wolfhound",
    "category": "สุนัข",
    "description": "ตัวสูงใหญ่ เพรียวลม อกลึก มีกล้ามเนื้อ ขายาว มีหนวดและคิ้วดก",
    "characteristics": "ตัวสูงใหญ่ เพรียวลม อกลึก มีกล้ามเนื้อ ขายาว มีหนวดและคิ้วดก",
    "personality": "เงียบสงบ สง่างาม อ่อนโยน มีสัญชาตญาณการวิ่งไล่เหยื่อตามสายตา",
    "difficulty": "ปานกลาง",
    "energy": "ไม่ระบุในเอกสาร",
    "size": "ใหญ่ยักษ์ (Giant)",
    "grooming": "ปานกลางถึงสูง (ต้องแปรงขนสัปดาห์ละ 1-2 ครั้ง และต้องการพื้นที่วิ่งเล่น)",
    "lifespan": "6 – 8 ปี",
    "food": "",
    "care": "ปานกลางถึงสูง (ต้องแปรงขนสัปดาห์ละ 1-2 ครั้ง และต้องการพื้นที่วิ่งเล่น)",
    "specialFeatures": "ขนหยาบ แข็ง ชี้รวดเร็ว คล้ายเส้นลวด",
    "image": "",
    "recommended": false,
    "coat": "ขนหยาบ แข็ง ชี้รวดเร็ว คล้ายเส้นลวด",
    "friendliness": "สูง (สุขุมนุ่มนวล ไม่ก้าวร้าวกับคนแปลกหน้า)",
    "beginnerSuitable": "ไม่เหมาะ (เนื่องจากขนาดตัวสูงใหญ่มากและอายุขัยสั้น ต้องการการดูแลเฉพาะ)",
    "healthIssues": "มะเร็งกระดูก (Osteosarcoma), โรคกล้ามเนื้อหัวใจโต (DCM), กระเพาะอาหารบิดหมุน (Bloat)",
    "monthlyCost": "ประมาณ 5,000 – 8,000 บาท"
  },
  {
    "name": "เซนต์เบอร์นาร์ด",
    "scientificName": "Saint Bernard",
    "category": "สุนัข",
    "description": "หัวโต กะโหลกใหญ่ หน้าโอบอิ่ม อกกว้าง โครงสร้างใหญ่",
    "characteristics": "หัวโต กะโหลกใหญ่ หน้าโอบอิ่ม อกกว้าง โครงสร้างใหญ่",
    "personality": "สุขุม เดินช้า นุ่มนวล ติดครอบครัว และขี้อ้อน",
    "difficulty": "ปานกลาง",
    "energy": "ไม่ระบุในเอกสาร",
    "size": "ใหญ่ยักษ์ (Giant)",
    "grooming": "สูง (ต้องแปรงขนสม่ำเสมอ เช็ดน้ำลายบ่อยๆ และต้องให้อยู่ในที่อากาศไม่ร้อน)",
    "lifespan": "8 – 10 ปี",
    "food": "",
    "care": "สูง (ต้องแปรงขนสม่ำเสมอ เช็ดน้ำลายบ่อยๆ และต้องให้อยู่ในที่อากาศไม่ร้อน)",
    "specialFeatures": "มีทั้งชนิดขนสั้นและขนยาว (ขนยาวจะเรียบหรือเป็นลอนเล็กน้อย มีขนพุ่มที่ขา)",
    "image": "",
    "recommended": false,
    "coat": "มีทั้งชนิดขนสั้นและขนยาว (ขนยาวจะเรียบหรือเป็นลอนเล็กน้อย มีขนพุ่มที่ขา)",
    "friendliness": "สูงมาก (ใจดี มีเมตตา อดทนกับเด็กๆ ได้ดีเยี่ยม)",
    "beginnerSuitable": "ปานกลาง (นิสัยใจดีมาก แต่ขนาดตัว น้ำหนัก และน้ำลายต้องการการรับมือที่ดี)",
    "healthIssues": "โรคข้อสะโพก/ข้อศอกเสื่อม, โรคหนังตาตก/ตาร้อย, ฮีทสโตรกจากอากาศร้อน",
    "monthlyCost": "ประมาณ 5,000 – 8,500 บาท (รวมค่าอาหารและดูแลความเย็น)"
  },
  {
    "name": "ทิเบตัน มาสทิฟ",
    "scientificName": "Tibetan Mastiff",
    "category": "สุนัข",
    "description": "รูปร่างใหญ่บึกขึ้น หัวโต ศีรษะกว้าง หางเป็นพุ่มม้วนพาดหลัง ดูเกรงขามและน่าเกรงขาม",
    "characteristics": "รูปร่างใหญ่บึกขึ้น หัวโต ศีรษะกว้าง หางเป็นพุ่มม้วนพาดหลัง ดูเกรงขามและน่าเกรงขาม",
    "personality": "อิสระ ดื้อรั้น หวงถิ่นฐาน ตื่นตัวและเฝ้าบ้านในยามค่ำคืนได้ดีเยี่ยม",
    "difficulty": "ยาก",
    "energy": "ไม่ระบุในเอกสาร",
    "size": "ใหญ่ยักษ์ (Giant)",
    "grooming": "สูงมาก (ต้องการการดูแลขน ห้ามอยู่ในที่ร้อนจัด และต้องฝึกวินัยอย่างเข้มงวด)",
    "lifespan": "10 – 12 ปี",
    "food": "",
    "care": "สูงมาก (ต้องการการดูแลขน ห้ามอยู่ในที่ร้อนจัด และต้องฝึกวินัยอย่างเข้มงวด)",
    "specialFeatures": "ขนสองชั้น หนา หยาบ และยาว มีแผงขนรอบคอหนาแน่นคล้ายสิงโต",
    "image": "",
    "recommended": false,
    "coat": "ขนสองชั้น หนา หยาบ และยาว มีแผงขนรอบคอหนาแน่นคล้ายสิงโต",
    "friendliness": "ต่ำถึงปานกลาง (จงรักภักดีกับเจ้าของมาก แต่ระแวงและหวงถิ่นกับคนแปลกหน้าสูงมาก)",
    "beginnerSuitable": "ไม่เหมาะอย่างยิ่ง (ต้องการเจ้าของที่มีประสบการณ์สูงและเป็นจ่าฝูงที่เด็ดขาด)",
    "healthIssues": "โรคข้อสะโพกเสื่อม, โรคต่อมไทรอยด์ทำงานต่ำ, โรคตา",
    "monthlyCost": "ประมาณ 5,000 – 9,000 บาท"
  },
  {
    "name": "นิวฟาวนด์แลนด์",
    "scientificName": "Newfoundland",
    "category": "สุนัข",
    "description": "ลำตัวหนาแน่น มีกล้ามเนื้อ รูปร่างแข็งแรง อุ้งเท้ากว้างมีพังผืดช่วยในการว่ายน้ำ",
    "characteristics": "ลำตัวหนาแน่น มีกล้ามเนื้อ รูปร่างแข็งแรง อุ้งเท้ากว้างมีพังผืดช่วยในการว่ายน้ำ",
    "personality": "รักการว่ายน้ำ ใจดี สุขุม ว่าง่าย และชอบช่วยชีวิตคน",
    "difficulty": "ปานกลาง",
    "energy": "ไม่ระบุในเอกสาร",
    "size": "ใหญ่ยักษ์ (Giant)",
    "grooming": "สูง (ต้องแปรงขนเป็นประจำเพื่อไม่ให้พันกัน เช็ดน้ำลาย และระวังเรื่องความร้อน)",
    "lifespan": "8 – 10 ปี",
    "food": "",
    "care": "สูง (ต้องแปรงขนเป็นประจำเพื่อไม่ให้พันกัน เช็ดน้ำลาย และระวังเรื่องความร้อน)",
    "specialFeatures": "ขนสองชั้น ยาวปานกลาง หนาแน่น สลวย และมีน้ำมันกันน้ำได้ดี",
    "image": "",
    "recommended": false,
    "coat": "ขนสองชั้น ยาวปานกลาง หนาแน่น สลวย และมีน้ำมันกันน้ำได้ดี",
    "friendliness": "สูงมาก (ได้ชื่อว่าเป็น \"พี่เลี้ยงเด็ก\" สุภาพ อ่อนโยน อารมณ์ดี)",
    "beginnerSuitable": "ปานกลาง (นิสัยน่ารักเลี้ยงง่าย แต่ตัวใหญ่ ผลัดขนเยอะ และน้ำลายย้อย)",
    "healthIssues": "โรคข้อสะโพก/ข้อศอกเสื่อม, โรคเกี่ยวกับลิ้นหัวใจ (Subvalvular Aortic Stenosis), นิ่วในกระเพาะปัสสาวะ",
    "monthlyCost": "ประมาณ 5,000 – 8,000 บาท"
  },
  {
    "name": "คานกัล",
    "scientificName": "Kangal Shepherd",
    "category": "สุนัข",
    "description": "โครงสร้างแข็งแกร่ง หัวโต ใบหน้ามืด (Black mask) หูตก หางม้วนขึ้น อกกว้าง",
    "characteristics": "โครงสร้างแข็งแกร่ง หัวโต ใบหน้ามืด (Black mask) หูตก หางม้วนขึ้น อกกว้าง",
    "personality": "สงบนิ่ง นั่งเฝ้าระวัง มีสัญชาตญาณปกป้องฝูงสัตว์และอารักขาตามธรรมชาติ",
    "difficulty": "ปานกลาง",
    "energy": "ไม่ระบุในเอกสาร",
    "size": "ใหญ่ยักษ์ (Giant)",
    "grooming": "ปานกลาง (ขนดูแลรักษาง่าย แต่ต้องการพื้นที่กว้างและการฝึกการเข้าสังคม)",
    "lifespan": "10 – 13 ปี",
    "food": "",
    "care": "ปานกลาง (ขนดูแลรักษาง่าย แต่ต้องการพื้นที่กว้างและการฝึกการเข้าสังคม)",
    "specialFeatures": "ขนสั้นถึงปานกลาง หนา แน่น มีชั้นขนใต้ปกป้องจากอากาศ",
    "image": "",
    "recommended": false,
    "coat": "ขนสั้นถึงปานกลาง หนา แน่น มีชั้นขนใต้ปกป้องจากอากาศ",
    "friendliness": "ปานกลาง (รักและอ่อนโยนต่อคนในครอบครัวและเด็ก แต่หวงพื้นที่และระแวงสิ่งแปลกปลอม)",
    "beginnerSuitable": "ไม่เหมาะ (มีพลังแรงกัดสูง ต้องการผู้เลี้ยงมืออาชีพ)",
    "healthIssues": "โรคข้อสะโพกเสื่อม, โรคเนื้องอกใน lipoma, โรคตาตก",
    "monthlyCost": "ประมาณ 4,000 – 7,000 บาท"
  },
  {
    "name": "นโปลิตัน มาสทิฟฟ์",
    "scientificName": "Neapolitan Mastiff",
    "category": "สุนัข",
    "description": "ผิวหนังหนาหย่อนคล้อย มีรอยย่นเยอะมากทั่วใบหน้าและคอ ลำตัวใหญ่ยาวบึก",
    "characteristics": "ผิวหนังหนาหย่อนคล้อย มีรอยย่นเยอะมากทั่วใบหน้าและคอ ลำตัวใหญ่ยาวบึก",
    "personality": "เงียบสงบ เคลื่อนไหวช้า ป้องกันถิ่นฐาน ยักษ์ใหญ่สายปกป้อง",
    "difficulty": "ปานกลาง",
    "energy": "ไม่ระบุในเอกสาร",
    "size": "ใหญ่ยักษ์ (Giant)",
    "grooming": "สูง (ต้องคอยทำความสะอาดรอยย่นตามตัวและใบหน้าเพื่อป้องกันแบคทีเรีย และน้ำลายย้อยเยอะ)",
    "lifespan": "7 – 9 ปี",
    "food": "",
    "care": "สูง (ต้องคอยทำความสะอาดรอยย่นตามตัวและใบหน้าเพื่อป้องกันแบคทีเรีย และน้ำลายย้อยเยอะ)",
    "specialFeatures": "ขนสั้น หนา เรียบ สั้นติดผิวหนัง",
    "image": "",
    "recommended": false,
    "coat": "ขนสั้น หนา เรียบ สั้นติดผิวหนัง",
    "friendliness": "ปานกลาง (จงรักภักดีและติดเจ้าของมาก แต่สงวนท่าทีและพร้อมปกป้องจากคนแปลกหน้า)",
    "beginnerSuitable": "ไม่เหมาะ (ตัวใหญ่มาก มีความดื้อ และต้องการการควบคุมที่ดี)",
    "healthIssues": "โรคเชอร์รี่อาย (Cherry Eye), โรคข้อสะโพกเสื่อม, ผิวหนังอักเสบตามรอยย่น, กระเพาะอาหารบิดหมุน",
    "monthlyCost": "ประมาณ 4,500 – 7,500 บาท"
  },
  {
    "name": "ลีออนเบอร์เกอร์",
    "scientificName": "Leonberger",
    "category": "สุนัข",
    "description": "สง่างาม สมส่วน หน้ามืด (Black mask) หูตก อกกว้าง กล้ามเนื้อแน่น",
    "characteristics": "สง่างาม สมส่วน หน้ามืด (Black mask) หูตก อกกว้าง กล้ามเนื้อแน่น",
    "personality": "สุขุม อ่อนโยน มั่นใจ ไม่ก้าวร้าว ชอบทำกิจกรรมกลางแจ้งและเล่นน้ำ",
    "difficulty": "ปานกลาง",
    "energy": "ไม่ระบุในเอกสาร",
    "size": "ใหญ่ยักษ์ (Giant)",
    "grooming": "สูง (ต้องแปรงขนสม่ำเสมอเพื่อป้องกันขนพันกัน และชอบลุยน้ำ/บึง)",
    "lifespan": "8 – 10 ปี",
    "food": "",
    "care": "สูง (ต้องแปรงขนสม่ำเสมอเพื่อป้องกันขนพันกัน และชอบลุยน้ำ/บึง)",
    "specialFeatures": "ขนสองชั้น ยาว สลวย นุ่ม กันน้ำ มีแผงขนรอบคอชัดเจนคล้ายสิงโต",
    "image": "",
    "recommended": false,
    "coat": "ขนสองชั้น ยาว สลวย นุ่ม กันน้ำ มีแผงขนรอบคอชัดเจนคล้ายสิงโต",
    "friendliness": "สูง (ปรับตัวเก่ง เป็นมิตรกับทุกคน รักเด็ก และเข้ากับสัตว์อื่นได้ดี)",
    "beginnerSuitable": "ปานกลาง (อารมณ์ดี ฝึกง่าย แต่ต้องการเวลาในการดูแลขนและออกกำลังกาย)",
    "healthIssues": "โรคข้อสะโพก/ข้อศอกเสื่อม, มะเร็งกระดูก, กระเพาะอาหารบิดหมุน (Bloat)",
    "monthlyCost": "ประมาณ 5,000 – 8,000 บาท"
  },
  {
    "name": "บอร์โด มาสทิฟ หรือ ด็อก เดอ บอร์โด",
    "scientificName": "Dogue de Bordeaux",
    "category": "สุนัข",
    "description": "ศีรษะใหญ่ที่สุดในบรรดาสุนัขทั้งหมด ใบหน้ามีย่นลึก อกลึกกว้าง ลำตัวมีกล้ามเนื้อแน่น",
    "characteristics": "ศีรษะใหญ่ที่สุดในบรรดาสุนัขทั้งหมด ใบหน้ามีย่นลึก อกลึกกว้าง ลำตัวมีกล้ามเนื้อแน่น",
    "personality": "สงบ ซื่อสัตย์ มีสัญชาตญาณเฝ้าบ้านและอารักขาที่สุขุม",
    "difficulty": "ง่าย",
    "energy": "ไม่ระบุในเอกสาร",
    "size": "ใหญ่ยักษ์ (Giant)",
    "grooming": "ปานกลาง (ขนสั้นดูแลง่าย แต่ต้องทำความสะอาดรอยย่นบนหน้าและคอยเช็ดน้ำลาย)",
    "lifespan": "5 – 8 ปี (อายุขัยค่อนข้างสั้น)",
    "food": "",
    "care": "ปานกลาง (ขนสั้นดูแลง่าย แต่ต้องทำความสะอาดรอยย่นบนหน้าและคอยเช็ดน้ำลาย)",
    "specialFeatures": "ขนสั้น สั้นนุ่ม สีน้ำตาลแดง/ขนบก",
    "image": "",
    "recommended": false,
    "coat": "ขนสั้น สั้นนุ่ม สีน้ำตาลแดง/ขนบก",
    "friendliness": "สูง (ผูกพันกับครอบครัวมาก อ่อนโยนและอดทนต่อเด็ก)",
    "beginnerSuitable": "ไม่เหมาะ (ตัวใหญ่ กำลังเยอะ และอาจมีอารมณ์ดื้อรั้นหากไม่ฝึกให้ดี)",
    "healthIssues": "โรคหัวใจ (Dilated Cardiomyopathy), โรคข้อสะโพกเสื่อม, กระเพาะอาหารบิดหมุน, โรคทางเดินหายใจ",
    "monthlyCost": "ประมาณ 4,500 – 7,500 บาท"
  }
];

// ---------- Admin Comments ----------
app.get("/api/admin/comments", auth, adminOnly, async (req, res) => {
  try {
    const comments = await db.collection("comments")
      .find()
      .sort({ createdAt: -1 })
      .toArray();

    // ดึงข้อมูลชื่อสัตว์เลี้ยงเพื่อแสดงผลประกอบ
    const petIds = comments.map(c => {
      try { return new ObjectId(c.petId); } catch { return null; }
    }).filter(Boolean);

    const pets = await db.collection("pets")
      .find({ _id: { $in: petIds } })
      .toArray();

    const petMap = {};
    pets.forEach(p => { petMap[p._id.toString()] = p.name; });

    // รวบรวมข้อมูลส่งกลับ
    const result = comments.map(c => ({
      _id: c._id,
      petName: petMap[c.petId] || "สัตว์เลี้ยง",
      username: c.username || "ผู้ใช้งาน",
      comment: c.comment,
      createdAt: c.createdAt
    }));

    res.json(result);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "เกิดข้อผิดพลาดในการดึงข้อมูลความคิดเห็น" });
  }
});

app.delete("/api/admin/comments/:id", auth, adminOnly, async (req, res) => {
  try {
    await db.collection("comments").deleteOne({ _id: new ObjectId(req.params.id) });
    res.json({ message: "ลบความคิดเห็นสำเร็จ" });
  } catch (err) {
    res.status(400).json({ message: "ID ไม่ถูกต้อง" });
  }
});

async function seed() {
  const categories = db.collection("categories");
  if (await categories.countDocuments() === 0) {
    await categories.insertMany([
      { name: "สุนัข", description: "สัตว์เลี้ยงลูกด้วยนมกลุ่มสุนัข", createdAt: new Date() },
      { name: "แมว", description: "สัตว์เลี้ยงลูกด้วยนมกลุ่มแมว", createdAt: new Date() },
      { name: "นก", description: "สัตว์ปีกที่เหมาะสำหรับเลี้ยง", createdAt: new Date() },
      { name: "ปลา", description: "สัตว์น้ำสำหรับเลี้ยงในตู้หรือบ่อ", createdAt: new Date() },
      { name: "สัตว์เลื้อยคลาน", description: "สัตว์เลื้อยคลานหลากหลายชนิด", createdAt: new Date() },
      { name: "สัตว์ฟันแทะ", description: "สัตว์ฟันแทะขนาดเล็ก", createdAt: new Date() }
    ]);
  }
  await categories.updateOne(
    { name: "แมว" },
    { $setOnInsert: { description: "ข้อมูลสายพันธุ์แมวสำหรับระบบแนะนำสัตว์เลี้ยง", createdAt: new Date() } },
    { upsert: true }
  );

  const users = db.collection("users");
  const adminEmail = "admin@petguide.com";
  if (!(await users.findOne({ email: adminEmail }))) {
    await users.insertOne({
      username: "Admin",
      email: adminEmail,
      password: await bcrypt.hash("admin123", 10),
      role: "admin",
      createdAt: new Date()
    });
  }

  const pets = db.collection("pets");
  if (await pets.countDocuments() === 0) {
    await pets.insertMany([
      {
        name: "Golden Retriever",
        scientificName: "Canis lupus familiaris",
        category: "สุนัข",
        description: "สุนัขที่เป็นมิตร ฉลาด และชอบทำกิจกรรมร่วมกับคน",
        characteristics: "ขนาดกลางถึงใหญ่ ขนสองชั้น สีทอง",
        personality: "เป็นมิตร ร่าเริง เรียนรู้ได้ดี",
        difficulty: "ปานกลาง", energy: "สูง", size: "ใหญ่", grooming: "ปานกลาง",
        lifespan: "10–12 ปี", food: "อาหารสุนัขที่เหมาะสมกับวัยและกิจกรรม",
        care: "ต้องการการออกกำลังกายและการฝึกอย่างสม่ำเสมอ",
        specialFeatures: "เหมาะกับกิจกรรมและการฝึกหลายรูปแบบ",
        image: "https://images.unsplash.com/photo-1552053831-71594a27632d?auto=format&fit=crop&w=900&q=80",
        recommended: true, createdAt: new Date(), updatedAt: new Date()
      },
      {
        name: "Leopard Gecko",
        scientificName: "Eublepharis macularius",
        category: "สัตว์เลื้อยคลาน",
        description: "ตุ๊กแกขนาดเล็กที่มีลวดลายบนลำตัวและเหมาะกับการเลี้ยงในพื้นที่ควบคุม",
        characteristics: "ตัวเล็ก มีลวดลาย หางอวบ",
        personality: "ค่อนข้างสงบ",
        difficulty: "ปานกลาง", energy: "ต่ำ", size: "เล็ก", grooming: "ต่ำ",
        lifespan: "10–20 ปี", food: "แมลงที่เหมาะสม",
        care: "จัดสภาพแวดล้อม อุณหภูมิ และที่หลบซ่อนให้เหมาะสม",
        specialFeatures: "ลวดลายหลากหลายและดูแลขนไม่ต้องใช้",
        image: "https://images.unsplash.com/photo-1520637836862-4d197d17c35a?auto=format&fit=crop&w=900&q=80",
        recommended: true, createdAt: new Date(), updatedAt: new Date()
      },
      {
        name: "Betta Fish",
        scientificName: "Betta splendens",
        category: "ปลา",
        description: "ปลาสวยงามที่มีครีบและสีสันหลากหลาย",
        characteristics: "ขนาดเล็ก สีสันหลากหลาย ครีบโดดเด่น",
        personality: "มีพฤติกรรมเฉพาะตัวและอาจหวงพื้นที่",
        difficulty: "ง่าย", energy: "ต่ำ", size: "เล็ก", grooming: "ต่ำ",
        lifespan: "2–4 ปี", food: "อาหารปลากัดที่เหมาะสม",
        care: "รักษาคุณภาพน้ำและจัดภาชนะให้เหมาะสม",
        specialFeatures: "มีสีและรูปทรงครีบหลากหลาย",
        image: "https://images.unsplash.com/photo-1520990265275-0d9c9d9b9c6c?auto=format&fit=crop&w=900&q=80",
        recommended: false, createdAt: new Date(), updatedAt: new Date()
      }
    ]);
  }

  const now = new Date();
  await pets.bulkWrite(catBreeds.map((cat) => ({
    updateOne: {
      filter: { name: cat.name, category: cat.category },
      update: { $set: { ...cat, updatedAt: now }, $setOnInsert: { createdAt: now } },
      upsert: true
    }
  })));
}

async function start() {
  const client = new MongoClient(MONGODB_URI);
  await client.connect();
  db = client.db(DB_NAME);
  await seed();
  app.listen(PORT, () => {
    console.log(`PetGuide running at http://localhost:${PORT}`);
    console.log(`MongoDB database: ${DB_NAME}`);
  });
}

start().catch(err => {
  console.error("Cannot start server:", err);
  process.exit(1);
});

// ---------- Update Profile ----------
app.put("/api/auth/profile", auth, async (req, res) => {
  try {
    const newUsername = String(req.body.username || "").trim();
    if (!newUsername) {
      return res.status(400).json({ message: "กรุณาระบุชื่อผู้ใช้" });
    }

    // อัปเดตเฉพาะชื่อผู้ใช้ (username) โดยไม่อนุญาตให้เปลี่ยน email
    await db.collection("users").updateOne(
      { _id: new ObjectId(req.user.id) },
      { $set: { username: newUsername, updatedAt: new Date() } }
    );

    // ส่งข้อมูลผู้ใช้ฉบับอัปเดตกลับไป
    const updatedUser = await db.collection("users").findOne(
      { _id: new ObjectId(req.user.id) },
      { projection: { password: 0 } }
    );

    res.json({
      message: "อัปเดตโปรไฟล์สำเร็จ",
      user: {
        id: updatedUser._id,
        username: updatedUser.username,
        email: updatedUser.email,
        role: updatedUser.role
      }
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "เกิดข้อผิดพลาดในการอัปเดตโปรไฟล์" });
  }
});
