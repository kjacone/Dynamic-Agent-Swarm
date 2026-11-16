// Local-only harness: runs the real booking routes against an in-memory table.
// Not part of dist/ or the Function package.
import http from "node:http";
import { application } from "../functions/routes.mjs";

class BackendError extends Error {
  constructor(code, status) {
    super(code);
    this.code = code;
    this.status = status;
  }
}

const table = [];
const matches = (row, filters) => filters.every(([column, value]) => row[column] === value);

function fakeDb() {
  return {
    from(name) {
      if (name !== "booking_forms") throw new Error(`unknown table ${name}`);
      let op = "select";
      let columns = "*";
      let record = null;
      let filters = [];
      let max = Infinity;

      const builder = {
        select(next) {
          columns = next;
          return builder;
        },
        insertIfAbsent(next, options) {
          op = "insert";
          record = next;
          builder.conflict = options?.onConflict;
          return builder;
        },
        eq(column, value) {
          filters = [...filters, [column, value]];
          return builder;
        },
        limit(value) {
          max = value;
          return builder;
        },
        order() {
          return builder;
        },
        then(resolve) {
          resolve(execute());
        },
      };

      function execute() {
        if (op === "insert") {
          if (record.id && table.some((row) => row.id === record.id)) return { data: [], error: null };
          if (table.some((row) => row.slot_date === record.slot_date)) {
            return { data: null, error: { code: "23505", status: 409 } };
          }
          if (table.some((row) => row.reference === record.reference)) {
            return { data: null, error: { code: "23505", status: 409 } };
          }
          table.push({ ...record });
          return { data: [pick(record)], error: null };
        }
        const found = table.filter((row) => matches(row, filters)).slice(0, max);
        return { data: found.map(pick), error: null };
      }

      function pick(row) {
        if (columns === "*") return { ...row };
        const keys = columns.split(",").map((key) => key.trim());
        return Object.fromEntries(keys.map((key) => [key, row[key]]));
      }

      return builder;
    },
  };
}

const routes = application({ db: fakeDb(), BackendError });

const port = Number(process.env.PORT ?? 8000);

const server = http.createServer(async (req, res) => {
  try {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = chunks.length ? Buffer.concat(chunks) : undefined;
    const request = new Request(`http://127.0.0.1:${port}${req.url}`, {
      method: req.method,
      headers: req.headers,
      body,
    });
    const response = await routes({ request, requestId: "local" });
    res.writeHead(response.status, Object.fromEntries(response.headers));
    res.end(Buffer.from(await response.arrayBuffer()));
  } catch (error) {
    const status = error instanceof BackendError ? error.status : 500;
    res.writeHead(status, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: error?.code ?? "unexpected" }));
  }
});

server.listen(port, "127.0.0.1", () => {
  console.log(`Local booking function on http://127.0.0.1:${port}/functions/v1/app/api/health`);
});
