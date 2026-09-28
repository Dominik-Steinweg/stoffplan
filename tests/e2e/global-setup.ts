import { createServer, preview } from 'vite';

// Keeping the server in this process avoids orphaned npm/cmd process trees on Windows.
export default async function setup() {
  if (process.env.STOFFPLAN_TEST_URL) return;
  const production = !!process.env.STOFFPLAN_TEST_BUILD;
  const port = production ? 5174 : 5173;
  const url = `http://127.0.0.1:${port}${process.env.STOFFPLAN_BASE_PATH || '/'}`;
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(1000) });
    if (response.ok) return; // A manually started server belongs to its caller.
  } catch {
    /* Start the test's own server below. */
  }
  if (production) {
    const server = await preview({
      preview: { host: '127.0.0.1', port, strictPort: true, open: false },
    });
    return () =>
      new Promise<void>((resolve, reject) => {
        server.httpServer.close((error) => (error ? reject(error) : resolve()));
        if ('closeAllConnections' in server.httpServer) server.httpServer.closeAllConnections();
      });
  }
  const server = await createServer({
    server: { host: '127.0.0.1', port, strictPort: true, open: false },
  });
  await server.listen();
  return () => server.close();
}
