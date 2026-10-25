import { createApp } from './app.js';
import { runtimeConfig } from './runtime-config.js';

const config = runtimeConfig();
const { port, production } = config;
const { app, close } = createApp(config);
const server = app.listen(port, '0.0.0.0', () => console.log(`Ali Insight service listening on port ${port} (${production ? 'production' : 'development'})`));
function shutdown() { server.close(() => { close(); process.exit(0); }); }
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
