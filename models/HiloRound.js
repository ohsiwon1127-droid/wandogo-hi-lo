// models/HiloRound.js
const mongoose = require("mongoose");

const cardSchema = new mongoose.Schema(
  {
    value: { type: Number, required: true }, // 2~14
    rank: { type: String, required: true },  // '2'..'10','J','Q','K','A'
    suit: { type: String, required: true },  // S,H,D,C
  },
  { _id: false }
);

const historyEntrySchema = new mongoose.Schema(
  {
    card: { type: cardSchema, required: true },
    direction: { type: String, enum: ["higher", "lower"], required: true },
    win: { type: Boolean, required: true },
    multiplierAfter: { type: Number, required: true },
  },
  { _id: false }
);

const hiloRoundSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    betAmount: { type: Number, required: true, min: 1 },
    currentCard: { type: cardSchema, required: true },
    multiplier: { type: Number, required: true, default: 1 },
    history: { type: [historyEntrySchema], default: [] },
    status: {
      type: String,
      enum: ["active", "lost", "cashed_out"],
      default: "active",
      index: true,
    },
    payout: { type: Number, default: 0 },
  },
  { timestamps: true }
);

hiloRoundSchema.index({ userId: 1, status: 1 });

module.exports = mongoose.models.HiloRound || mongoose.model("HiloRound", hiloRoundSchema);
