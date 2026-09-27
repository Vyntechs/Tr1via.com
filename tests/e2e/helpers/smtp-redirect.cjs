// Test-only Node preload for the local SMTP sink (see smtp-sink.mjs).
// lib/email/send-code-email.ts always dials port 465; binding 465 needs
// root, so this sends any TLS connection to 127.0.0.1:465 to the sink on
// 127.0.0.1:2465 instead. Every other host/port is left alone. Only loaded
// via NODE_OPTIONS for a local e2e run — never in the app.
// eslint-disable-next-line @typescript-eslint/no-require-imports -- CommonJS preload for NODE_OPTIONS --require
const tls = require("node:tls");
const SINK_PORT = Number(process.env.SMTP_SINK_PORT ?? 2465);
const original = tls.connect;
tls.connect = function patchedConnect(...args) {
  const opts = args[0];
  if (
    opts &&
    typeof opts === "object" &&
    Number(opts.port) === 465 &&
    (opts.host === "127.0.0.1" || opts.host === "localhost")
  ) {
    args[0] = { ...opts, port: SINK_PORT };
  }
  return original.apply(this, args);
};
