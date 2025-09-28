import React, { useMemo, useState, useRef, useEffect } from "react";
import { API } from "../hooks/helper";
import { toast } from 'react-toastify';

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
  const toastTimer = useRef(null);

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
      const base = API;
      const url = `${base.replace(/\/$/, "")}/api/phq9`;
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ user_email: user.email, answers }),
      });
      if (!res.ok) {
        // try to read error message
        let msg = "Failed to submit";
        try {
          const errBody = await res.json();
          if (errBody && errBody.error) msg = errBody.error;
        } catch (_) {}
        // show global error toast
        toast.error(msg);
        setSubmitting(false);
        return;
      }

      // success: show global toast and local toast
      toast.success('PHQ-9 submitted successfully');
      onSubmitted && onSubmitted();
      // auto-close modal shortly after showing toast
      toastTimer.current = setTimeout(() => {
        onClose && onClose();
      }, 1200);
    } catch (e) {
      const msg = e.message || "Submission failed";
      toast.error(msg);
    } finally {
      setSubmitting(false);
    }
  };

  useEffect(() => {
    return () => {
      if (toastTimer.current) clearTimeout(toastTimer.current);
    };
  }, []);

  return (
    <div className="fixed inset-0 z-50">
      {/* muted background + subtle dark overlay matching global design */}
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />

      {/* Centered semi-transparent card (design tokens applied) */}
      <div className="relative mx-auto my-10 max-w-6xl rounded-2xl shadow-xl bg-white/70 border border-[#E6E6E6] overflow-hidden">
        {/* changed to 12-col grid so left panel can be narrower */}
        <div className="grid grid-cols-1 md:grid-cols-12">
          {/* Left: Brand / intro panel (narrower: col-span-4) */}
          <div className="hidden md:flex flex-col items-center justify-center p-6 md:col-span-4 bg-gradient-to-b from-white to-[#F7F8FA]">
            <div className="w-28 h-28 rounded-xl bg-white flex items-center justify-center shadow-md border border-gray-100">
              <img src="/mindsphere-logo.png" alt="MindSphere" className="w-20 h-20" />
            </div>
            <h3 className="mt-6 text-2xl font-semibold text-[#263238]">PHQ‑9 Screening</h3>
            <p className="mt-3 text-sm text-[#90A4AE] text-center px-4">
              Quick self-assessment to help identify depressive symptoms. This is not a diagnosis for urgent care, contact your local services.
            </p>

            <div className="mt-6 w-full px-4">
              <div className="p-3 rounded-lg bg-[#EAF4FF] border border-[#D7EDF9]">
                <p className="text-sm text-[#1E6FB3]">
                  Note: Your responses are saved to your account and help us provide better support recommendations.
                </p>
              </div>
            </div>
          </div>

          {/* Right: Questions / form panel (wider: col-span-8) */}
          <div className="p-6 md:p-8 md:col-span-8">
            <div className="flex items-start justify-between mb-7">
              <div>
                <h2 className="text-2xl font-semibold text-[#263238]">PHQ‑9 Questionnaire</h2>
                <p className="text-sm text-[#263238] mt-1">Over the last 2 weeks, how often have you been bothered by the following problems?</p>
              </div>
              <button
                onClick={onClose}
                aria-label="Close"
                className="ml-4 p-2 rounded-md text-[#263238] hover:text-[#FF8C42] focus:outline-none focus:ring-2 focus:ring-[#FF8C42]/30 cursor-pointer transition-transform transform hover:scale-110 hover:bg-[#FF8C42]/10"
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>

            <div className="space-y-5 max-h-[60vh] overflow-y-auto pr-2">
              {questions.map((q, i) => (
                <div key={i} className="border border-[#263238]/20 rounded-lg p-4">
                  <div className="font-medium text-[#263238] mb-3">{i + 1}. {q}</div>
                  <div className="flex flex-col sm:flex-row gap-2">
                    {[0,1,2,3].map((v) => {
                      const selected = answers[i] === v;
                      return (
                        <label
                          key={v}
                          tabIndex={0}
                          className={`flex items-center gap-3 px-3 py-2 rounded-lg cursor-pointer border transition-all duration-150 transform-gpu hover:scale-100 hover:bg-[#FF8C42]/10 hover:shadow-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-[#FF8C42]/30 ${
                            selected
                              ? 'bg-white/60 border-[#FF8C42] text-[#263238]'
                              : 'bg-white border-[#E6E6E6] text-[#263238]'
                          }`}
                        >
                          <input
                            type="radio"
                            name={`q${i}`}
                            value={v}
                            checked={selected}
                            onChange={() => setAnswer(i, v)}
                            className="accent-[#FF8C42] focus:ring-0"
                          />
                          <span className="text-sm">
                            {v === 0 ? "Not at all" : v === 1 ? "Several days" : v === 2 ? "More than half the days" : "Nearly every day"}
                          </span>
                        </label>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>

            {error && <div className="text-sm text-red-600 mt-3">{error}</div>}

            <div className="mt-6 flex flex-col sm:flex-row justify-end gap-3">
              <button
                onClick={onClose}
                className="w-full sm:w-auto px-4 py-2 rounded-lg bg-white/70 text-[#263238] border border-[#E6E6E6] hover:bg-white focus:outline-none focus:ring-2 focus:ring-[#FF8C42]/30 cursor-pointer"
              >
                Cancel
              </button>

              <button
                onClick={submit}
                disabled={!allAnswered || submitting}
                className="w-full sm:w-auto px-4 py-2 rounded-lg bg-[#FF8C42] text-white font-semibold shadow-sm hover:bg-[#e6732f] disabled:opacity-60 focus:outline-none focus:ring-2 focus:ring-[#FF8C42]/30 cursor-pointer"
              >
                {submitting ? "Submitting..." : "Submit"}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}


