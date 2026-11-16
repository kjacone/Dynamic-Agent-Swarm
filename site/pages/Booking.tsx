import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Banknote,
  CalendarDays,
  Check,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Loader2,
  Mail,
  MapPin,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import { SiteFooter, SiteHeader } from "@/components/site/Chrome";
import { BOOKING_USE_CASES } from "@/data/demo";
import { navigate } from "@/lib/nav";

type Duration = "4" | "8" | "custom";

type BookingResult = {
  reference: string;
  slotDate: string;
  slotStart: string;
  hours: number;
  feeLabel: string;
};

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

function iso(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function addDays(date: Date, days: number) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function isWeekday(date: Date) {
  const day = date.getDay();
  return day !== 0 && day !== 6;
}

function nextOpenDay(from: Date) {
  let candidate = addDays(from, 1);
  while (!isWeekday(candidate)) candidate = addDays(candidate, 1);
  return candidate;
}

function nextFreeDay(from: Date, booked: Set<string>, max: Date) {
  let candidate = nextOpenDay(from);
  while (candidate <= max) {
    if (!booked.has(iso(candidate))) return candidate;
    candidate = addDays(candidate, 1);
  }
  return null;
}

function formatLong(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  return new Intl.DateTimeFormat("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" }).format(
    new Date(year, month - 1, day),
  );
}

function durationLabel(duration: Duration, customHours: number) {
  if (duration === "4") return "4 hours";
  if (duration === "8") return "8 hours";
  return `${customHours} hours`;
}

function feeLabel(duration: Duration) {
  if (duration === "4") return "USD 175 (indicative)";
  if (duration === "8") return "USD 320 (indicative)";
  return "Quoted after scoping";
}

function endTime(duration: Duration, customHours: number) {
  const hours = duration === "4" ? 4 : duration === "8" ? 8 : customHours;
  return `${String(9 + hours).padStart(2, "0")}:00`;
}

