import { runCli } from "./cli";
import { PORT, CAPTURE_DIR, CAPTURE_ENABLED } from "./config";

// With CLI args, act as a one-shot tool (e.g. --replay) instead of a server.
if (process.argv.length > 2) {
  runCli(process.argv.slice(2))
    .then((code) => {
      // exitCode + natural drain instead of process.exit(): forcing an exit
      // while fetch keep-alive sockets are open crashes libuv on Windows
      process.exitCode = code;
    })
    .catch((err) => {
      console.error(err);
      process.exitCode = 1;
    });
} else {
  startServer();
}

function startServer() {
  // deferred import so CLI runs don't spin up express
  const { createApp } = require("./app") as typeof import("./app");
  const app = createApp();

  const server = app.listen(PORT, () => {
    console.log(`teams-card-apiserver listening on http://0.0.0.0:${PORT}`);
    console.log(
      CAPTURE_ENABLED
        ? `capturing webhook payloads to ${CAPTURE_DIR}`
        : "payload capture disabled (CAPTURE_ENABLED=false)"
    );
    console.log(`point services at:`);
    console.log(`  Radarr  -> http://<this-host>:${PORT}/webhook/radarr`);
    console.log(`  Sonarr  -> http://<this-host>:${PORT}/webhook/sonarr`);
    console.log(`  Plex    -> http://<this-host>:${PORT}/webhook/plex`);
  });

  // Exit promptly on docker stop / Ctrl+C instead of waiting for the 10s kill.
  for (const signal of ["SIGTERM", "SIGINT"] as const) {
    process.on(signal, () => {
      console.log(`${signal} received, shutting down`);
      server.close(() => process.exit(0));
      setTimeout(() => process.exit(1), 5000).unref();
    });
  }
}
