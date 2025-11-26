import mongoose from "mongoose";

const assignmentSchema = new mongoose.Schema({
  worker: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Worker",
    required: true,
  },
  shifts: [
    {
      date: { type: Date, required: true },
      shiftType: {
        type: String,
        enum: ["morning", "afternoon", "evening"],
        required: true,
      },
    },
  ],
});

const scheduleSchema = new mongoose.Schema({
  title: { type: String }, // optional label for the schedule
  period: {
    from: { type: Date, required: true },
    to: { type: Date, required: true },
  },
  assignments: [assignmentSchema],
});

const Schedule =
  mongoose.models.Schedule || mongoose.model("Schedule", scheduleSchema);
export default Schedule;
