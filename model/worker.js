import mongoose from "mongoose";

const workerSchema = new mongoose.Schema({
  name: { type: String, required: true, unique: true },
  shifts: [
    {
      day: { type: String, required: true },
      date: { type: Date, required: true },
      shiftType: { type: String, required: true },

      _id: { type: mongoose.Schema.Types.ObjectId, auto: true },
    },
  ],
});

const Worker = mongoose.models.Worker || mongoose.model("Worker", workerSchema);

export default Worker;
