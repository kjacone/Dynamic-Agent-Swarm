// Dependency injection is only for local checks. index.ts keeps Deno.serve.
export function application({ db, BackendError }) {
  const fail = (code, status) => {
    throw new BackendError(code, status);
  };
  const rows = (result) => {
    if (result.error) fail(result.error.code, result.error.status);
    return result.data;
  };
  const uuid = (value) =>
    typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value);

  const USE_CASES = [
    "Customer onboarding / KYC",
    "Customer service and concierge",
    "Claims, billing and document automation",
    "Internal operations and approvals",
    "Localisation and multichannel rollout",
    "Other",
  ];

  async function input(request) {
    if (!request.headers.get("content-type")?.startsWith("application/json")) fail("invalid_input", 400);
    const reader = request.body?.getReader();
    if (!reader) fail("invalid_input", 400);
    let size = 0;
    const chunks = [];
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.length;
        if (size > 16 * 1024) {
          await reader.cancel();
          fail("payload_too_large", 413);
        }
        chunks.push(value);
      }
    } finally {
      reader.releaseLock();
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.length;
    }
    try {
      return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
    } catch {
      fail("invalid_input", 400);
    }
  }

  function text(value, min, max) {
    if (typeof value !== "string") return null;
    const trimmed = value.trim();
    if (trimmed.length < min || trimmed.length > max) return null;
    return trimmed;
  }

  function validSlotDate(value) {
    if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const [year, month, day] = value.split("-").map(Number);
    const date = new Date(Date.UTC(year, month - 1, day));
    if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return false;
    const weekday = date.getUTCDay();
    if (weekday === 0 || weekday === 6) return false;
    const today = new Date();
    const todayUtc = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
    const slot = Date.UTC(year, month - 1, day);
    return slot >= todayUtc && slot <= todayUtc + 121 * 86400000;
  }

  const publicRow = (row) => ({
    reference: row.reference,
    slotDate: row.slot_date,
    slotStart: row.slot_start,
    hours: row.hours,
    feeLabel: row.fee_label,
    status: row.status,
  });

  return async (ctx) => {
    const request = ctx.request;
    const pathname = new URL(request.url).pathname;
    const match = pathname.match(/^\/(?:functions\/v1\/)?(?:app|app-d[0-9a-f]{32})(\/.*)?$/);
    if (!match) fail("not_found", 404);
    const path = match[1] || "/";

    if (path === "/api/health" && request.method === "GET") {
      return Response.json({ ok: true });
    }

    if (path === "/api/booking/dates" && request.method === "GET") {
      const found = rows(await db.from("booking_forms").select("slot_date").limit(1000));
      const today = new Date().toISOString().slice(0, 10);
      const booked = Array.from(
        new Set(
          (found ?? [])
            .map((row) => row.slot_date)
            .filter((value) => typeof value === "string" && value >= today),
        ),
      ).sort();
      return Response.json({ booked });
    }

    if (path === "/api/bookings" && request.method === "POST") {
      const key = request.headers.get("idempotency-key");
      if (!uuid(key)) fail("invalid_input", 400);

      const body = await input(request);
      if (typeof body?.website === "string" && body.website.trim()) fail("invalid_input", 400);

      const name = text(body?.name, 2, 120);
      const email = text(body?.email, 5, 200);
      const organization = text(body?.organization, 2, 160);
      const details = body?.details == null ? "" : text(body.details, 0, 2000);
      const useCase = typeof body?.useCase === "string" && USE_CASES.includes(body.useCase) ? body.useCase : null;
      const hours = body?.hours;
      const validHours = Number.isInteger(hours) && (hours === 4 || hours === 8 || (hours >= 9 && hours <= 12));

      if (
        !name ||
        !email ||
        !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
        !organization ||
        details === null ||
        !useCase ||
        !validHours ||
        body?.acknowledged !== true ||
        !validSlotDate(body?.slotDate)
      ) {
        fail("invalid_input", 400);
      }

      const id = key;
      const reference = `CONS-${id.replace(/-/g, "").slice(0, 8).toUpperCase()}`;
      const feeLabel =
        hours === 4 ? "USD 175 (indicative)" : hours === 8 ? "USD 320 (indicative)" : "Quoted after scoping";
      const record = {
        id,
        name,
        email,
        organization,
        use_case: useCase,
        details,
        slot_date: body.slotDate,
        slot_start: "09:00",
        hours,
        duration_label: `${hours} hours`,
        fee_label: feeLabel,
        reference,
        status: "requested",
        created_at: new Date().toISOString(),
      };

      try {
        const inserted = rows(
          await db
            .from("booking_forms")
            .insertIfAbsent(record, { onConflict: "id" })
            .select("reference,slot_date,slot_start,hours,fee_label,status"),
        );
        if (inserted?.length) return Response.json(publicRow(inserted[0]), { status: 201 });
      } catch (error) {
        if (!(error instanceof BackendError)) throw error;
        // A duplicate primary key is a retry; a duplicate day is a lost slot race.
        const existing = rows(
          await db
            .from("booking_forms")
            .select("email,reference,slot_date,slot_start,hours,fee_label,status")
            .eq("id", id)
            .limit(1),
        );
        if (existing?.length) {
          if (existing[0].email !== email) fail("idempotency_conflict", 409);
          return Response.json(publicRow(existing[0]));
        }
        const taken = rows(
          await db.from("booking_forms").select("id").eq("slot_date", body.slotDate).limit(1),
        );
        if (taken?.length) fail("slot_unavailable", 409);
        throw error;
      }

      const existing = rows(
        await db
          .from("booking_forms")
          .select("email,reference,slot_date,slot_start,hours,fee_label,status")
          .eq("id", id)
          .limit(1),
      );
      if (!existing?.length) fail("booking_unavailable", 503);
      if (existing[0].email !== email) fail("idempotency_conflict", 409);
      return Response.json(publicRow(existing[0]));
    }

    fail("not_found", 404);
  };
}
