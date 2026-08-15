"use client";

import { useEffect, useRef, useState } from "react";

type Role = "user" | "assistant";

type Message = {
  id: string;
  role: Role;
  text: string;
};

type Status = "idle" | "loading" | "error";

type GamificationState = {
  userId: string;
  nickname: string;
  totalXp: number;
  level: number;
  xpIntoLevel: number;
  xpForNextLevel: number;
  currentStreak: number;
  longestStreak: number;
  badges: { code: string; name: string; icon: string | null; earnedAt: string }[];
  activeChallenges: {
    id: string;
    title: string;
    targetCount: number;
    currentCount: number;
    deadline: string;
    status: string;
  }[];
};

type LeaderboardEntry = {
  rank: number;
  userId: string;
  nickname: string;
  totalXp: number;
  level: number;
};

type Tab = "chat" | "leaderboard";

const ANON_ID_KEY = "fitnessCoach.anonUserId";
const NICKNAME_KEY = "fitnessCoach.nickname";

function newId() {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2);
}

async function apiFetch(path: string, anonUserId: string | null, init?: RequestInit) {
  const headers = new Headers(init?.headers);
  if (anonUserId) headers.set("x-anon-id", anonUserId);
  if (init?.body) headers.set("Content-Type", "application/json");
  return fetch(path, { ...init, headers });
}

