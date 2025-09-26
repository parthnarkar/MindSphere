import React, { useMemo, useState } from "react";
import { API } from "../hooks/helper";

export default function PHQ9Modal({ user, open, onClose, onSubmitted }) {
  const questions = useMemo(() => [
    "Little interest or pleasure in doing things",
    "Feeling down, depressed, or hopeless",
    "Trouble falling or staying asleep, or sleeping too much",
    "Feeling tired or having little energy",
    "Poor appetite or overeating",
    "Feeling bad about yourself — or that you are a failure or have let yourself or your family down",
    "Trouble concentrating on things, such as reading the newspaper or watching television",
    "Moving or speaking so slowly that other people could have noticed? Or the opposite — being so fidgety or restless that you have been moving around a lot more than usual",
    "Thoughts that you would be better off dead, or of hurting yourself",
  ], []);

  const [answers, setAnswers] = useState(Array(9).fill(null));
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  if (!open) return null;

  const setAnswer = (idx, val) => {
    const copy = [...answers];
    copy[idx] = val;
    setAnswers(copy);
  };

  const allAnswered = answers.every((a) => a !== null);

  const submit = async () => {
    if (!user?.email) return;
    if (!allAnswered) {
      setError("Please answer all questions.");
      return;
    }
    setSubmitting(true);
    setError("");
    try {
      const base = API || "http://localhost:5000";
      const url = `${base.replace(/\/$/, "")}/api/phq9`;
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ user_email: user.email, answers }),
      });
      if (!res.ok) throw new Error("Failed to submit");
      onSubmitted && onSubmitted();
      onClose && onClose();
    } catch (e) {
      setError(e.message || "Submission failed");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full p-6 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-semibold">PHQ-9 Questionnaire</h2>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-700">✕</button>
        </div>
        <p className="text-sm text-gray-600 mb-4">Over the last 2 weeks, how often have you been bothered by the following problems?</p>

        <div className="space-y-4">
          {questions.map((q, i) => (
            <div key={i} className="border rounded p-3">
              <div className="font-medium mb-2">{i + 1}. {q}</div>
              <div className="flex flex-col sm:flex-row gap-2">
                {[0,1,2,3].map((v) => (
                  <label key={v} className={`flex items-center gap-2 px-3 py-2 rounded border cursor-pointer ${answers[i]===v?"bg-blue-50 border-blue-400":"bg-white"}`}>
                    <input
                      type="radio"
                      name={`q${i}`}
                      value={v}
                      checked={answers[i] === v}
                      onChange={() => setAnswer(i, v)}
                    />
                    <span>
                      {v === 0 ? "Not at all" : v === 1 ? "Several days" : v === 2 ? "More than half the days" : "Nearly every day"}
                    </span>
                  </label>
                ))}
              </div>
            </div>
          ))}
        </div>

        {error && <div className="text-sm text-red-600 mt-3">{error}</div>}

        <div className="mt-6 flex justify-end gap-3">
          <button onClick={onClose} className="px-4 py-2 rounded border">Cancel</button>
          <button onClick={submit} disabled={!allAnswered || submitting} className="px-4 py-2 rounded bg-blue-600 text-white disabled:opacity-60">
            {submitting ? "Submitting..." : "Submit"}
          </button>
        </div>
      </div>
    </div>
  );
}


