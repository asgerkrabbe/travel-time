import { useState, useMemo } from "react";
import { RotateCw, RotateCcw, Settings, X, BookOpen, Target, Info, ChevronDown } from "lucide-react";

// ============================================================
// Domain model
// ============================================================

const ROLE_META = {
  S:   { name: "Setter",           short: "Setter",   color: "#F0B429", text: "#3A2A00" },
  OPP: { name: "Opposite",         short: "Opposite",  color: "#16233D", text: "#F7F3E8" },
  MB1: { name: "Middle Blocker 1", short: "Middle 1",  color: "#A6414B", text: "#F7F3E8" },
  MB2: { name: "Middle Blocker 2", short: "Middle 2",  color: "#A6414B", text: "#F7F3E8" },
  OH1: { name: "Outside Hitter 1", short: "Outside 1", color: "#2E6F95", text: "#F7F3E8" },
  OH2: { name: "Outside Hitter 2", short: "Outside 2", color: "#2E6F95", text: "#F7F3E8" },
  L:   { name: "Libero",           short: "Libero",    color: "#D6437B", text: "#FFFFFF" },
};
const ROLE_ORDER = ["S", "OPP", "MB1", "MB2", "OH1", "OH2"];

// The libero is not one of the 6 rotational slots — she's a back-row-only
// defensive sub who swaps in for whichever of these roles is currently back row.
const LIBERO_PRESETS = {
  MB: { label: "Middle blockers (standard)", roles: ["MB1", "MB2"] },
  OH: { label: "Outside hitters", roles: ["OH1", "OH2"] },
  off: { label: "No libero", roles: [] },
};

// Indexed by (position - 1). This team's actual starting lineup for Rotation 1.
const DEFAULT_LINEUP = ["S", "OH1", "MB2", "OPP", "OH2", "MB1"];

// The path a single player follows when the team rotates: 1 -> 6 -> 5 -> 4 -> 3 -> 2 -> back to 1
const ROTATION_CYCLE = [1, 6, 5, 4, 3, 2];
const CYCLE_INDEX = ROTATION_CYCLE.reduce((acc, pos, i) => {
  acc[pos] = i;
  return acc;
}, {});

const FRONT_ROW = [4, 3, 2];
const BACK_ROW = [5, 6, 1];

// Screen layout: front row (near net) on top, back row on the bottom.
const ZONES = [
  { pos: 4, row: 0, col: 0 },
  { pos: 3, row: 0, col: 1 },
  { pos: 2, row: 0, col: 2 },
  { pos: 5, row: 1, col: 0 },
  { pos: 6, row: 1, col: 1 },
  { pos: 1, row: 1, col: 2 },
];

// Coordinates used only for the faint rotation-path overlay (viewBox 0 0 300 200)
const ZONE_XY = { 4: [50, 50], 3: [150, 50], 2: [250, 50], 5: [50, 150], 6: [150, 150], 1: [250, 150] };

function mod(n, m) {
  return ((n % m) + m) % m;
}

function buildPositionMap(offset, lineup) {
  const map = {};
  for (let position = 1; position <= 6; position++) {
    const yIndex = CYCLE_INDEX[position];
    const originalIndex = mod(yIndex - offset, 6);
    const originalPos = ROTATION_CYCLE[originalIndex];
    map[position] = lineup[originalPos - 1];
  }
  return map;
}

function findPositionForRole(map, role) {
  for (let position = 1; position <= 6; position++) {
    if (map[position] === role) return position;
  }
  return null;
}

// Base defense: while SERVING, players aren't required to hold rotational order
// (FIVB Rule 7.4), so real teams pre-set into fixed tactical zones. Each hitter
// pair gets one column, and swaps between that column's front/back slot as they
// cross the front/back line — e.g. whichever of MB1/MB2 is front row always shows
// at zone 3 (not wherever they literally rotated to), the other always at zone 6.
const ROLE_COLUMN = {
  OH1: { front: 4, back: 5 },
  OH2: { front: 4, back: 5 },
  MB1: { front: 3, back: 6 },
  MB2: { front: 3, back: 6 },
  S: { front: 2, back: 1 },
  OPP: { front: 2, back: 1 },
};

