// Actual local models and production frontend, with an isolated QA job store.
// Starting this server never submits a generation job by itself.
import path from 'node:path';
import {createStudioServer} from '../scripts/serve.mjs';
const {server,api}=await createStudioServer({
  runtimeRoot:path.resolve('test-results/generation-real-v4/runtime'),
  env:{TRYON_PROVIDER:'local-catvton',MOTION_PROVIDER:'local-tps',MOTION_ENABLED:'true',MOTION_ACCEPTS_DRIVING_VIDEO:'true'},
});
server.listen(5176,'127.0.0.1',()=>console.log('Real local generation QA: http://127.0.0.1:5176'));
async function stop(){await api.close();server.close();server.closeIdleConnections();}
process.once('SIGINT',stop);process.once('SIGTERM',stop);
