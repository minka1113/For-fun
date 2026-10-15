import type { Candidate, Finding, Gap, ResearchChatRequest, ResearchChatResult, ResearchMessage, ResearchState, SubQuestion } from "../../shared/types";
import { uid } from "./storage";
import { normalizeUrl } from "../../shared/chat";

export function emptyResearch(): ResearchState {
  return { question: "", subQuestions: [], candidates: [], findings: [], gaps: [], chat: [] };
}


/** The compact notebook summary sent with each research message. */
export function notebookForRequest(r: ResearchState): ResearchChatRequest["state"] {
  return {
    question: r.question,
    subQuestions: r.subQuestions,
    gaps: r.gaps,
    candidates: r.candidates.map(({ url, title, status }) => ({ url, title, status })),
    findings: r.findings.map(({ subQuestionId, text, url }) => ({ subQuestionId, text, url })),
  };
}

/** Merge a finished research turn into the notebook and the chat. */
export function applyResearchTurn(r: ResearchState, result: ResearchChatResult): ResearchState {
  const u = result.updates;

  // A new plan keeps the ids of sub-questions whose text is unchanged, so their findings stay attached.
  let subQuestions: SubQuestion[] = r.subQuestions;
  let question = r.question;
  if (u.plan) {
    question = u.plan.question || r.question;
    subQuestions = u.plan.subQuestions.map((text) => r.subQuestions.find((q) => q.text === text) ?? { id: uid("sq"), text });
  }
  const subId = (n: number) => (n >= 1 ? subQuestions[n - 1]?.id : undefined);

  const known = new Set(r.candidates.map((c) => normalizeUrl(c.url)));
  const candidates: Candidate[] = [...r.candidates];
  for (const c of u.candidates) {
    if (known.has(normalizeUrl(c.url))) continue;
    known.add(normalizeUrl(c.url));
    const { subQuestions: nums, ...rest } = c;
    candidates.push({
      ...rest,
      id: uid("cand"),
      subQuestionIds: nums.map(subId).filter((id): id is string => Boolean(id)),
      status: "new",
      foundAt: Date.now(),
    });
  }
  const findings: Finding[] = [
    ...r.findings,
    ...u.findings.map(({ subQuestion, ...f }) => ({ ...f, id: uid("find"), subQuestionId: subId(subQuestion), createdAt: Date.now() })),
  ];
  const gaps: Gap[] = [...r.gaps, ...u.gaps.map((g) => ({ id: uid("gap"), text: g.text, subQuestionId: subId(g.subQuestion) }))];

  const reply: ResearchMessage = {
    id: uid("rmsg"),
    role: "assistant",
    text: result.text,
    parts: result.parts,
    activity: result.activity,
    createdAt: Date.now(),
  };
  return { ...r, question, subQuestions, candidates, findings, gaps, chat: [...r.chat, reply] };
}