function XpBar({ state }: { state: GamificationState }) {
  const pct =
    state.xpForNextLevel > 0
      ? Math.min(100, Math.round((state.xpIntoLevel / state.xpForNextLevel) * 100))
      : 100;
  return (
    <div className="flex flex-wrap items-center gap-4 border-b border-zinc-200 bg-white px-6 py-3 text-xs dark:border-zinc-800 dark:bg-zinc-950">
      <div className="flex items-center gap-2">
        <span className="rounded-full bg-[#0f1424] px-2 py-0.5 font-semibold text-white">
          Lv {state.level}
        </span>
        <span className="text-zinc-500 dark:text-zinc-400">{state.nickname}</span>
      </div>
      <div className="flex min-w-[140px] flex-1 items-center gap-2">
        <div className="h-2 flex-1 overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800">
          <div
            className="h-full rounded-full bg-[#0ca30c] transition-all"
            style={{ width: `${pct}%` }}
          />
        </div>
        <span className="whitespace-nowrap text-zinc-500 dark:text-zinc-400">
          {state.xpIntoLevel}/{state.xpForNextLevel} XP
        </span>
      </div>
      <div className="flex items-center gap-1 text-zinc-600 dark:text-zinc-300">
        🔥 <span className="font-medium">{state.currentStreak}</span> day streak
      </div>
      {state.badges.length > 0 && (
        <div className="flex items-center gap-1">
          {state.badges.slice(0, 6).map((b) => (
            <span key={b.code} title={b.name} className="text-base leading-none">
              {b.icon ?? "🏅"}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function NicknamePrompt({ onSubmit }: { onSubmit: (nickname: string) => void }) {
  const [value, setValue] = useState("");
  return (
    <div className="flex min-h-screen items-center justify-center bg-[#f9f9f7] px-6 dark:bg-[#0d0d0d]">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (value.trim().length >= 2) onSubmit(value.trim());
        }}
        className="w-full max-w-sm rounded-2xl border border-zinc-200 bg-white p-6 shadow-lg dark:border-zinc-800 dark:bg-zinc-950"
      >
        <div className="mb-4 text-2xl">🏋️</div>
        <h1 className="text-lg font-semibold text-black dark:text-white">Welcome to Fitness Coach</h1>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
          Pick a nickname for the leaderboard and your progress.
        </p>
        <input
          type="text"
          required
          minLength={2}
          maxLength={24}
          autoFocus
          placeholder="e.g. IronMike"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          className="mt-4 w-full rounded-lg border border-zinc-300 bg-white px-4 py-2.5 text-sm text-black placeholder:text-zinc-400 focus:border-zinc-500 focus:outline-none dark:border-zinc-700 dark:bg-zinc-900 dark:text-white"
        />
        <button
          type="submit"
          className="mt-4 w-full rounded-lg bg-[#0f1424] px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-[#1a2137]"
        >
          Start training
        </button>
      </form>
    </div>
  );
}

function LogWorkoutForm({
  onLogged,
}: {
  onLogged: (result: { xpAwarded: number; newBadges: { name: string }[] }) => void;
}) {
  const [activity, setActivity] = useState("");
  const [durationMinutes, setDurationMinutes] = useState("30");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const anonUserId = typeof window !== "undefined" ? localStorage.getItem(ANON_ID_KEY) : null;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!activity.trim() || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await apiFetch("/api/workouts", anonUserId, {
        method: "POST",
        body: JSON.stringify({
          activity: activity.trim(),
          performedAt: new Date().toISOString(),
          durationMinutes: parseInt(durationMinutes, 10) || 30,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Could not log workout.");
        return;
      }
      setActivity("");
      onLogged(data);
    } catch {
      setError("Could not reach the server. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-wrap items-center gap-2 border-t border-zinc-200 bg-zinc-50 px-6 py-3 dark:border-zinc-800 dark:bg-zinc-900/50">
      <input
        type="text"
        placeholder="Log a workout (e.g. Upper body strength)"
        value={activity}
        onChange={(e) => setActivity(e.target.value)}
        className="min-w-[180px] flex-1 rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-sm text-black placeholder:text-zinc-400 focus:border-zinc-500 focus:outline-none dark:border-zinc-700 dark:bg-zinc-900 dark:text-white"
      />
      <input
        type="number"
        min={1}
        value={durationMinutes}
        onChange={(e) => setDurationMinutes(e.target.value)}
        className="w-20 rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-sm text-black focus:border-zinc-500 focus:outline-none dark:border-zinc-700 dark:bg-zinc-900 dark:text-white"
      />
      <span className="text-xs text-zinc-500 dark:text-zinc-400">min</span>
      <button
        type="submit"
        disabled={submitting || !activity.trim()}
        className="rounded-lg bg-[#0ca30c] px-4 py-1.5 text-sm font-medium text-white transition-colors hover:bg-[#0a8a0a] disabled:cursor-not-allowed disabled:opacity-50"
      >
        Log workout
      </button>
      {error && <span className="text-xs text-[#d03b3b]">{error}</span>}
    </form>
  );
}

function Leaderboard({ anonUserId }: { anonUserId: string | null }) {
  const [entries, setEntries] = useState<LeaderboardEntry[]>([]);
  const [self, setSelf] = useState<LeaderboardEntry | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    apiFetch("/api/leaderboard?limit=50", anonUserId)
      .then((res) => res.json())
      .then((data) => {
        setEntries(data.entries ?? []);
        setSelf(data.self ?? null);
      })
      .finally(() => setLoading(false));
  }, [anonUserId]);

  if (loading) {
    return <div className="p-6 text-sm text-zinc-500 dark:text-zinc-400">Loading leaderboard…</div>;
  }

  return (
    <div className="mx-auto w-full max-w-2xl px-6 py-6">
      <h2 className="text-sm font-semibold text-black dark:text-white">Leaderboard</h2>
      <div className="mt-3 divide-y divide-zinc-200 rounded-xl border border-zinc-200 bg-white dark:divide-zinc-800 dark:border-zinc-800 dark:bg-zinc-950">
        {entries.length === 0 && (
          <div className="p-4 text-sm text-zinc-500 dark:text-zinc-400">No one on the board yet.</div>
        )}
        {entries.map((e) => (
          <div
            key={e.userId}
            className={`flex items-center justify-between px-4 py-2.5 text-sm ${
              e.userId === self?.userId ? "bg-[#0ca30c]/5" : ""
            }`}
          >
            <div className="flex items-center gap-3">
              <span className="w-6 text-zinc-400">#{e.rank}</span>
              <span className="font-medium text-black dark:text-white">{e.nickname}</span>
              <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-xs text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
                Lv {e.level}
              </span>
            </div>
            <span className="text-zinc-500 dark:text-zinc-400">{e.totalXp} XP</span>
          </div>
        ))}
      </div>
      {self && self.rank > entries.length && (
        <div className="mt-3 flex items-center justify-between rounded-xl border border-[#0ca30c]/30 bg-[#0ca30c]/5 px-4 py-2.5 text-sm">
          <div className="flex items-center gap-3">
            <span className="w-6 text-zinc-400">#{self.rank}</span>
            <span className="font-medium text-black dark:text-white">{self.nickname} (you)</span>
          </div>
          <span className="text-zinc-500 dark:text-zinc-400">{self.totalXp} XP</span>
        </div>
      )}
    </div>
  );
}

export default function Home() {
  const [anonUserId, setAnonUserId] = useState<string | null>(null);
  const [needsNickname, setNeedsNickname] = useState(false);
  const [bootstrapped, setBootstrapped] = useState(false);
  const [gamification, setGamification] = useState<GamificationState | null>(null);
  const [tab, setTab] = useState<Tab>("chat");

  const [sessionId] = useState(() => newId());
  const [messages, setMessages] = useState<Message[]>([
    {
      id: newId(),
      role: "assistant",
      text: "Hey, I'm your fitness coach. Ask me about workouts, form, recovery, or a training plan.",
    },
  ]);
  const [input, setInput] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, status]);

  useEffect(() => {
    const storedId = localStorage.getItem(ANON_ID_KEY);
    const storedNickname = localStorage.getItem(NICKNAME_KEY);
    const id = storedId ?? newId();
    if (!storedId) localStorage.setItem(ANON_ID_KEY, id);
    setAnonUserId(id);

    if (storedNickname) {
      apiFetch("/api/identity", id, {
        method: "POST",
        body: JSON.stringify({ anonUserId: id }),
      })
        .then((res) => res.json())
        .then(() => setBootstrapped(true))
        .catch(() => setBootstrapped(true));
    } else {
      setNeedsNickname(true);
    }
  }, []);

  useEffect(() => {
    if (!bootstrapped || !anonUserId) return;
    refreshGamification();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bootstrapped, anonUserId]);

  async function refreshGamification() {
    if (!anonUserId) return;
    try {
      const res = await apiFetch("/api/gamification/state", anonUserId);
      if (res.ok) setGamification(await res.json());
    } catch {
      // Gamification display is best-effort; chat still works without it.
    }
  }

  async function handleNickname(nickname: string) {
    if (!anonUserId) return;
    localStorage.setItem(NICKNAME_KEY, nickname);
    try {
      await apiFetch("/api/identity", anonUserId, {
        method: "POST",
        body: JSON.stringify({ anonUserId, nickname }),
      });
    } finally {
      setNeedsNickname(false);
      setBootstrapped(true);
    }
  }

  function showToast(text: string) {
    setToast(text);
    setTimeout(() => setToast(null), 3500);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const text = input.trim();
    if (!text || status === "loading") return;

    setMessages((prev) => [...prev, { id: newId(), role: "user", text }]);
    setInput("");
    setStatus("loading");
    setError(null);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chatInput: text, sessionId, anonUserId }),
      });
      const data = await res.json();

      if (!res.ok) {
        setError(data.error ?? "Something went wrong. Please try again.");
        setStatus("error");
        return;
      }

      const reply = typeof data.output === "string" ? data.output : null;
      if (!reply) {
        setError("The fitness coach returned an unexpected response. Please try again.");
        setStatus("error");
        return;
      }

      setMessages((prev) => [...prev, { id: newId(), role: "assistant", text: reply }]);
      setStatus("idle");
      refreshGamification();
    } catch {
      setError("Could not reach the fitness coach. Please try again.");
      setStatus("error");
    }
  }

  function handleWorkoutLogged(result: { xpAwarded: number; newBadges: { name: string }[] }) {
    const badgeText =
      result.newBadges.length > 0
        ? ` — new badge: ${result.newBadges.map((b) => b.name).join(", ")}!`
        : "";
    showToast(`+${result.xpAwarded} XP${badgeText}`);
    refreshGamification();
  }

  if (needsNickname) {
    return <NicknamePrompt onSubmit={handleNickname} />;
  }

  return (
    <div className="flex min-h-screen flex-col bg-[#f9f9f7] dark:bg-[#0d0d0d]">
      <header className="border-b border-zinc-200 bg-white px-6 py-4 dark:border-zinc-800 dark:bg-zinc-950">
        <div className="mx-auto flex max-w-2xl items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-full bg-[#0f1424] text-white">
              🏋️
            </div>
            <div>
              <h1 className="text-sm font-semibold text-black dark:text-white">Fitness Coach</h1>
              <p className="text-xs text-zinc-500 dark:text-zinc-400">AI-powered training advice</p>
            </div>
          </div>
          <div className="flex gap-1 rounded-lg bg-zinc-100 p-1 dark:bg-zinc-900">
            <button
              onClick={() => setTab("chat")}
              className={`rounded-md px-3 py-1 text-xs font-medium transition-colors ${
                tab === "chat" ? "bg-white text-black shadow-sm dark:bg-zinc-800 dark:text-white" : "text-zinc-500 dark:text-zinc-400"
              }`}
            >
              Chat
            </button>
            <button
              onClick={() => setTab("leaderboard")}
              className={`rounded-md px-3 py-1 text-xs font-medium transition-colors ${
                tab === "leaderboard" ? "bg-white text-black shadow-sm dark:bg-zinc-800 dark:text-white" : "text-zinc-500 dark:text-zinc-400"
              }`}
            >
              Leaderboard
            </button>
          </div>
        </div>
      </header>

      {gamification && <XpBar state={gamification} />}

      {toast && (
        <div className="mx-auto mt-3 w-fit rounded-full bg-[#0f1424] px-4 py-1.5 text-xs font-medium text-white shadow-lg">
          {toast}
        </div>
      )}

      {tab === "leaderboard" ? (
        <Leaderboard anonUserId={anonUserId} />
      ) : (
        <>
          {gamification && gamification.activeChallenges.length > 0 && (
            <div className="mx-auto mt-4 w-full max-w-2xl px-6">
              {gamification.activeChallenges.map((c) => (
                <div
                  key={c.id}
                  className="mb-2 flex items-center justify-between rounded-lg border border-zinc-200 bg-white px-4 py-2 text-xs dark:border-zinc-800 dark:bg-zinc-950"
                >
                  <span className="text-black dark:text-white">🎯 {c.title}</span>
                  <span className="text-zinc-500 dark:text-zinc-400">
                    {c.currentCount}/{c.targetCount}
                  </span>
                </div>
              ))}
            </div>
          )}

          <main
            ref={scrollRef}
            className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-4 overflow-y-auto px-6 py-6"
          >
            {messages.map((m) => (
              <div key={m.id} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
                <div
                  className={`max-w-[80%] whitespace-pre-wrap rounded-2xl px-4 py-2.5 text-sm leading-relaxed ${
                    m.role === "user"
                      ? "bg-[#0f1424] text-white"
                      : "border border-zinc-200 bg-white text-black dark:border-zinc-800 dark:bg-zinc-900 dark:text-white"
                  }`}
                >
                  {m.text}
                </div>
              </div>
            ))}

            {status === "loading" && (
              <div className="flex justify-start">
                <div className="max-w-[80%] rounded-2xl border border-zinc-200 bg-white px-4 py-2.5 text-sm text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400">
                  Thinking…
                </div>
              </div>
            )}

            {status === "error" && error && (
              <div className="mx-auto w-full rounded-lg border border-[#e34948]/30 bg-[#e34948]/10 px-4 py-3 text-sm text-[#b23a39] dark:text-[#f3a7a6]">
                {error}
              </div>
            )}
          </main>

          <LogWorkoutForm onLogged={handleWorkoutLogged} />

          <form
            onSubmit={handleSubmit}
            className="border-t border-zinc-200 bg-white px-6 py-4 dark:border-zinc-800 dark:bg-zinc-950"
          >
            <div className="mx-auto flex max-w-2xl gap-3">
              <input
                type="text"
                required
                placeholder="Ask about a workout, form, or a training plan…"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                className="flex-1 rounded-lg border border-zinc-300 bg-white px-4 py-2.5 text-sm text-black placeholder:text-zinc-400 focus:border-zinc-500 focus:outline-none dark:border-zinc-700 dark:bg-zinc-900 dark:text-white"
              />
              <button
                type="submit"
                disabled={status === "loading"}
                className="rounded-lg bg-[#0f1424] px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-[#1a2137] disabled:cursor-not-allowed disabled:opacity-50"
              >
                Send
              </button>
            </div>
          </form>
        </>
      )}
    </div>
  );
}
