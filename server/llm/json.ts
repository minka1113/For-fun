// Cleaning up free-form model output from servers that don't enforce structure.

/** Remove reasoning that some models emit inline, e.g. "<think>...</think>answer". */
export function stripThinking(text: string): string {
  let out = text.replace(/<think>[\s\S]*?<\/think>/g, "");
  // The chat template may open the block itself, leaving only the closing tag in the output.
  const close = out.lastIndexOf("</think>");
  if (close !== -1) out = out.slice(close + "</think>".length);
  // A reply cut off mid-thought has no answer.
  if (out.trimStart().startsWith("<think>")) out = "";
  return out.trim();
}

/** Pull the first JSON object out of a reply, tolerating fences, prose and reasoning around it. */
export function extractJson(text: string): unknown {
  const cleaned = stripThinking(text);
  const fenced = cleaned.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidates = fenced ? [fenced[1], cleaned] : [cleaned];
  for (const candidate of candidates) {
    const body = candidate.trim();
    try {
      return JSON.parse(body);
    } catch {
      // Fall through to scanning for an object embedded in prose.
    }
    const start = body.indexOf("{");
    if (start === -1) continue;
    const end = balancedEnd(body, start);
    if (end === -1) continue;
    try {
      return JSON.parse(body.slice(start, end + 1));
    } catch {
      // Try the next candidate.
    }
  }
  throw new Error("The reply did not contain valid JSON.");
}

/** Index of the brace closing the object that opens at `start`, ignoring braces inside strings. */
function balancedEnd(s: string, start: number): number {
  let depth = 0;
  let inString = false;
  for (let i = start; i < s.length; i++) {
    const ch = s[i];
    if (inString) {
      if (ch === "\\") i++;
      else if (ch === '"') inString = false;
    } else if (ch === '"') inString = true;
    else if (ch === "{") depth++;
    else if (ch === "}" && --depth === 0) return i;
  }
  return -1;
}
