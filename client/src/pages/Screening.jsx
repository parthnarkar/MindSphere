import { useState } from "react";
import { API } from "../hooks/helper";

const samplePHQ = [
  "Little interest or pleasure in doing things",
  "Feeling down, depressed, or hopeless",
  "Trouble falling or staying asleep, or sleeping too much",
];


function ScreeningQuestion({ q, idx, onChange, value }) {
  return (
    <div className="mb-3">
      <div className="font-medium">{idx + 1}. {q}</div>
      <select className="mt-1 border rounded px-2 py-1" value={value} onChange={(e) => onChange(idx, Number(e.target.value))}>
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
    <div>
      <h2 className="text-2xl font-semibold mb-4">Screening Tools (PHQ-9 prototype)</h2>
      <p className="text-sm text-gray-600 mb-4">This is a prototype demo of screening. Scores are illustrative only.</p>

      <div className="bg-white p-4 rounded shadow">
        {samplePHQ.map((q, i) => (
          <ScreeningQuestion key={i} q={q} idx={i} onChange={setAnswer} value={answers[i]} />
        ))}

        <div className="mt-4 flex items-center gap-2">
          <button className="bg-green-600 text-white px-4 py-2 rounded" onClick={submit}>Calculate</button>
          {score !== null && <div className="text-sm">Score: <strong>{score}</strong> — low/medium/high (prototype)</div>}
        </div>
      </div>
    </div>
  );
}
