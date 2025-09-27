const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
require("dotenv").config();

const app = express();
app.use(cors());
app.use(express.json());

// --- Connect to MongoDB ---
mongoose.connect(process.env.MONGO_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
})
  .then(() => console.log("MongoDB connected"))
  .catch(err => console.error(err));

// --- PHQ9 Schema & Model ---
const phq9Schema = new mongoose.Schema({
  user_email: { type: String, required: true },
  answers: { type: [Number], required: true },
  totalScore: Number,
  severity: String,
  submittedAt: { type: Date, default: Date.now }
});

const Phq9Model = mongoose.model("PHQ9", phq9Schema);

// --- Helper function to calculate total & severity ---
function calculatePHQ9Score(answers) {
  const totalScore = answers.reduce((acc, val) => acc + val, 0);
  let severity = "Minimal";
  if (totalScore >= 5 && totalScore <= 9) severity = "Mild";
  else if (totalScore >= 10 && totalScore <= 14) severity = "Moderate";
  else if (totalScore >= 15 && totalScore <= 19) severity = "Moderately severe";
  else if (totalScore >= 20) severity = "Severe";
  return { totalScore, severity };
}

// --- POST /api/phq9 --- Submit PHQ-9
app.post("/api/phq9", async (req, res) => {
  try {
    const { user_email, answers } = req.body;
    if (!user_email || !answers || answers.length !== 9) {
      return res.status(400).json({ message: "Invalid submission" });
    }

    const { totalScore, severity } = calculatePHQ9Score(answers);

    const phqEntry = new Phq9Model({ user_email, answers, totalScore, severity });
    await phqEntry.save();

    res.json({ message: "PHQ-9 submitted successfully", totalScore, severity });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error" });
  }
});

// --- GET /api/phq9-results --- Fetch all PHQ-9 results
app.get("/api/phq9-results", async (req, res) => {
  try {
    const results = await Phq9Model.find({});
    res.json({ results });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error" });
  }
});

// --- Start Server ---
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
