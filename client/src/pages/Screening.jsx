import { useState } from "react";
import { API } from "../hooks/helper";

const samplePHQ = [
  "Little interest or pleasure in doing things",
  "Feeling down, depressed, or hopeless",
  "Trouble falling or staying asleep, or sleeping too much",
];

function ScreeningQuestion({ q, idx, onChange, value }) {
  return (
    <div className="mb-6">
      <div className="text-deep-blue font-medium text-lg mb-3">{idx + 1}. {q}</div>
      <select 
        className="w-full px-4 py-3 border border-gray-200 rounded-lg focus:border-calm-blue focus:ring-2 focus:ring-calm-blue focus:ring-opacity-20 transition-colors text-deep-blue font-sans" 
        value={value} 
        onChange={(e) => onChange(idx, Number(e.target.value))}
      >
        <option value={0}>Not at all</option>
        <option value={1}>Several days</option>
        <option value={2}>More than half the days</option>
        <option value={3}>Nearly every day</option>
      </select>
    </div>
  );
}

export default function Screening() {
  const [answers, setAnswers] = useState(Array(samplePHQ.length).fill(0));
  const [score, setScore] = useState(null);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState(null);

  function setAnswer(i, val) {
    const next = [...answers];
    next[i] = val;
    setAnswers(next);
  }

  function submit() {
    const s = answers.reduce((a, b) => a + b, 0);
    setScore(s);
    setLoading(true);
    setMessage(null);

    const url = API;

    fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ score: s }),
    })
      .then((r) => {
        if (!r.ok) throw new Error(`Status ${r.status}`);
        return r.json();
      })
      .then(() => setMessage("Screening submitted"))
      .catch(() => setMessage("Failed to submit screening"))
      .finally(() => setLoading(false));
  }

  return (
    <div className="bg-beige min-h-screen px-4 py-8 font-sans">
      <div className="max-w-2xl mx-auto">
        <h2 className="text-3xl font-bold text-deep-blue mb-2">Screening Tools (PHQ-9 prototype)</h2>
        <p className="text-deep-blue text-opacity-75 mb-8">This is a prototype demo of screening. Scores are illustrative only.</p>

        <div className="bg-white rounded-xl shadow-lg p-8">
          {samplePHQ.map((q, i) => (
            <ScreeningQuestion key={i} q={q} idx={i} onChange={setAnswer} value={answers[i]} />
          ))}

          <div className="mt-8 flex flex-col sm:flex-row items-start sm:items-center gap-4">
            <button 
              className="bg-warm-blue text-orange px-6 py-3 rounded-full font-medium hover:bg-blue-600 transition-colors shadow-lg disabled:opacity-50 disabled:cursor-not-allowed" 
              onClick={submit}
              disabled={loading}
            >
              {loading ? "Calculating..." : "Calculate"}
            </button>
            
            {score !== null && (
              <div className="bg-blue-50 text-deep-blue px-4 py-2 rounded-lg text-sm">
                Score: <strong className="font-semibold">{score}</strong> — low/medium/high (prototype)
              </div>
            )}
            
            {message && (
              <div className={`px-4 py-2 rounded-lg text-sm font-medium ${
                message.includes("Failed") 
                  ? "bg-red-50 text-critical-red" 
                  : "bg-green-50 text-green-700"
              }`}>
                {message}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}