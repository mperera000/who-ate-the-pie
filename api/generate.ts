import { handleGenerate } from "../src/api/handlers.js";

export default { fetch: (request: Request) => handleGenerate(request) };
