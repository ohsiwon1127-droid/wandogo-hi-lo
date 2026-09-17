// models/User.js
const mongoose = require("mongoose");

const userSchema = new mongoose.Schema(
  {
    username: { type: String, required: true, unique: true, trim: true, minlength: 3, maxlength: 20 },
    passwordHash: { type: String, required: true },
    balance: { type: Number, required: true, default: 10000, min: 0 },
  },
  { timestamps: true }
);

module.exports = mongoose.models.User || mongoose.model("User", userSchema);
