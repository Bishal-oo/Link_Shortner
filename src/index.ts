import { createApp } from "./app.js";
import { logger } from "./utils/logger.js";
import { env } from "./config/env.js";


const app = createApp();

// env.PORT is guaranteed to be a valid positive integer here — env.ts already
// validated it (or the process would have exited before reaching this line).
app.listen(env.PORT, () => {
  logger.info(`Server listening on http://localhost:${env.PORT}`);
});
