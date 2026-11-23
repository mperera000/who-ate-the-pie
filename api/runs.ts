import { handleRuns } from "../src/api/handlers.js";

export default { fetch: (request: Request) => handleRuns(request) };
