import { createServer } from "node:http";
import next from "next";
import { attachCollab } from "./lib/collab/server";
import { migrate, pool } from "./lib/db";

const dev = !process.argv.includes("--prod");
const port = Number(process.env.PORT ?? 3000);

async function main() {
  const app = next({ dev, port });
  const handle = app.getRequestHandler();
  await app.prepare();
  await migrate();

  const server = createServer((req, res) => void handle(req, res));
  attachCollab(server);
  // Next.js needs the upgrade event for its own dev tooling; ours is handled first and only for /collab/*.
  const upgrade = app.getUpgradeHandler();
  server.on("upgrade", (req, socket, head) => {
    if (!(req.url ?? "").startsWith("/collab/")) void upgrade(req, socket, head);
  });
  server.listen(port, () => console.log(`Draftly on http://localhost:${port}`));

  for (const sig of ["SIGINT", "SIGTERM"]) {
    process.on(sig, () => {
      server.close(() => void pool().end().then(() => process.exit(0)));
      setTimeout(() => process.exit(0), 3000).unref();
    });
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
