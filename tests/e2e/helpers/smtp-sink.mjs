// Local-only SMTP sink for the emailed sign-in code e2e spec
// (tests/e2e/host-sign-in-codes.spec.ts).
//
// lib/email/send-code-email.ts always talks SMTP over SSL on port 465 (Zoho).
// Supabase's local Mailpit only catches Supabase Auth mail, so this tiny
// server stands in for Zoho: it speaks just enough SMTP-over-TLS for
// nodemailer (EHLO, AUTH PLAIN, MAIL, RCPT, DATA, QUIT), keeps every message
// in memory, and exposes them over plain HTTP for the spec to read the code.
//
// Port 465 needs root, so the sink listens on 127.0.0.1:2465 and the dev
// server is started with a preload that points 127.0.0.1:465 there
// (tests/e2e/helpers/smtp-redirect.cjs). Run:
//   node tests/e2e/helpers/smtp-sink.mjs
// and start the dev server with
//   ZOHO_SMTP_HOST=127.0.0.1 ZOHO_SMTP_PASSWORD=anything \
//   NODE_TLS_REJECT_UNAUTHORIZED=0 \
//   NODE_OPTIONS="--require /abs/path/to/smtp-redirect.cjs"
// (NODE_OPTIONS splits on spaces — copy the preload to a space-free path
// such as /tmp if the repo path has spaces.)
// then run the spec with E2E_SMTP_SINK_URL=http://127.0.0.1:54399
//
// HTTP:
//   GET    /latest?to=<email>  → { to, subject, code, receivedAt } or 404
//   GET    /messages           → every message
//   DELETE /messages           → clear
//
// Never used outside local test runs.

import tls from "node:tls";
import http from "node:http";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const SMTP_PORT = Number(process.env.SMTP_SINK_PORT ?? 2465);
const HTTP_PORT = Number(process.env.SMTP_SINK_HTTP_PORT ?? 54399);

const dir = mkdtempSync(join(tmpdir(), "tr1via-smtp-sink-"));
execFileSync(
  "openssl",
  [
    "req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "2",
    "-subj", "/CN=127.0.0.1",
    "-keyout", join(dir, "key.pem"),
    "-out", join(dir, "cert.pem"),
  ],
  { stdio: "ignore" },
);

/** @type {{ to: string[]; subject: string; code: string | null; receivedAt: string }[]} */
const messages = [];

function record(to, raw) {
  const subject = /^Subject:\s*(.*)$/im.exec(raw)?.[1]?.trim() ?? "";
  const code = /(\d{6})/.exec(subject)?.[1] ?? null;
  messages.push({ to, subject, code, receivedAt: new Date().toISOString() });
}

const smtp = tls.createServer(
  { key: readFileSync(join(dir, "key.pem")), cert: readFileSync(join(dir, "cert.pem")) },
  (sock) => {
    let buf = "";
    let inData = false;
    let data = "";
    let rcpt = [];
    const say = (line) => sock.write(`${line}\r\n`);
    say("220 tr1via-smtp-sink ready");
    sock.on("data", (chunk) => {
      buf += chunk.toString("utf8");
      let idx;
      while ((idx = buf.indexOf("\r\n")) !== -1) {
        const line = buf.slice(0, idx);
        buf = buf.slice(idx + 2);
        if (inData) {
          if (line === ".") {
            inData = false;
            record(rcpt, data);
            data = "";
            say("250 OK queued");
          } else {
            data += (line.startsWith("..") ? line.slice(1) : line) + "\r\n";
          }
          continue;
        }
        const cmd = line.slice(0, 4).toUpperCase();
        if (cmd === "EHLO") {
          say("250-tr1via-smtp-sink");
          say("250 AUTH PLAIN");
        } else if (cmd === "HELO") say("250 tr1via-smtp-sink");
        else if (cmd === "AUTH") say("235 Authentication successful");
        else if (cmd === "MAIL") {
          rcpt = [];
          say("250 OK");
        } else if (cmd === "RCPT") {
          const m = /<([^>]+)>/.exec(line);
          if (m) rcpt.push(m[1].toLowerCase());
          say("250 OK");
        } else if (cmd === "DATA") {
          inData = true;
          say("354 End data with <CR><LF>.<CR><LF>");
        } else if (cmd === "RSET") {
          rcpt = [];
          say("250 OK");
        } else if (cmd === "NOOP") say("250 OK");
        else if (cmd === "QUIT") {
          say("221 Bye");
          sock.end();
        } else say("250 OK");
      }
    });
    sock.on("error", () => {});
  },
);

const api = http.createServer((req, res) => {
  const url = new URL(req.url ?? "/", `http://127.0.0.1:${HTTP_PORT}`);
  const send = (status, body) => {
    res.writeHead(status, { "content-type": "application/json" });
    res.end(JSON.stringify(body));
  };
  if (url.pathname === "/messages" && req.method === "DELETE") {
    messages.length = 0;
    return send(200, { ok: true });
  }
  if (url.pathname === "/messages") return send(200, messages);
  if (url.pathname === "/latest") {
    const to = (url.searchParams.get("to") ?? "").toLowerCase();
    const hit = [...messages].reverse().find((m) => m.to.includes(to));
    return hit ? send(200, hit) : send(404, { error: "none" });
  }
  send(404, { error: "not found" });
});

smtp.listen(SMTP_PORT, "127.0.0.1", () => {
  api.listen(HTTP_PORT, "127.0.0.1", () => {
    console.log(`smtp-sink: SMTPS 127.0.0.1:${SMTP_PORT}, HTTP 127.0.0.1:${HTTP_PORT}`);
  });
});