export function Booking() {
  const today = useMemo(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), now.getDate());
  }, []);
  const firstOpen = useMemo(() => nextOpenDay(today), [today]);

  const [cursor, setCursor] = useState(new Date(firstOpen.getFullYear(), firstOpen.getMonth(), 1));
  const [selectedDate, setSelectedDate] = useState(iso(firstOpen));
  const [duration, setDuration] = useState<Duration>("4");
  const [customHours, setCustomHours] = useState(10);
  const [booked, setBooked] = useState<Set<string>>(new Set());
  const [availabilityNote, setAvailabilityNote] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [organization, setOrganization] = useState("");
  const [useCase, setUseCase] = useState(BOOKING_USE_CASES[0]);
  const [details, setDetails] = useState("");
  const [acknowledged, setAcknowledged] = useState(false);
  const [website, setWebsite] = useState("");
  const [acceptedTerms, setAcceptedTerms] = useState(false);

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<BookingResult | null>(null);
  const requestId = useRef(crypto.randomUUID());

  useEffect(() => {
    let active = true;
    fetch("/functions/v1/app/api/booking/dates", { credentials: "same-origin" })
      .then(async (response) => {
        if (!response.ok) throw new Error("unavailable");
        const payload = await response.json();
        if (!payload || !Array.isArray(payload.booked)) throw new Error("invalid");
        if (!active) return;
        const nextBooked = new Set<string>(
          payload.booked.filter((value: unknown): value is string => typeof value === "string"),
        );
        setBooked(nextBooked);
        if (nextBooked.has(selectedDate)) {
          const fallback = nextFreeDay(today, nextBooked, maxDate);
          if (fallback) {
            setSelectedDate(iso(fallback));
            setCursor(new Date(fallback.getFullYear(), fallback.getMonth(), 1));
          }
        }
      })
      .catch(() => {
        if (active) setAvailabilityNote("Live availability could not be loaded. We re-check the day when you submit.");
      });
    return () => {
      active = false;
    };
  }, []);

  const minDate = useMemo(() => addDays(today, 1), [today]);
  const maxDate = useMemo(() => addDays(today, 120), [today]);

  const cells = useMemo(() => {
    const year = cursor.getFullYear();
    const month = cursor.getMonth();
    const first = new Date(year, month, 1);
    const offset = (first.getDay() + 6) % 7;
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const list: (Date | null)[] = Array.from({ length: offset }, () => null);
    for (let day = 1; day <= daysInMonth; day += 1) list.push(new Date(year, month, day));
    return list;
  }, [cursor]);

  const selectedHours = duration === "4" ? 4 : duration === "8" ? 8 : customHours;
  const formReady =
    name.trim().length >= 2 &&
    /.+@.+\..+/.test(email.trim()) &&
    organization.trim().length >= 2 &&
    !booked.has(selectedDate) &&
    acknowledged &&
    acceptedTerms &&
    selectedHours >= 4;

  function canSelect(date: Date) {
    return date >= minDate && date <= maxDate && isWeekday(date) && !booked.has(iso(date));
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!formReady || submitting) return;
    setSubmitting(true);
    setError(null);

    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), 15000);

    try {
      const response = await fetch("/functions/v1/app/api/bookings", {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json", "idempotency-key": requestId.current },
        body: JSON.stringify({
          name: name.trim(),
          email: email.trim(),
          organization: organization.trim(),
          useCase,
          details: details.trim(),
          slotDate: selectedDate,
          hours: selectedHours,
          acknowledged,
          website,
        }),
        signal: controller.signal,
      });

      const payload = await response.json().catch(() => null);

      if (response.status === 409) {
        setBooked((current) => new Set(current).add(selectedDate));
        setError("That day was just taken. Please choose another open weekday.");
        setSubmitting(false);
        return;
      }
      if (!response.ok || !payload || typeof payload.reference !== "string") {
        const code = payload && typeof payload.error === "string" ? payload.error : "";
        setError(
          code === "invalid_input"
            ? "Some details were not accepted. Check the fields and try again."
            : "We could not submit the request just now. Your details are kept — retry in a moment.",
        );
        setSubmitting(false);
        return;
      }

      setResult({
        reference: payload.reference,
        slotDate: payload.slotDate ?? selectedDate,
        slotStart: payload.slotStart ?? "09:00",
        hours: payload.hours ?? selectedHours,
        feeLabel: payload.feeLabel ?? feeLabel(duration),
      });
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch {
      setError("The connection dropped before we got a confirmation. Your details are kept; retry to recover the same request.");
    } finally {
      window.clearTimeout(timer);
      setSubmitting(false);
    }
  }

  function resetForm() {
    requestId.current = crypto.randomUUID();
    setResult(null);
    setError(null);
    setName("");
    setEmail("");
    setOrganization("");
    setUseCase(BOOKING_USE_CASES[0]);
    setDetails("");
    setAcknowledged(false);
    setAcceptedTerms(false);
    setDuration("4");
    setCustomHours(10);
    setSelectedDate(iso(firstOpen));
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  if (result) {
    return (
      <div className="paper-grain min-h-screen">
        <SiteHeader path="/book" />
        <main className="site-container max-w-3xl py-16">
          <div className="rounded-2xl border border-border bg-card p-6 shadow-[0_24px_60px_-40px_rgba(11,42,32,0.4)] sm:p-9">
            <span className="flex h-12 w-12 items-center justify-center rounded-full bg-[var(--site-accent)]/10 text-[var(--site-accent)]">
              <Check className="h-6 w-6" strokeWidth={2.5} />
            </span>
            <p className="mt-5 text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--site-accent)]">
              Request received
            </p>
            <h1 className="font-display mt-2 text-[32px] leading-tight sm:text-[38px]">Your slot is reserved for review.</h1>
            <p className="mt-3 max-w-xl text-[14px] leading-relaxed text-muted-foreground">
              We received your consultation request. It is stored for review and we follow up using the contact details
              you provided. This booking is a request, not a payment.
            </p>

            <div className="mt-6 rounded-xl border border-border bg-[var(--site-bg)]/60 p-4">
              <div className="grid gap-3 sm:grid-cols-2">
                <Detail label="Reference" value={result.reference} mono />
                <Detail label="Day" value={formatLong(result.slotDate)} />
                <Detail label="Time" value={`${result.slotStart}–${endTime(duration, result.hours)} EAT`} />
                <Detail label="Duration" value={`${result.hours} hours`} />
                <Detail label="Indicative fee" value={result.feeLabel} />
                <Detail label="Status" value="Awaiting confirmation" />
              </div>
            </div>

            <div className="mt-5 flex items-start gap-2 rounded-lg border border-[var(--site-gold)]/40 bg-[var(--site-gold)]/8 px-3.5 py-3 text-[12px] leading-relaxed text-[#6d5117]">
              <Banknote className="mt-0.5 h-4 w-4 shrink-0" />
              <span>
                Consultation is a paid service. The fee is quoted and confirmed before the session; nothing is charged by
                this form.
              </span>
            </div>

            <div className="mt-6 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => navigate("/demo/")}
                className="inline-flex items-center gap-2 rounded-full bg-[var(--site-accent)] px-5 py-2.5 text-[12.5px] font-semibold text-[var(--site-on-accent)]"
              >
                Explore the demo while you wait <ArrowRight className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                onClick={resetForm}
                className="rounded-full border border-border px-5 py-2.5 text-[12.5px] font-medium"
              >
                Book another session
              </button>
            </div>
            <p className="mt-4 text-[10.5px] text-muted-foreground">
              Keep the reference handy. Quote it when we follow up about this request.
            </p>
          </div>
        </main>
        <SiteFooter />
      </div>
    );
  }

  return (
    <div className="paper-grain min-h-screen">
      <SiteHeader path="/book" />
      <main>
        <div className="border-b border-border/70 bg-[var(--site-bg)]">
          <div className="site-container py-10">
            <button
              type="button"
              onClick={() => navigate("/")}
              className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground hover:text-foreground"
            >
              <ArrowLeft className="h-3 w-3" /> Back to the platform
            </button>
            <div className="mt-4 flex flex-wrap items-end justify-between gap-4">
              <div>
                <span className="inline-flex items-center gap-1.5 rounded-full border border-[var(--site-gold)]/40 bg-[var(--site-gold)]/10 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-[#7a5b1c]">
                  <Banknote className="h-3 w-3" /> Paid consultation
                </span>
                <h1 className="font-display mt-3 text-[36px] leading-[1.05] tracking-[-0.02em] sm:text-[46px]">
                  Book a working session.
                </h1>
                <p className="mt-3 max-w-2xl text-[14.5px] leading-relaxed text-muted-foreground">
                  Pick an open weekday and a 4-hour, 8-hour or custom block. We follow up using the contact details you
                  give to confirm scope and the final quote — this form only reserves the slot for review. You leave with
                  a written deployment outline and a dated path to a live pilot: weeks, not months.
                </p>
              </div>
              <div className="rounded-xl border border-border bg-card px-4 py-3 text-[11px] leading-relaxed text-muted-foreground">
                <p className="flex items-center gap-1.5 font-medium text-foreground"><MapPin className="h-3.5 w-3.5" /> Remote or Dar es Salaam</p>
                <p className="mt-1 flex items-center gap-1.5"><Clock3 className="h-3.5 w-3.5" /> 09:00 EAT start · Mon–Fri</p>
                <p className="mt-1 flex items-center gap-1.5"><ShieldCheck className="h-3.5 w-3.5" /> Session details stay confidential</p>
              </div>
            </div>
          </div>
        </div>

        <div className="site-container grid gap-8 py-10 lg:grid-cols-[1.35fr_0.65fr] lg:items-start">
          <form onSubmit={submit} className="min-w-0 space-y-5">
            <section className="rounded-2xl border border-border bg-card p-5 sm:p-6">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2.5">
                  <span className="flex h-7 w-7 items-center justify-center rounded-full bg-[var(--site-accent)] text-[11px] font-semibold text-[var(--site-on-accent)]">1</span>
                  <h2 className="text-[15px] font-semibold">Pick an open day</h2>
                </div>
                <span className="text-[10.5px] text-muted-foreground">Next 4 months · weekdays only</span>
              </div>

              <div className="mt-4 grid gap-5 md:grid-cols-[1fr_260px]">
                <div>
                  <div className="flex items-center justify-between">
                    <button
                      type="button"
                      onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() - 1, 1))}
                      disabled={cursor <= new Date(today.getFullYear(), today.getMonth(), 1)}
                      aria-label="Previous month"
                      className="rounded-md border border-border p-1.5 disabled:opacity-40"
                    >
                      <ChevronLeft className="h-3.5 w-3.5" />
                    </button>
                    <p className="text-[13px] font-semibold">
                      {MONTHS[cursor.getMonth()]} {cursor.getFullYear()}
                    </p>
                    <button
                      type="button"
                      onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1))}
                      disabled={cursor >= new Date(maxDate.getFullYear(), maxDate.getMonth(), 1)}
                      aria-label="Next month"
                      className="rounded-md border border-border p-1.5 disabled:opacity-40"
                    >
                      <ChevronRight className="h-3.5 w-3.5" />
                    </button>
                  </div>
                  <div className="mt-3 grid grid-cols-7 gap-1 text-center">
                    {WEEKDAYS.map((day) => (
                      <span key={day} className="pb-1 text-[9.5px] font-medium uppercase tracking-[0.08em] text-muted-foreground">
                        {day}
                      </span>
                    ))}
                    {cells.map((date, index) => {
                      if (!date) return <span key={`empty-${index}`} />;
                      const value = iso(date);
                      const selectable = canSelect(date);
                      const isSelected = value === selectedDate;
                      const isBooked = booked.has(value);
                      const closed = !selectable && !isBooked && (date < minDate || date > maxDate || !isWeekday(date));
                      return (
                        <button
                          key={value}
                          type="button"
                          onClick={() => setSelectedDate(value)}
                          disabled={!selectable}
                          aria-label={formatLong(value)}
                          aria-pressed={isSelected}
                          className={`relative flex aspect-square flex-col items-center justify-center rounded-lg text-[12px] ${
                            isSelected
                              ? "bg-[var(--site-accent)] font-semibold text-[var(--site-on-accent)]"
                              : isBooked
                                ? "bg-[var(--site-bg)] text-muted-foreground/50 line-through"
                                : selectable
                                  ? "border border-[var(--site-accent)]/20 bg-[var(--site-surface)] font-medium hover:border-[var(--site-accent)]/50"
                                  : closed
                                    ? "text-muted-foreground/35"
                                    : "text-muted-foreground/30"
                          }`}
                        >
                          {date.getDate()}
                          {selectable && !isSelected ? (
                            <span className="absolute bottom-1 h-1 w-1 rounded-full bg-[var(--site-accent)]/60" />
                          ) : null}
                        </button>
                      );
                    })}
                  </div>
                  <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[10px] text-muted-foreground">
                    <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-[var(--site-accent)]/60" /> Open</span>
                    <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-border" /> Booked or closed</span>
                    <span>{availabilityNote ? availabilityNote : "Availability checks against confirmed requests."}</span>
                  </div>
                </div>

                <div className="rounded-xl border border-border bg-[var(--site-bg)]/60 p-4">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">Selected day</p>
                  <p className="mt-1.5 text-[13px] font-semibold leading-snug">{formatLong(selectedDate)}</p>
                  <div className="mt-3 space-y-1.5 text-[11px] text-muted-foreground">
                    <p className="flex items-center gap-1.5"><CalendarDays className="h-3.5 w-3.5" /> {booked.has(selectedDate) ? "Already booked" : "Open for a request"}</p>
                    <p className="flex items-center gap-1.5"><Clock3 className="h-3.5 w-3.5" /> 09:00–17:00 EAT</p>
                  </div>
                  {booked.has(selectedDate) ? (
                    <p className="mt-2.5 rounded-md border border-amber-500/30 bg-amber-500/8 px-2 py-1.5 text-[10px] leading-relaxed text-amber-700">
                      This day is no longer open. Pick another weekday from the calendar.
                    </p>
                  ) : null}
                  <p className="mt-3 border-t border-border/70 pt-2.5 text-[10px] leading-relaxed text-muted-foreground">
                    Times are East Africa Time (UTC+3). Weekends are closed. One consultation runs per day.
                  </p>
                </div>
              </div>
            </section>

            <section className="rounded-2xl border border-border bg-card p-5 sm:p-6">
              <div className="flex items-center gap-2.5">
                <span className="flex h-7 w-7 items-center justify-center rounded-full bg-[var(--site-accent)] text-[11px] font-semibold text-[var(--site-on-accent)]">2</span>
                <h2 className="text-[15px] font-semibold">Choose a length</h2>
              </div>
              <div className="mt-4 grid gap-2.5 sm:grid-cols-3">
                {(
                  [
                    { id: "4", title: "Half day", hours: "4 hours", time: "09:00–13:00", fee: "USD 175", note: "Indicative" },
                    { id: "8", title: "Full day", hours: "8 hours", time: "09:00–17:00", fee: "USD 320", note: "Indicative" },
                  ] as const
                ).map((option) => (
                  <button
                    key={option.id}
                    type="button"
                    onClick={() => setDuration(option.id)}
                    className={`rounded-xl border p-3.5 text-left transition-colors ${
                      duration === option.id
                        ? "border-[var(--site-accent)] bg-[var(--site-accent)]/5"
                        : "border-border hover:border-[var(--site-accent)]/35"
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <p className="text-[12.5px] font-semibold">{option.title}</p>
                      <span className={`flex h-4 w-4 items-center justify-center rounded-full border ${duration === option.id ? "border-[var(--site-accent)] bg-[var(--site-accent)] text-[var(--site-on-accent)]" : "border-border"}`}>
                        {duration === option.id ? <Check className="h-2.5 w-2.5" strokeWidth={3} /> : null}
                      </span>
                    </div>
                    <p className="mt-1 text-[11px] text-muted-foreground">{option.hours} · {option.time}</p>
                    <p className="mt-2 text-[12px] font-medium">{option.fee}</p>
                    <p className="text-[9.5px] text-muted-foreground">{option.note} fee</p>
                  </button>
                ))}
                <button
                  type="button"
                  onClick={() => setDuration("custom")}
                  className={`rounded-xl border p-3.5 text-left transition-colors ${
                    duration === "custom" ? "border-[var(--site-accent)] bg-[var(--site-accent)]/5" : "border-border hover:border-[var(--site-accent)]/35"
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <p className="text-[12.5px] font-semibold">Custom</p>
                    <span className={`flex h-4 w-4 items-center justify-center rounded-full border ${duration === "custom" ? "border-[var(--site-accent)] bg-[var(--site-accent)] text-[var(--site-on-accent)]" : "border-border"}`}>
                      {duration === "custom" ? <Check className="h-2.5 w-2.5" strokeWidth={3} /> : null}
                    </span>
                  </div>
                  <p className="mt-1 text-[11px] text-muted-foreground">More than 8 hours</p>
                  <p className="mt-2 text-[12px] font-medium">Quoted after scoping</p>
                  <p className="text-[9.5px] text-muted-foreground">Paid service</p>
                </button>
              </div>

              {duration === "custom" ? (
                <div className="mt-3 flex flex-wrap items-center gap-3 rounded-xl border border-[var(--site-gold)]/35 bg-[var(--site-gold)]/6 px-3.5 py-3">
                  <label htmlFor="custom-hours" className="text-[11px] font-medium">How many hours?</label>
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => setCustomHours((value) => Math.max(9, value - 1))}
                      className="h-7 w-7 rounded-md border border-border bg-card text-[13px]"
                      aria-label="Reduce hours"
                    >
                      −
                    </button>
                    <input
                      id="custom-hours"
                      type="number"
                      min={9}
                      max={12}
                      value={customHours}
                      onChange={(event) => {
                        const next = Number(event.target.value);
                        setCustomHours(Number.isFinite(next) ? Math.min(12, Math.max(9, Math.round(next))) : 9);
                      }}
                      className="h-7 w-14 rounded-md border border-border bg-card text-center text-[12px] outline-none focus:border-[var(--site-accent)]/50"
                    />
                    <button
                      type="button"
                      onClick={() => setCustomHours((value) => Math.min(12, value + 1))}
                      className="h-7 w-7 rounded-md border border-border bg-card text-[13px]"
                      aria-label="Add hours"
                    >
                      +
                    </button>
                  </div>
                  <span className="text-[10.5px] text-muted-foreground">
                    {`09:00–${endTime("custom", customHours)} EAT · fee quoted before confirmation`}
                  </span>
                </div>
              ) : null}
            </section>

            <section className="rounded-2xl border border-border bg-card p-5 sm:p-6">
              <div className="flex items-center gap-2.5">
                <span className="flex h-7 w-7 items-center justify-center rounded-full bg-[var(--site-accent)] text-[11px] font-semibold text-[var(--site-on-accent)]">3</span>
                <h2 className="text-[15px] font-semibold">Tell us about the session</h2>
              </div>
              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                <Field label="Your name" htmlFor="booking-name">
                  <input
                    id="booking-name"
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                    autoComplete="name"
                    maxLength={120}
                    required
                    className={inputClass}
                    placeholder="Amina Mwakyusa"
                  />
                </Field>
                <Field label="Work email" htmlFor="booking-email">
                  <input
                    id="booking-email"
                    type="email"
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    autoComplete="email"
                    maxLength={200}
                    required
                    className={inputClass}
                    placeholder="amina@company.co.tz"
                  />
                </Field>
                <Field label="Organisation" htmlFor="booking-org">
                  <input
                    id="booking-org"
                    value={organization}
                    onChange={(event) => setOrganization(event.target.value)}
                    autoComplete="organization"
                    maxLength={160}
                    required
                    className={inputClass}
                    placeholder="Company, group or public body"
                  />
                </Field>
                <Field label="Use case" htmlFor="booking-use-case">
                  <select
                    id="booking-use-case"
                    value={useCase}
                    onChange={(event) => setUseCase(event.target.value)}
                    className={inputClass}
                  >
                    {BOOKING_USE_CASES.map((option) => (
                      <option key={option} value={option}>{option}</option>
                    ))}
                  </select>
                </Field>
              </div>
              <div className="mt-3">
                <Field label="What should we prepare for?" htmlFor="booking-details" optional>
                  <textarea
                    id="booking-details"
                    value={details}
                    onChange={(event) => setDetails(event.target.value)}
                    rows={4}
                    maxLength={2000}
                    className={`${inputClass} resize-none`}
                    placeholder="Current journey, volume, systems involved, the decision you need to make."
                  />
                </Field>
              </div>

              <div className="mt-4 space-y-2.5">
                <label className="flex cursor-pointer items-start gap-2.5 rounded-lg border border-[var(--site-gold)]/40 bg-[var(--site-gold)]/8 px-3 py-2.5">
                  <input
                    type="checkbox"
                    checked={acknowledged}
                    onChange={(event) => setAcknowledged(event.target.checked)}
                    className="mt-0.5 accent-[var(--site-accent)]"
                    required
                  />
                  <span className="text-[11.5px] leading-relaxed text-[#6d5117]">
                    <span className="font-semibold">I understand the consultation is a paid service.</span> The
                    indicative fee is confirmed with me before the session, and this form does not charge anything.
                  </span>
                </label>
                <label className="flex cursor-pointer items-start gap-2.5 px-1 text-[11px] leading-relaxed text-muted-foreground">
                  <input
                    type="checkbox"
                    checked={acceptedTerms}
                    onChange={(event) => setAcceptedTerms(event.target.checked)}
                    className="mt-0.5 accent-[var(--site-accent)]"
                    required
                  />
                  <span>
                    I agree to be contacted about this request, understand my name, email and organisation are stored to
                    review it, and confirm I am not submitting customer data.
                  </span>
                </label>
              </div>

              <div className="sr-only" aria-hidden="true">
                <label htmlFor="booking-website">Website</label>
                <input
                  id="booking-website"
                  tabIndex={-1}
                  autoComplete="off"
                  value={website}
                  onChange={(event) => setWebsite(event.target.value)}
                />
              </div>

              {error ? (
                <div role="alert" className="mt-3 rounded-lg border border-red-500/25 bg-red-500/6 px-3.5 py-2.5 text-[11.5px] leading-relaxed text-red-700">
                  {error}
                </div>
              ) : null}

              <div className="mt-4 flex flex-wrap items-center gap-3">
                <button
                  type="submit"
                  disabled={!formReady || submitting}
                  className="inline-flex items-center gap-2 rounded-full bg-[var(--site-accent)] px-6 py-3 text-[12.5px] font-semibold text-[var(--site-on-accent)] transition-transform enabled:hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <CalendarDays className="h-4 w-4" />}
                  {submitting ? "Sending request…" : "Request this consultation"}
                </button>
                <p className="text-[10px] leading-relaxed text-muted-foreground">
                  Paid service · quote confirmed before the session · no payment taken here
                </p>
              </div>
            </section>
          </form>

          <aside className="lg:sticky lg:top-24">
            <div className="rounded-2xl border border-border bg-card p-5">
              <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Your request</p>
              <p className="font-display mt-2 text-[22px] leading-tight">Working session</p>
              <div className="mt-4 space-y-2.5 text-[11.5px]">
                <SummaryRow icon={CalendarDays} label="Day" value={formatLong(selectedDate)} />
                <SummaryRow icon={Clock3} label="Time" value={`09:00–${endTime(duration, customHours)} EAT`} />
                <SummaryRow icon={Sparkles} label="Length" value={durationLabel(duration, customHours)} />
                <SummaryRow icon={Banknote} label="Fee" value={feeLabel(duration)} />
              </div>

              <div className="mt-4 rounded-xl border border-[var(--site-gold)]/40 bg-[var(--site-gold)]/8 p-3">
                <p className="flex items-center gap-1.5 text-[11px] font-semibold text-[#6d5117]">
                  <Banknote className="h-3.5 w-3.5" /> Paid consultation
                </p>
                <p className="mt-1 text-[10.5px] leading-relaxed text-[#7a5b1c]/90">
                  Fees are agreed before the session. The 4h and 8h figures are indicative; longer sessions are quoted
                  after scoping. Submitting this form does not charge you.
                </p>
              </div>

              <ol className="mt-4 space-y-2 border-t border-border/70 pt-3 text-[10.5px] leading-relaxed text-muted-foreground">
                <li className="flex gap-2"><span className="font-mono text-[9px] text-[var(--site-gold)]">01</span> We check the slot and follow up with you.</li>
                <li className="flex gap-2"><span className="font-mono text-[9px] text-[var(--site-gold)]">02</span> You confirm the quote and scope.</li>
                <li className="flex gap-2"><span className="font-mono text-[9px] text-[var(--site-gold)]">03</span> We run the session and send the outline.</li>
              </ol>
              <p className="mt-3 flex items-start gap-1.5 text-[9.5px] leading-relaxed text-muted-foreground">
                <ShieldCheck className="mt-0.5 h-3 w-3 shrink-0" />
                Do not include customer names, account numbers or documents in this form.
              </p>
            </div>

            <div className="mt-3 rounded-xl border border-border/80 bg-[var(--site-bg)]/60 p-4">
              <p className="text-[11px] font-semibold">Prefer to explore first?</p>
              <p className="mt-1 text-[10.5px] leading-relaxed text-muted-foreground">
                The self-guided demo is free and takes about four minutes.
              </p>
              <button
                type="button"
                onClick={() => navigate("/demo/")}
                className="mt-2 inline-flex items-center gap-1 text-[10.5px] font-semibold text-[var(--site-accent)]"
              >
                Open the demo <ArrowRight className="h-3 w-3" />
              </button>
            </div>

            <p className="mt-3 flex items-center justify-center gap-1.5 text-[9.5px] text-muted-foreground">
              <Mail className="h-3 w-3" /> Requests are reviewed on business days
            </p>
          </aside>
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}

const inputClass =
  "mt-1 w-full rounded-lg border border-border bg-[var(--site-bg)]/50 px-3 py-2 text-[12.5px] outline-none focus:border-[var(--site-accent)]/50";

function Field({
  label,
  htmlFor,
  children,
  optional = false,
}: {
  label: string;
  htmlFor: string;
  children: ReactNode;
  optional?: boolean;
}) {
  return (
    <div>
      <label htmlFor={htmlFor} className="text-[11px] font-medium">
        {label} {optional ? <span className="font-normal text-muted-foreground">(optional)</span> : null}
      </label>
      {children}
    </div>
  );
}

function Detail({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <p className="text-[9.5px] uppercase tracking-[0.1em] text-muted-foreground">{label}</p>
      <p className={`mt-0.5 text-[12px] ${mono ? "font-mono" : "font-medium"}`}>{value}</p>
    </div>
  );
}

function SummaryRow({ icon: Icon, label, value }: { icon: typeof CalendarDays; label: string; value: string }) {
  return (
    <div className="flex items-start gap-2">
      <Icon className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--site-accent)]" />
      <div>
        <p className="text-[9.5px] uppercase tracking-[0.1em] text-muted-foreground">{label}</p>
        <p className="font-medium leading-snug">{value}</p>
      </div>
    </div>
  );
}
