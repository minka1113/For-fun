// A stand-in for an OpenAI-compatible chat server, scripted per request.

import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";

export interface MockReply {
  status?: number;
  /** Body for a non-200 status. */
  error?: string;
  text?: string;
  toolCalls?: { id?: string; name: string; args: object | string }[];
  finish?: string;
  /** Answer with a single JSON document instead of a stream. */
  plain?: boolean;
  /** Never answer, to exercise the timeout. */
  hang?: boolean;
}

export interface RecordedRequest {
  path: string;
  headers: IncomingMessage["headers"];
  body: any;
}

export interface MockLlm {
  baseUrl: string;
  requests: RecordedRequest[];
  close(): Promise<void>;
}

export async function startMockLlm(script: MockReply | ((body: any, n: number) => MockReply)): Promise<MockLlm> {
  const requests: RecordedRequest[] = [];
  const server: Server = createServer(async (req, res) => {
    let raw = "";
    for await (const chunk of req) raw += chunk;
    const body = JSON.parse(raw || "{}");
    requests.push({ path: req.url ?? "", headers: req.headers, body });
    const reply = typeof script === "function" ? script(body, requests.length - 1) : script;

    if (reply.hang) return;
    if (reply.status && reply.status !== 200) {
      res.writeHead(reply.status, { "content-type": "text/plain" }).end(reply.error ?? "error");
      return;
    }
    const finish = reply.finish ?? (reply.toolCalls?.length ? "tool_calls" : "stop");
    const calls = (reply.toolCalls ?? []).map((c, i) => ({
      id: c.id ?? `call_${i}`,
      name: c.name,
      args: typeof c.args === "string" ? c.args : JSON.stringify(c.args),
    }));

    if (reply.plain) {
      const message = {
        content: reply.text ?? "",
        tool_calls: calls.map((c) => ({ id: c.id, type: "function", function: { name: c.name, arguments: c.args } })),
      };
      res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ choices: [{ message, finish_reason: finish }] }));
      return;
    }

    res.writeHead(200, { "content-type": "text/event-stream" });
    const send = (choice: object) => res.write(`data: ${JSON.stringify({ choices: [choice] })}\n\n`);
    send({ delta: { role: "assistant", content: "" } });
    // Split the text and tool arguments so clients have to reassemble them.
    const text = reply.text ?? "";
    const mid = Math.floor(text.length / 2);
    if (text) {
      send({ delta: { content: text.slice(0, mid) } });
      send({ delta: { content: text.slice(mid) } });
    }
    calls.forEach((c, index) => {
      const half = Math.floor(c.args.length / 2);
      send({ delta: { tool_calls: [{ index, id: c.id, type: "function", function: { name: c.name, arguments: c.args.slice(0, half) } }] } });
      send({ delta: { tool_calls: [{ index, function: { arguments: c.args.slice(half) } }] } });
    });
    send({ delta: {}, finish_reason: finish });
    res.write("data: [DONE]\n\n");
    res.end();
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return {
    baseUrl: `http://127.0.0.1:${port}/v1`,
    requests,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}
