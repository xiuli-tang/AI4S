import assert from "node:assert/strict";
import test from "node:test";
import { AdvisorError, advisorErrorMessage, requestAdvisor } from "../src/services/AdvisorService";

const messages = [{ role: "user" as const, content: "analyze this material" }];

test("advisor uses the server model default and preserves response metadata and length limits", async t => {
  let sent: any;
  t.mock.method(globalThis, "fetch", async (url: string, options: RequestInit) => {
    assert.equal(url, "/api/chat"); sent = JSON.parse(options.body as string);
    return Response.json({ model: "deepseek-flash", choices: [{ message: { content: "A bounded plan" }, finish_reason: "length" }], usage: { total_tokens: 321 } });
  });
  const response = await requestAdvisor(messages, new AbortController().signal);
  assert.deepEqual(sent.messages, messages);
  assert.equal(sent.model, undefined);
  assert.equal(sent.max_tokens, 2048);
  assert.equal(response.model, "deepseek-flash");
  assert.equal(response.truncated, true);
  assert.equal(response.tokens, 321);
});

test("a failed paid request is sent once and raw error bodies are never displayed", async t => {
  let hits = 0;
  t.mock.method(globalThis, "fetch", async () => { hits++; return Response.json({ code: "AUTHENTICATION_FAILED", error: "fake-private-key" }, { status: 401 }); });
  let failure: unknown;
  try { await requestAdvisor(messages, new AbortController().signal); } catch (error) { failure = error; }
  assert.ok(failure instanceof AdvisorError);
  assert.equal(hits, 1);
  assert.ok(!advisorErrorMessage(failure, "zh").includes("fake-private-key"));
  assert.match(advisorErrorMessage(failure, "en"), /site administrator/);
});

test("empty model output and invalid JSON cannot become a successful answer", async t => {
  const mock = t.mock.method(globalThis, "fetch", async () => Response.json({ choices: [{ message: { content: " " } }] }));
  await assert.rejects(requestAdvisor(messages, new AbortController().signal), (error: AdvisorError) => error.code === "BAD_RESPONSE");
  mock.mock.mockImplementation(async () => new Response("<html>raw fake-secret</html>"));
  await assert.rejects(requestAdvisor(messages, new AbortController().signal), (error: AdvisorError) => error.code === "BAD_RESPONSE");
});

test("cancelling the advisor aborts its request and cannot trigger a retry", async t => {
  let started!: () => void, hits = 0;
  const received = new Promise<void>(resolve => { started = resolve; });
  t.mock.method(globalThis, "fetch", (_url: string, options: RequestInit) => {
    hits++; started();
    return new Promise<Response>((_, reject) => options.signal!.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError"))));
  });
  const controller = new AbortController();
  const pending = requestAdvisor(messages, controller.signal);
  const cancelled = assert.rejects(pending, (error: Error) => error.name === "AbortError");
  await received; controller.abort(); await cancelled;
  assert.equal(hits, 1);
});
