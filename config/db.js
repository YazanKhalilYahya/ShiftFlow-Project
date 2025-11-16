import mongoose from "mongoose";

export const connectdb = async () => {
  await mongoose
    .connect(
      "mongodb+srv://Deliveroo_App:DeliverooApp123%23%23@cluster0.fniktxt.mongodb.net/Deliveroo"
    )
    .then(() => console.log("DB connected"));
};
