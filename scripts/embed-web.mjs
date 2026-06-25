// Copy the built web app (apps/web/dist) into the API's public/ directory so the
// single Next service serves both the SPA and the API. Run after build:web and
// before build:api.
import { rm, mkdir, cp } from "node:fs/promises";

const root = new URL("../", import.meta.url);
const src = new URL("apps/web/dist/", root);
const dest = new URL("apps/api/public/", root);

await rm(dest, { recursive: true, force: true });
await mkdir(dest, { recursive: true });
await cp(src, dest, { recursive: true });

console.log("Embedded apps/web/dist -> apps/api/public");
