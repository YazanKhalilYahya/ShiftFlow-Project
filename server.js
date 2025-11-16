import express from "express";
import cors from "cors";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import cookieParser from "cookie-parser";
import { connectdb } from "./config/db.js";
import WorkerModel from "./model/worker.js";
import WorkerLoginModel from "./model/workerLoginModel.js";
import Admin from "./model/adminModel.js";

const app = express();
const PORT = 5000;
const JWT_SECRET = process.env.JWT_SECRET || "your_jwt_secret_key";

app.use(express.json());
app.use(cookieParser());
app.use(
  cors({
    origin: (origin, callback) => {
      const allowedOrigins = ["http://localhost:5173", "http://localhost:5174"];
      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        callback(new Error("Not allowed by CORS"));
      }
    },
    credentials: true,
  })
);

connectdb();

// Admin registration
app.post("/api/admin/register", async (req, res) => {
  try {
    const { username, password, email } = req.body;
    if (!username || !password || !email)
      return res
        .status(400)
        .json({ message: "Username, password, and email are required" });

    const exists = await Admin.findOne({ username });
    if (exists)
      return res.status(409).json({ message: "Username already exists" });

    const hash = await bcrypt.hash(password, 10);
    const admin = new Admin({ username, password: hash, email });
    await admin.save();
    res.status(201).json({ message: "Admin registered" });
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

// Admin login
app.post("/api/admin/login", async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password)
      return res
        .status(400)
        .json({ message: "Username and password required" });

    const admin = await Admin.findOne({ username });
    if (!admin) return res.status(401).json({ message: "Invalid credentials" });

    const valid = await bcrypt.compare(password, admin.password);
    if (!valid) return res.status(401).json({ message: "Invalid credentials" });

    const token = jwt.sign(
      { id: admin._id, username: admin.username },
      JWT_SECRET,
      {
        expiresIn: "1h",
      }
    );

    res.cookie("workerToken", token, {
      httpOnly: true,
      secure: false,
      sameSite: "lax",
      maxAge: 24 * 3600 * 1000,
    });
    res.json({ message: "Logged in successfully" });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Worker login
app.post("/api/worker/login", async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password)
      return res
        .status(400)
        .json({ message: "Username and password required" });

    const workerAuth = await WorkerLoginModel.findOne({ username });
    if (!workerAuth)
      return res.status(401).json({ message: "Invalid credentials" });

    const valid = await bcrypt.compare(password, workerAuth.password);
    if (!valid) return res.status(401).json({ message: "Invalid credentials" });

    const token = jwt.sign(
      { id: workerAuth._id, username: workerAuth.username },
      JWT_SECRET,
      {
        expiresIn: "1d",
      }
    );

    res.cookie("workerToken", token, {
      httpOnly: true,
      secure: false,
      sameSite: "strict",
      maxAge: 24 * 3600 * 1000,
    });

    res.json({
      message: "Logged in successfully",
      workerDataId: workerAuth.workerDataId,
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Middleware - session auth
function authenticateToken(req, res, next) {
  const token = req.cookies.token || req.cookies.workerToken;
  if (!token) return res.status(401).json({ message: "Access token required" });
  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) return res.status(403).json({ message: "Invalid token" });
    req.user = user;
    next();
  });
}

// Protect all worker routes
app.use("/api/workers", authenticateToken);

// Create worker with login
app.post("/api/workers/register", async (req, res) => {
  try {
    const { name, shifts, username, email, password } = req.body;
    if (!name || !username || !password || !email)
      return res.status(400).json({ message: "All fields are required" });

    const existingUser = await WorkerLoginModel.findOne({ username });
    if (existingUser)
      return res.status(409).json({ message: "Username already exists" });

    const workerData = new WorkerModel({ name, shifts });
    const savedWorker = await workerData.save();

    const hashedPassword = await bcrypt.hash(password, 10);

    const workerLogin = new WorkerLoginModel({
      name,
      username,
      password: hashedPassword,
      email,
      workerDataId: savedWorker._id,
    });
    await workerLogin.save();

    res.status(201).json({ message: "Worker successfully created" });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Basic CRUD on workers
app.post("/api/workers", async (req, res) => {
  try {
    const { name, shifts } = req.body;
    const worker = new WorkerModel({ name, shifts });
    await worker.save();
    res.status(201).json(worker);
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

app.get("/api/workers", async (req, res) => {
  try {
    const workers = await WorkerModel.find();
    res.json(workers);
  } catch (err) {
    res.status(500).json({ message: "Failed to get workers" });
  }
});

app.get("/api/workers/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const workerData = await WorkerModel.findById(id);
    if (!workerData)
      return res.status(404).json({ message: "Worker not found" });
    res.json(workerData);
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

app.put("/api/workers/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const { name, shifts } = req.body;
    const updatedWorker = await WorkerModel.findByIdAndUpdate(
      id,
      { name, shifts },
      { new: true, runValidators: true }
    );
    if (!updatedWorker)
      return res.status(404).json({ message: "Worker not found" });
    res.json(updatedWorker);
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

// Delete worker + login
app.delete("/api/workers/:id", async (req, res) => {
  try {
    const { id } = req.params;
    await WorkerLoginModel.deleteOne({ workerDataId: id });
    const deletedWorker = await WorkerModel.findByIdAndDelete(id);
    if (!deletedWorker)
      return res.status(404).json({ message: "Worker not found" });
    res.json({ message: "Worker deleted successfully" });
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

// Editing/deleting shifts for workers
app.put("/api/workers/:workerId/shifts/:shiftId", async (req, res) => {
  try {
    const { workerId, shiftId } = req.params;
    const { date, shiftType } = req.body;
    const worker = await WorkerModel.findById(workerId);
    if (!worker) return res.status(404).json({ message: "Worker not found" });
    const shift = worker.shifts.id(shiftId);
    if (!shift) return res.status(404).json({ message: "Shift not found" });
    if (date) shift.date = date;
    if (shiftType) shift.shiftType = shiftType;
    await worker.save();
    res.json({ message: "Shift updated", shift });
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

app.delete("/api/workers/:workerId/shifts/:shiftId", async (req, res) => {
  try {
    const { workerId, shiftId } = req.params;
    const worker = await WorkerModel.findById(workerId);
    if (!worker) return res.status(404).json({ message: "Worker not found" });
    worker.shifts.id(shiftId).remove();
    await worker.save();
    res.json({ message: "Shift deleted" });
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

// Workers login overview for dashboard (All Workers)
app.get("/api/workers/logins", async (req, res) => {
  try {
    const workers = await WorkerLoginModel.find({}, "name username email");
    res.json(workers);
  } catch (err) {
    res.status(500).json({ message: "Could not retrieve login workers" });
  }
});

// server.js

app.post("/api/logout", (req, res) => {
  res.clearCookie("workerToken");
  res.json({ message: "Logged out" });
});

app.get("/", (req, res) => {
  res.send("ShiftFlow API is Running");
});

app.listen(PORT, () =>
  console.log(`Server running on port http://localhost:${PORT}`)
);