// Where a role visually appears while serving: their own column's front or back
// slot, chosen by whichever side of the net they're literally rotated into.
function getServingDisplayPosition(map, role) {
  const literalPos = findPositionForRole(map, role);
  if (literalPos === null) return null;
  const column = ROLE_COLUMN[role];
  return FRONT_ROW.includes(literalPos) ? column.front : column.back;
}

// A position -> role map for display purposes: literal positions while receiving,
// base-defense column positions while serving. Used for reveals/animation targets.
function getDisplayMap(map, isServing) {
  if (!isServing) return map;
  const displayMap = {};
  for (const role of ROLE_ORDER) {
    const pos = getServingDisplayPosition(map, role);
    if (pos !== null) displayMap[pos] = role;
  }
  return displayMap;
}

// Where a role should be shown right now, respecting serving vs receiving.
function getDisplayPosition(map, role, isServing) {
  return isServing ? getServingDisplayPosition(map, role) : findPositionForRole(map, role);
}

// Returns the role code the libero is currently on court for (the first of the
// eligible roles that's in the back row). Position 1 only excludes her while the
// team is SERVING: rotating into position 1 is what puts a player next in the
// service order (Rule 7.6.2), and a libero may never serve (Rule 19.3.1.3) — but
// while RECEIVING, that same player isn't about to serve (if they win the rally
// they rotate to position 2 and someone else serves next), so she's fine there.
function getLiberoSubRole(map, eligibleRoles, isServing) {
  for (const role of eligibleRoles) {
    const pos = findPositionForRole(map, role);
    if (pos === null || !BACK_ROW.includes(pos)) continue;
    if (isServing && pos === 1) continue;
    return role;
  }
  return null;
}

// If the libero isn't on court specifically because her player has rotated into
// the serving position while the team is serving, surface which role that is.
function getLiberoBlockedRole(map, eligibleRoles, isServing) {
  if (!isServing) return null;
  for (const role of eligibleRoles) {
    if (findPositionForRole(map, role) === 1) return role;
  }
  return null;
}

function randomInt(n) {
  return Math.floor(Math.random() * n);
}

function makeQuestion(lineup, avoidRole) {
  const qOffset = randomInt(6);
  const qServing = Math.random() < 0.5;
  let role = ROLE_ORDER[randomInt(6)];
  let guard = 0;
  while (role === avoidRole && guard < 12) {
    role = ROLE_ORDER[randomInt(6)];
    guard++;
  }
  return { offset: qOffset, serving: qServing, targetRole: role, selectedPos: null, feedback: null };
}

// ============================================================
// Component
// ============================================================

