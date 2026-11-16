import { createDatabaseClient, createSiteContext, errorResponse, BackendError } from "./_qoder/backend.mjs";
import { application } from "./routes.mjs";

const handle = application({ db: createDatabaseClient(), BackendError });

Deno.serve(async (request) => {
  let context;
  try {
    context = createSiteContext(request);
    return await handle(context);
  } catch (error) {
    return errorResponse(error, context?.requestId);
  }
});
