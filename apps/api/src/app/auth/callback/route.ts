// This file is no longer used — Custom Connections don't have a redirect flow.
// Auth is handled via /auth/connect instead.
export async function GET() {
  return new Response("Not used. Use /auth/connect instead.", { status: 404 });
}