export default function VolleyballRotationTrainer() {
  const [lineup, setLineup] = useState(DEFAULT_LINEUP);
  const [offset, setOffset] = useState(0);
  const [mode, setMode] = useState("learn"); // 'learn' | 'quiz'
  const [showSettings, setShowSettings] = useState(false);
  const [question, setQuestion] = useState(() => makeQuestion(DEFAULT_LINEUP, null));
  const [score, setScore] = useState({ correct: 0, total: 0, streak: 0, best: 0 });
  const [liberoMode, setLiberoMode] = useState("MB"); // 'MB' | 'OH' | 'off'
  const [serving, setServing] = useState(true); // true = my team is serving, false = receiving
  const [showFivbNote, setShowFivbNote] = useState(false);

  const learnMap = useMemo(() => buildPositionMap(offset, lineup), [offset, lineup]);
  const quizMap = useMemo(() => buildPositionMap(question.offset, lineup), [question.offset, lineup]);
  const quizDisplayMap = useMemo(
    () => getDisplayMap(quizMap, question.serving),
    [quizMap, question.serving]
  );

  const liberoEligible = LIBERO_PRESETS[liberoMode].roles;
  const liberoSubRole = useMemo(
    () => getLiberoSubRole(learnMap, liberoEligible, serving),
    [learnMap, liberoEligible, serving]
  );
  const liberoBlockedRole = useMemo(
    () => getLiberoBlockedRole(learnMap, liberoEligible, serving),
    [learnMap, liberoEligible, serving]
  );

  const setterPos = findPositionForRole(learnMap, "S");
  const setterFront = FRONT_ROW.includes(setterPos);

  function rotate(dir) {
    setOffset((o) => mod(o + dir, 6));
  }

  function updateLineupPosition(position, newRole) {
    setLineup((prev) => {
      const next = [...prev];
      const otherIndex = next.indexOf(newRole);
      const thisIndex = position - 1;
      const oldRole = next[thisIndex];
      next[thisIndex] = newRole;
      if (otherIndex !== -1 && otherIndex !== thisIndex) {
        next[otherIndex] = oldRole;
      }
      return next;
    });
  }

  function resetLineup() {
    setLineup(DEFAULT_LINEUP);
    setOffset(0);
  }

  function startQuiz() {
    setMode("quiz");
    setQuestion(makeQuestion(lineup, null));
  }

  function nextQuestion() {
    setQuestion((q) => makeQuestion(lineup, q.targetRole));
  }

  function handleZoneTap(position) {
    if (mode !== "quiz" || question.feedback) return;
    const correctPos = getDisplayPosition(quizMap, question.targetRole, question.serving);
    const isCorrect = position === correctPos;
    setScore((s) => {
      const streak = isCorrect ? s.streak + 1 : 0;
      return {
        correct: s.correct + (isCorrect ? 1 : 0),
        total: s.total + 1,
        streak,
        best: Math.max(s.best, streak),
      };
    });
    setQuestion((q) => ({ ...q, selectedPos: position, feedback: isCorrect ? "correct" : "wrong" }));
  }

  return (
    <div
      className="min-h-screen w-full flex flex-col items-center py-6 px-3"
      style={{ backgroundColor: "#EDE0C4", fontFamily: "system-ui, -apple-system, sans-serif", color: "#16233D" }}
    >
      <style>{`
        @keyframes popIn {
          0% { transform: scale(0.65); opacity: 0; }
          70% { transform: scale(1.08); opacity: 1; }
          100% { transform: scale(1); opacity: 1; }
        }
        @keyframes dashFlow {
          to { stroke-dashoffset: -24; }
        }
        .badge-pop { animation: popIn 260ms ease; }
        .flow-line { animation: dashFlow 1.6s linear infinite; }
        @media (prefers-reduced-motion: reduce) {
          .badge-pop { animation: none; }
          .flow-line { animation: none; }
        }
        .zone-btn:focus-visible {
          outline: 3px solid #F0B429;
          outline-offset: 2px;
        }
      `}</style>

      <div className="w-full" style={{ maxWidth: "480px" }}>
        {/* Header */}
        <header className="mb-4 text-center">
          <div
            className="text-xs font-bold tracking-widest mb-1"
            style={{ letterSpacing: "0.18em", color: "#A8763D" }}
          >
            5-1 SYSTEM
          </div>
          <h1
            className="font-extrabold uppercase leading-none"
            style={{ fontSize: "28px", letterSpacing: "0.02em", fontStretch: "condensed" }}
          >
            Rotation Trainer
          </h1>
        </header>

        {/* Mode tabs */}
        <div
          className="flex mb-4 p-1 rounded-xl"
          style={{ backgroundColor: "#DBC79A" }}
        >
          <button
            className="zone-btn flex-1 flex items-center justify-center gap-2 py-2 rounded-lg font-bold text-sm uppercase transition-colors"
            style={{
              backgroundColor: mode === "learn" ? "#16233D" : "transparent",
              color: mode === "learn" ? "#F7F3E8" : "#5A4A2A",
            }}
            onClick={() => setMode("learn")}
          >
            <BookOpen size={16} /> Learn
          </button>
          <button
            className="zone-btn flex-1 flex items-center justify-center gap-2 py-2 rounded-lg font-bold text-sm uppercase transition-colors"
            style={{
              backgroundColor: mode === "quiz" ? "#16233D" : "transparent",
              color: mode === "quiz" ? "#F7F3E8" : "#5A4A2A",
            }}
            onClick={startQuiz}
          >
            <Target size={16} /> Quiz
          </button>
        </div>

        {/* Court card */}
        <div className="rounded-2xl p-3 shadow-lg" style={{ backgroundColor: "#C89A5B", border: "3px solid #A8763D" }}>
          {/* Net */}
          <div className="relative mb-2">
            <div
              className="h-3 rounded-sm"
              style={{
                backgroundImage:
                  "repeating-linear-gradient(90deg, #16233D 0px, #16233D 2px, transparent 2px, transparent 8px)",
                backgroundColor: "#F7F3E8",
                border: "1px solid #16233D",
              }}
            />
            <div
              className="text-center text-xs font-bold uppercase mt-1"
              style={{ letterSpacing: "0.2em", color: "#16233D" }}
            >
              Net
            </div>
          </div>

          {/* Court: fixed zones (position numbers) stay put; role badges float on top
              and animate between zones when the rotation changes. */}
          <div className="relative w-full" style={{ aspectRatio: "3 / 2" }}>
            <svg
              viewBox="0 0 300 200"
              className="absolute inset-0 w-full h-full pointer-events-none"
              style={{ opacity: 0.45, zIndex: 1 }}
            >
              <defs>
                <marker id="arrowhead" markerWidth="6" markerHeight="6" refX="4" refY="3" orient="auto">
                  <path d="M0,0 L6,3 L0,6 Z" fill="#F0B429" />
                </marker>
              </defs>
              {ROTATION_CYCLE.map((pos, i) => {
                const from = ZONE_XY[pos];
                const to = ZONE_XY[ROTATION_CYCLE[mod(i + 1, 6)]];
                return (
                  <line
                    key={pos}
                    x1={from[0]}
                    y1={from[1]}
                    x2={to[0]}
                    y2={to[1]}
                    stroke="#F0B429"
                    strokeWidth="2"
                    strokeDasharray="6 6"
                    strokeLinecap="round"
                    markerEnd="url(#arrowhead)"
                    className="flow-line"
                  />
                );
              })}
            </svg>

            {/* Attack-line divider */}
            <div
              className="absolute left-0 right-0 pointer-events-none"
              style={{ top: "50%", borderTop: "2px dashed #A8763D", opacity: 0.6, zIndex: 1 }}
            />

            {/* Fixed zone boxes — these never move, only their contents change */}
            {ZONES.map(({ pos, row, col }) => {
              const isSelected = mode === "quiz" && question.selectedPos === pos;
              const isCorrectReveal =
                mode === "quiz" &&
                question.feedback &&
                getDisplayPosition(quizMap, question.targetRole, question.serving) === pos;
              const revealRole = mode === "quiz" && question.feedback ? quizDisplayMap[pos] : null;
              const revealMeta = revealRole ? ROLE_META[revealRole] : null;
              // The server is whoever is LITERALLY in position 1 — not whichever
              // role's base-defense column happens to display at zone 1.
              const revealIsServer = revealRole !== null && findPositionForRole(quizMap, revealRole) === 1;

              return (
                <div
                  key={pos}
                  className="absolute"
                  style={{
                    left: `${(col * 100) / 3}%`,
                    top: `${row * 50}%`,
                    width: `${100 / 3}%`,
                    height: "50%",
                    padding: "5px",
                    boxSizing: "border-box",
                    zIndex: 1,
                  }}
                >
                  <button
                    onClick={() => handleZoneTap(pos)}
                    disabled={mode !== "quiz" || Boolean(question.feedback)}
                    className="zone-btn relative w-full h-full rounded-xl flex flex-col items-center justify-center"
                    style={{
                      backgroundColor: "#F7F3E8",
                      border: isSelected
                        ? question.feedback === "correct"
                          ? "3px solid #2E9E5B"
                          : "3px solid #C43D3D"
                        : isCorrectReveal
                        ? "3px solid #2E9E5B"
                        : "2px solid #A8763D",
                      cursor: mode === "quiz" && !question.feedback ? "pointer" : "default",
                    }}
                  >
                    <span className="absolute top-1 left-1 text-xs font-bold" style={{ color: "#A8763D" }}>
                      {pos}
                    </span>
                    {revealIsServer && (
                      <span className="absolute top-1 right-1 text-xs font-bold" style={{ color: "#C43D3D" }}>
                        SERVE
                      </span>
                    )}

                    {revealMeta && (
                      <span
                        className="badge-pop px-3 py-1 rounded-full font-extrabold text-sm mt-1"
                        style={{ backgroundColor: revealMeta.color, color: revealMeta.text }}
                      >
                        {revealRole}
                      </span>
                    )}
                    {mode === "quiz" && !question.feedback && (
                      <span className="text-2xl font-bold" style={{ color: "#C9B98A" }}>
                        ?
                      </span>
                    )}
                  </button>
                </div>
              );
            })}

            {/* Floating role badges — one per role, keyed by role so React keeps the
                same DOM node across rotations and the left/top transition can slide it. */}
            {mode === "learn" &&
              ROLE_ORDER.map((role) => {
                const pos = getDisplayPosition(learnMap, role, serving);
                const zone = ZONES.find((z) => z.pos === pos);
                const leftPct = (zone.col * 100) / 3 + 100 / 6;
                const topPct = zone.row * 50 + 25;
                const isLibero = role === liberoSubRole;
                const meta = isLibero ? ROLE_META.L : ROLE_META[role];
                // The server is whoever is LITERALLY in position 1 — track that
                // regardless of where this role's base-defense column displays it.
                const isServer = findPositionForRole(learnMap, role) === 1;
                return (
                  <div
                    key={role}
                    className="absolute flex flex-col items-center pointer-events-none"
                    style={{
                      left: `${leftPct}%`,
                      top: `${topPct}%`,
                      transform: "translate(-50%, -50%)",
                      transition: "left 0.5s ease, top 0.5s ease",
                      zIndex: 2,
                    }}
                  >
                    {isServer && (
                      <span
                        className="font-bold uppercase px-1.5 py-0.5 rounded mb-1"
                        style={{ backgroundColor: "#C43D3D", color: "#FFFFFF", fontSize: "9px", letterSpacing: "0.05em" }}
                      >
                        Serve
                      </span>
                    )}
                    <span
                      className="badge-pop px-3 py-1 rounded-full font-extrabold text-sm"
                      key={isLibero ? "L" : role}
                      style={{ backgroundColor: meta.color, color: meta.text }}
                    >
                      {isLibero ? "L" : role}
                    </span>
                    <span className="mt-1 font-medium" style={{ color: "#5A4A2A", fontSize: "11px" }}>
                      {isLibero ? `for ${role}` : meta.short}
                    </span>
                  </div>
                );
              })}
          </div>
        </div>

        {/* Context panel */}
        {mode === "learn" ? (
          <div className="mt-4 rounded-2xl p-4" style={{ backgroundColor: "#F7F3E8", border: "2px solid #DBC79A" }}>
            <div className="flex items-center justify-between mb-3">
              <div className="text-xs font-bold uppercase" style={{ color: "#A8763D", letterSpacing: "0.1em" }}>
                My team is
              </div>
              <div className="flex rounded-lg overflow-hidden" style={{ border: "1px solid #A8763D" }}>
                <button
                  className="zone-btn px-3 py-1 text-xs font-bold uppercase"
                  style={{
                    backgroundColor: serving ? "#16233D" : "transparent",
                    color: serving ? "#F7F3E8" : "#5A4A2A",
                  }}
                  onClick={() => setServing(true)}
                >
                  Serving
                </button>
                <button
                  className="zone-btn px-3 py-1 text-xs font-bold uppercase"
                  style={{
                    backgroundColor: !serving ? "#16233D" : "transparent",
                    color: !serving ? "#F7F3E8" : "#5A4A2A",
                  }}
                  onClick={() => setServing(false)}
                >
                  Receiving
                </button>
              </div>
            </div>

            <div className="flex items-center justify-between mb-3">
              <div>
                <div className="text-xs font-bold uppercase" style={{ color: "#A8763D", letterSpacing: "0.1em" }}>
                  Rotation
                </div>
                <div className="text-xl font-extrabold">{offset + 1} of 6</div>
              </div>
              <button
                className="zone-btn p-2 rounded-full"
                style={{ backgroundColor: "#DBC79A" }}
                onClick={() => setShowSettings(true)}
                aria-label="Edit lineup"
              >
                <Settings size={18} />
              </button>
            </div>

            <p className="text-sm mb-3" style={{ color: "#3A2A20" }}>
              Setter is in the{" "}
              <strong>{setterFront ? "front row" : "back row"}</strong>
              {setterFront
                ? " — can set and attack near the net."
                : " — sets from behind the attack line."}
            </p>

            {liberoMode !== "off" && (
              <p className="text-sm mb-3" style={{ color: "#3A2A20" }}>
                {liberoSubRole ? (
                  <>
                    Libero is in for <strong>{ROLE_META[liberoSubRole].short}</strong> — stays in the back row.
                  </>
                ) : liberoBlockedRole ? (
                  <>
                    <strong>{ROLE_META[liberoBlockedRole].short}</strong> is about to serve — a libero may
                    never serve under FIVB rules, so she's out until it's not her player's turn to serve.
                  </>
                ) : (
                  "No libero on court this rotation."
                )}
              </p>
            )}

            {serving && (
              <div
                className="mb-3 rounded-lg text-xs overflow-hidden"
                style={{ backgroundColor: "#E7F1F6", color: "#1C4A63", border: "1px solid #BFDCE8" }}
              >
                <button
                  className="zone-btn w-full flex items-center justify-between gap-2 px-3 py-2 font-bold uppercase"
                  style={{ letterSpacing: "0.04em" }}
                  onClick={() => setShowFivbNote((v) => !v)}
                  aria-expanded={showFivbNote}
                >
                  <span className="flex items-center gap-1.5">
                    <Info size={14} /> FIVB serving rule
                  </span>
                  <ChevronDown
                    size={14}
                    style={{
                      transition: "transform 0.2s ease",
                      transform: showFivbNote ? "rotate(180deg)" : "rotate(0deg)",
                    }}
                  />
                </button>
                {showFivbNote && (
                  <p className="px-3 pb-2 -mt-0.5">
                    Since 2025, FIVB rules let the serving team stand anywhere on court at the serve — only the
                    receiving team must hold rotational order. Who serves next, and who's front/back row, doesn't
                    change.
                  </p>
                )}
              </div>
            )}

            <div className="flex gap-2">
              <button
                className="zone-btn flex-1 flex items-center justify-center gap-2 py-2 rounded-xl font-bold text-sm"
                style={{ backgroundColor: "#16233D", color: "#F7F3E8" }}
                onClick={() => rotate(-1)}
              >
                <RotateCcw size={16} /> Previous
              </button>
              <button
                className="zone-btn flex-1 flex items-center justify-center gap-2 py-2 rounded-xl font-bold text-sm"
                style={{ backgroundColor: "#16233D", color: "#F7F3E8" }}
                onClick={() => rotate(1)}
              >
                <RotateCw size={16} /> Rotate
              </button>
            </div>
          </div>
        ) : (
          <div className="mt-4 rounded-2xl p-4" style={{ backgroundColor: "#F7F3E8", border: "2px solid #DBC79A" }}>
            <div className="flex items-center justify-between mb-3">
              <div>
                <div className="text-xs font-bold uppercase" style={{ color: "#A8763D", letterSpacing: "0.1em" }}>
                  Rotation
                </div>
                <div className="flex items-center gap-2">
                  <div className="text-xl font-extrabold">{question.offset + 1} of 6</div>
                  <span
                    className="text-xs font-bold uppercase px-2 py-0.5 rounded-full"
                    style={{
                      backgroundColor: question.serving ? "#16233D" : "#2E6F95",
                      color: "#F7F3E8",
                    }}
                  >
                    {question.serving ? "Serving" : "Receiving"}
                  </span>
                </div>
              </div>
              <div className="text-right">
                <div className="text-sm font-medium" style={{ color: "#3A2A20" }}>
                  Score: <strong>{score.correct}</strong> / {score.total}
                </div>
                <div className="text-sm font-medium" style={{ color: "#3A2A20" }}>
                  Streak: <strong>{score.streak}</strong>
                </div>
              </div>
            </div>

            <p className="text-base font-bold mb-3">
              Tap the zone for{" "}
              <span style={{ color: ROLE_META[question.targetRole].color }}>
                {ROLE_META[question.targetRole].name}
              </span>{" "}
              ({question.targetRole})
            </p>

            {question.feedback && (
              <div
                className="mb-3 text-sm font-bold px-3 py-2 rounded-lg"
                style={{
                  backgroundColor: question.feedback === "correct" ? "#DDF2E4" : "#F7DCDC",
                  color: question.feedback === "correct" ? "#1F7A44" : "#A8302F",
                }}
              >
                {question.feedback === "correct" ? "Correct!" : "Not quite — the correct zone is highlighted."}
              </div>
            )}

            <button
              className="zone-btn w-full py-2 rounded-xl font-bold text-sm"
              style={{
                backgroundColor: question.feedback ? "#16233D" : "#DBC79A",
                color: question.feedback ? "#F7F3E8" : "#8A7145",
                cursor: question.feedback ? "pointer" : "default",
              }}
              onClick={question.feedback ? nextQuestion : undefined}
              disabled={!question.feedback}
            >
              Next question
            </button>
          </div>
        )}

        {/* Legend */}
        <div className="mt-4 flex flex-wrap gap-3 justify-center">
          {ROLE_ORDER.map((role) => (
            <div key={role} className="flex items-center gap-1.5 text-xs font-medium" style={{ color: "#5A4A2A" }}>
              <span
                className="inline-block rounded-full"
                style={{ width: "10px", height: "10px", backgroundColor: ROLE_META[role].color }}
              />
              {ROLE_META[role].short}
            </div>
          ))}
          {liberoMode !== "off" && (
            <div className="flex items-center gap-1.5 text-xs font-medium" style={{ color: "#5A4A2A" }}>
              <span
                className="inline-block rounded-full"
                style={{ width: "10px", height: "10px", backgroundColor: ROLE_META.L.color }}
              />
              Libero
            </div>
          )}
        </div>
      </div>

      {/* Settings modal */}
      {showSettings && (
        <div
          className="fixed inset-0 flex items-end justify-center z-50"
          style={{ backgroundColor: "rgba(22,35,61,0.55)" }}
          onClick={() => setShowSettings(false)}
        >
          <div
            className="w-full rounded-t-2xl p-5"
            style={{ maxWidth: "480px", backgroundColor: "#F7F3E8", maxHeight: "80vh", overflowY: "auto" }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-extrabold text-lg uppercase">Starting Lineup</h2>
              <button className="zone-btn p-1" onClick={() => setShowSettings(false)} aria-label="Close">
                <X size={22} />
              </button>
            </div>
            <p className="text-sm mb-4" style={{ color: "#5A4A2A" }}>
              Set which role starts at each position for Rotation 1. Picking a role that's already
              used swaps it with its previous spot.
            </p>

            <div className="mb-5 pb-5" style={{ borderBottom: "1px solid #DBC79A" }}>
              <div className="text-sm font-bold mb-2">Libero substitutes for</div>
              <select
                className="zone-btn w-full py-2 px-2 rounded-lg text-sm font-medium"
                style={{ backgroundColor: "#DBC79A", border: "1px solid #A8763D" }}
                value={liberoMode}
                onChange={(e) => setLiberoMode(e.target.value)}
              >
                {Object.entries(LIBERO_PRESETS).map(([key, preset]) => (
                  <option key={key} value={key}>
                    {preset.label}
                  </option>
                ))}
              </select>
              <p className="text-xs mt-2" style={{ color: "#8A7145" }}>
                She plays in for whichever of those two is in the back row — including zone 1, unless your
                team is serving, since a libero may never serve. Use the "My team is" toggle above the court
                to switch between serving and receiving.
              </p>
            </div>

            <div className="text-sm font-bold mb-2">Starting lineup</div>
            <div className="flex flex-col gap-2">
              {[1, 2, 3, 4, 5, 6].map((position) => (
                <div key={position} className="flex items-center justify-between gap-3">
                  <span className="text-sm font-bold w-24">Position {position}</span>
                  <select
                    className="zone-btn flex-1 py-2 px-2 rounded-lg text-sm font-medium"
                    style={{ backgroundColor: "#DBC79A", border: "1px solid #A8763D" }}
                    value={lineup[position - 1]}
                    onChange={(e) => updateLineupPosition(position, e.target.value)}
                  >
                    {ROLE_ORDER.map((role) => (
                      <option key={role} value={role}>
                        {role} — {ROLE_META[role].name}
                      </option>
                    ))}
                  </select>
                </div>
              ))}
            </div>
            <button
              className="zone-btn w-full mt-4 py-2 rounded-xl font-bold text-sm"
              style={{ backgroundColor: "#16233D", color: "#F7F3E8" }}
              onClick={resetLineup}
            >
              Reset to standard lineup
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
