import mongoose from "mongoose";

const workerSchema = new mongoose.Schema({
  username: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  name: { type: String, required: true },
  email: { type: String, required: true },
  workerDataId: { type: mongoose.Schema.Types.ObjectId, ref: "Worker" },
});

const WorkerLoginModel =
  mongoose.models.WorkerLoginModel ||
  mongoose.model("WorkerLoginModel", workerSchema);

export default WorkerLoginModel;
