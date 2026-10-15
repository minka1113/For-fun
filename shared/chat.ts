// Helpers shared by the expert and research chats.

export interface Turn {
  role: "user" | "assistant";
  text: string;
}

/**
 * Earlier turns of a conversation, ready to replay to the model: empty turns dropped, a leading
 * reply dropped (the conversation must open with the user), consecutive same-role turns merged
 * (e.g. after a failed reply) so roles alternate, and a placeholder reply added if the last turn
 * is the user's, so the newest message can follow.
 */
export function replayTurns(history: Turn[] = []): Turn[] {
  const turns: Turn[] = [];
  for (const m of history) {
    if (!m.text.trim()) continue;
    const last = turns[turns.length - 1];
    if (!last && m.role === "assistant") continue;
    if (last?.role === m.role) last.text += `\n\n${m.text}`;
    else turns.push({ role: m.role, text: m.text });
  }
  if (turns[turns.length - 1]?.role === "user") turns.push({ role: "assistant", text: "(No reply.)" });
  return turns;
}

/** A web address reduced to a form that matches however it was written (case, trailing slash, #anchor). */
export const normalizeUrl = (u: string) => u.trim().replace(/#.*$/, "").replace(/\/$/, "").toLowerCase();
