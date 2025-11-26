import express from "express";
import cors from "cors";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import cookieParser from "cookie-parser";
import { connectdb } from "./config/db.js";
import WorkerModel from "./model/worker.js";
import WorkerLoginModel from "./model/workerLoginModel.js";
import Admin from "./model/adminModel.js";
import Schedule from "./model/schedule.js";

const app = express();
const PORT = 5000;
const JWT_SECRET = process.env.JWT_SECRET || "your_jwt_secret_key";

app.use(express.json());
app.use(cookieParser());
app.use(
  cors({
    origin: (origin, callback) => {
      const allowedOrigins = [
        "http://localhost:5173",
        "http://localhost:5174",
        "https://shiftflow-workers.netlify.app",
        "https://shiftflow-admin.netlify.app",
      ];
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
      { expiresIn: "1h" }
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
      { expiresIn: "1d" }
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

// Middleware for authentication
function authenticateToken(req, res, next) {
  const token = req.cookies.token || req.cookies.workerToken;
  if (!token) return res.status(401).json({ message: "Access token required" });
  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) return res.status(403).json({ message: "Invalid token" });
    req.user = user;
    next();
  });
}

// Worker endpoints
app.use("/api/workers", authenticateToken);

app.post("/api/workers/register", async (req, res) => {
  try {
    const { name, username, email, password } = req.body;
    if (!name || !username || !password || !email)
      return res.status(400).json({ message: "All fields are required" });

    const existingUser = await WorkerLoginModel.findOne({ username });
    if (existingUser)
      return res.status(409).json({ message: "Username already exists" });

    const workerData = new WorkerModel({ name });
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

app.get("/api/workers", async (req, res) => {
  try {
    const workers = await WorkerModel.find();
    res.json(workers);
  } catch (err) {
    res.status(500).json({ message: "Failed to get workers" });
  }
});

// توزيع الورديات إلى مجموعتين
function assignShiftsToWorkers(workers, from, to) {
  let days = [];
  let current = new Date(from);
  let last = new Date(to);
  while (current <= last) {
    days.push(new Date(current));
    current.setDate(current.getDate() + 1);
  }

  let n = workers.length;
  let morningEveningCount = Math.ceil(n / 2);
  let afternoonCount = n - morningEveningCount;

  let assignments = [];

  // مجموعة صباح+مساء
  for (let i = 0; i < morningEveningCount; i++) {
    let worker = workers[i];
    let shifts = [];
    for (let day of days) {
      shifts.push({ date: day, shiftType: "morning" });
      shifts.push({ date: day, shiftType: "evening" });
    }
    assignments.push({ worker: worker._id, shifts });
  }

  // مجموعة بعد الظهر فقط
  for (let i = morningEveningCount; i < n; i++) {
    let worker = workers[i];
    let shifts = [];
    for (let day of days) {
      shifts.push({ date: day, shiftType: "afternoon" });
    }
    assignments.push({ worker: worker._id, shifts });
  }

  return assignments;
}

// Schedule creation
app.post("/api/schedules/create-auto", async (req, res) => {
  try {
    const { from, to, title } = req.body;
    const existingSchedule = await Schedule.findOne({
      "period.from": from,
      "period.to": to,
    });
    if (existingSchedule)
      return res
        .status(409)
        .json({ message: "Schedule already exists for this period." });

    const workers = await WorkerModel.find();
    if (!workers.length)
      return res.status(400).json({ message: "No workers to schedule." });

    const assignments = assignShiftsToWorkers(workers, from, to);

    const schedule = new Schedule({
      title: title || `Schedule for ${from} to ${to}`,
      period: { from, to },
      assignments,
    });
    await schedule.save();
    res.status(201).json({ message: "Schedule created.", schedule });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// إضافة عامل إلى جدول موجود (الجديد)
app.post("/api/schedules/:scheduleId/add-worker", async (req, res) => {
  try {
    const { scheduleId } = req.params;
    const { workerId } = req.body;
    const schedule = await Schedule.findById(scheduleId);
    if (!schedule)
      return res.status(404).json({ message: "Schedule not found" });

    // منع إضافة العامل مرتين
    if (schedule.assignments.some((a) => a.worker.toString() === workerId))
      return res.status(400).json({ message: "Worker already in schedule" });

    // توزيع الورديات له فقط (يمكنك التعديل حسب الخوارزمية)
    let days = [];
    let current = new Date(schedule.period.from);
    let last = new Date(schedule.period.to);
    while (current <= last) {
      days.push(new Date(current));
      current.setDate(current.getDate() + 1);
    }
    // توزيع افتراضي afternoon، ويمكنك التخصيص للخوارزمية المرغوبة هنا
    const shifts = days.map((date) => ({ date, shiftType: "afternoon" }));
    schedule.assignments.push({ worker: workerId, shifts });

    await schedule.save();
    res.json({ message: "Worker added to schedule", schedule });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

app.get("/api/schedules", async (req, res) => {
  try {
    const schedules = await Schedule.find().populate(
      "assignments.worker",
      "name"
    );
    res.json(schedules);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// تعديل وردية أو إضافة عطلة
app.put(
  "/api/schedules/:scheduleId/assignment/:assignmentId",
  async (req, res) => {
    try {
      const { scheduleId, assignmentId } = req.params;
      const { editShiftDate, newShiftType, removeAllShiftsOnDate } = req.body;
      const schedule = await Schedule.findById(scheduleId);
      if (!schedule)
        return res.status(404).json({ message: "Schedule not found" });

      const assignment = schedule.assignments.id(assignmentId);
      if (!assignment)
        return res.status(404).json({ message: "Assignment not found" });

      // إذا عُدل اليوم إلى Holiday: اجعل اليوم بدون ورديات
      if (editShiftDate && newShiftType === "Holiday") {
        assignment.shifts = assignment.shifts.filter(
          (s) => formatDate(s.date) !== editShiftDate
        );
      }
      // إذا عُدل إلى "afternoon": احذف كل الورديات في اليوم وضع فقط afternoon
      else if (editShiftDate && newShiftType === "afternoon") {
        assignment.shifts = assignment.shifts.filter(
          (s) => formatDate(s.date) !== editShiftDate
        );
        let newDate = new Date(editShiftDate);
        assignment.shifts.push({ date: newDate, shiftType: "afternoon" });
      }
      // إذا عُدل إلى "morning" أو "evening": احذف غيرها وأضف الجديدة
      else if (
        editShiftDate &&
        (newShiftType === "morning" || newShiftType === "evening")
      ) {
        assignment.shifts = assignment.shifts.filter(
          (s) => formatDate(s.date) !== editShiftDate
        );
        let newDate = new Date(editShiftDate);
        assignment.shifts.push({ date: newDate, shiftType: newShiftType });
      }

      // حذف جميع الورديات لهذا اليوم (عطلة بواسطة زر الحذف)
      if (removeAllShiftsOnDate) {
        assignment.shifts = assignment.shifts.filter(
          (s) => formatDate(s.date) !== removeAllShiftsOnDate
        );
      }

      await schedule.save();
      res.json({ message: "Assignment updated", assignment });
    } catch (err) {
      res.status(400).json({ message: err.message });
    }
  }
);

// استرجع جميع الورديات لهذا العامل من جميع الجداول
app.get("/api/worker/:workerId/schedule", async (req, res) => {
  try {
    const { workerId } = req.params;
    const schedules = await Schedule.find({ "assignments.worker": workerId });

    let allShifts = [];
    schedules.forEach((schedule) => {
      schedule.assignments.forEach((a) => {
        if (a.worker.toString() === workerId) {
          a.shifts.forEach((s) => {
            allShifts.push({
              date: formatDate(s.date),
              shiftType: s.shiftType,
            });
          });
        }
      });
    });

    res.json({ shifts: allShifts });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// حذف جميع جداول العمل في فترة محددة
app.delete("/api/schedules/delete-range", async (req, res) => {
  try {
    const { from, to } = req.query;
    if (!from || !to)
      return res
        .status(400)
        .json({ message: "from and to dates are required" });

    const result = await Schedule.deleteMany({
      "period.from": { $gte: new Date(from) },
      "period.to": { $lte: new Date(to) },
    });

    res.json({
      message: "Work schedules deleted.",
      count: result.deletedCount,
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

app.delete("/api/workers/:workerId", async (req, res) => {
  try {
    const { workerId } = req.params;

    // احذف العامل من WorkerModel
    await WorkerModel.findByIdAndDelete(workerId);

    // احذف بيانات تسجيل دخول العامل أيضاً
    await WorkerLoginModel.findOneAndDelete({ workerDataId: workerId });

    // احذف العامل من جميع جداول الورديات (Schedule)
    await Schedule.updateMany(
      {},
      { $pull: { assignments: { worker: workerId } } }
    );

    res.json({ message: "Worker and assignments deleted successfully" });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

app.delete(
  "/api/schedules/:scheduleId/assignment/:assignmentId",
  async (req, res) => {
    try {
      const { scheduleId, assignmentId } = req.params;
      const schedule = await Schedule.findById(scheduleId);
      if (!schedule)
        return res.status(404).json({ message: "Schedule not found" });

      schedule.assignments.id(assignmentId).remove();
      await schedule.save();
      res.json({ message: "Assignment deleted" });
    } catch (err) {
      res.status(400).json({ message: err.message });
    }
  }
);

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

// Helper to format date as YYYY-MM-DD
function formatDate(date) {
  const d = new Date(date);
  return d.toISOString().slice(0, 10);
}
