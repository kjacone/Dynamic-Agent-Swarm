import type { BundleId, VoiceCard, VoiceLocale } from "@/lib/mnoVoice";

export type VoiceCardResult =
  | { ok: true; card: VoiceCard; spoken: string; receipt: Record<string, unknown> }
  | { ok: false; error: string };

export const VOICE_BUNDLES: Record<BundleId, { size: string; price: string; en: string; sw: string }> = {
  "1.5gb": { size: "1.5 GB", price: "TZS 3,000", en: "3 days", sw: "siku 3" },
  "4gb": { size: "4 GB", price: "TZS 7,500", en: "7 days", sw: "siku 7" },
  "10gb": { size: "10 GB", price: "TZS 15,000", en: "30 days", sw: "siku 30" },
};

export function pickVoiceText(locale: VoiceLocale, en: string, sw: string) {
  return locale === "sw" ? sw : en;
}

export function balanceCard(locale: VoiceLocale): { card: VoiceCard; spoken: string } {
  return {
    spoken: pickVoiceText(
      locale,
      "Your airtime balance is TZS 4,250. You have 1.8 GB of data left and 12 SMS. Your bundle runs until 21 November 2026.",
      "Salio lako ni TZS 4,250. Umebakiza data ya GB 1.8 na SMS 12. Pakiti yako inaisha tarehe 21 Novemba 2026.",
    ),
    card: {
      kind: "balance",
      title: pickVoiceText(locale, "Prepaid balance", "Salio la simu"),
      rows: [
        { label: pickVoiceText(locale, "Airtime", "Hewa"), value: "TZS 4,250" },
        { label: pickVoiceText(locale, "Data", "Data"), value: pickVoiceText(locale, "1.8 GB left", "GB 1.8 zimebaki") },
        { label: pickVoiceText(locale, "SMS", "SMS"), value: "12" },
        { label: pickVoiceText(locale, "Bundle", "Pakiti"), value: pickVoiceText(locale, "valid until 21 Nov 2026", "inaisha 21 Nov 2026") },
      ],
      tone: "green",
    },
  };
}

export function bundlesCard(locale: VoiceLocale): { card: VoiceCard; spoken: string } {
  return {
    spoken: pickVoiceText(
      locale,
      "You can add 1.5 GB for TZS 3,000 for 3 days, 4 GB for TZS 7,500 for 7 days, or 10 GB for TZS 15,000 for 30 days. Which one would you like?",
      "Unaweza kuongeza GB 1.5 kwa TZS 3,000 kwa siku 3, GB 4 kwa TZS 7,500 kwa siku 7, au GB 10 kwa TZS 15,000 kwa siku 30. Ungependa ipi?",
    ),
    card: {
      kind: "bundles",
      title: pickVoiceText(locale, "Data bundles", "Pakiti za data"),
      rows: [
        { label: "1.5 GB", value: pickVoiceText(locale, "TZS 3,000 · 3 days", "TZS 3,000 · siku 3") },
        { label: "4 GB", value: pickVoiceText(locale, "TZS 7,500 · 7 days", "TZS 7,500 · siku 7") },
        { label: "10 GB", value: pickVoiceText(locale, "TZS 15,000 · 30 days", "TZS 15,000 · siku 30") },
      ],
      note: pickVoiceText(locale, "Say the size you want and I'll add it.", "Sema ukubwa unaotaka nami nitaongeza."),
    },
  };
}

export function bundleBoughtCard(locale: VoiceLocale, id: BundleId): { card: VoiceCard; spoken: string } {
  const bundle = VOICE_BUNDLES[id];
  return {
    spoken: pickVoiceText(
      locale,
      `Done. ${bundle.size} is active on +255 754 000 111 and ${bundle.price} has been taken from your airtime. It runs for ${bundle.en}.`,
      `Imekamilika. ${bundle.size} imewekwa kwenye +255 754 000 111 na ${bundle.price} imekatwa kwenye salio lako. Inadumu kwa ${bundle.sw}.`,
    ),
    card: {
      kind: "bundle_bought",
      title: pickVoiceText(locale, "Bundle active", "Pakiti imewekwa"),
      rows: [
        { label: pickVoiceText(locale, "Bundle", "Pakiti"), value: bundle.size },
        { label: pickVoiceText(locale, "Paid", "Malipo"), value: bundle.price },
        { label: pickVoiceText(locale, "Valid for", "Inadumu"), value: pickVoiceText(locale, bundle.en, bundle.sw) },
      ],
      note: pickVoiceText(locale, "Receipt SMS sent to the same number.", "SMS ya risiti imetumwa kwenye namba hiyo."),
      tone: "green",
    },
  };
}

export function simSwapCard(locale: VoiceLocale): { card: VoiceCard; spoken: string } {
  return {
    spoken: pickVoiceText(
      locale,
      "A SIM swap moves your line, so I can't finish it on this call alone. I've queued case SIM-7741 with the identity check on your registered number. A care agent will call you within 30 minutes to verify and approve.",
      "Kubadilisha SIM kunahamisha laini yako, kwa hiyo siwezi kukamilisha kwenye simu hii pekee. Nimeweka kesi SIM-7741 pamoja na ukaguzi wa kitambulisho kwenye namba yako iliyosajiliwa. Msaidizi wa huduma atakupigia ndani ya dakika 30 kuthibitisha na kuidhinisha.",
    ),
    card: {
      kind: "sim_swap",
      title: pickVoiceText(locale, "SIM swap · approval needed", "Kubadilisha SIM · inahitaji idhini"),
      rows: [
        { label: pickVoiceText(locale, "Case", "Kesi"), value: "SIM-7741" },
        { label: pickVoiceText(locale, "Status", "Hali"), value: pickVoiceText(locale, "waiting for a care agent", "inasubiri msaidizi") },
        { label: pickVoiceText(locale, "Check", "Ukaguzi"), value: pickVoiceText(locale, "ID + registered number", "Kitambulisho + namba iliyosajiliwa") },
      ],
      note: pickVoiceText(locale, "The line stays active until a human approves the move.", "Laini inaendelea kutumika hadi mtu aidhinishe uhamisho."),
      tone: "amber",
    },
  };
}

export function networkCard(locale: VoiceLocale): { card: VoiceCard; spoken: string } {
  return {
    spoken: pickVoiceText(
      locale,
      "I ran a check on your line. There is no outage in your area and your data session has been reset. Restart your phone, then try again. If it is still slow, I can pass you to a care agent.",
      "Nimekagua laini yako. Hakuna hitilafu ya mtandao eneo lako na kikao cha data kimeanzishwa upya. Washa simu yako upya kisha ujaribu tena. Kama bado ni polepole, ninaweza kukuunganisha na msaidizi wa huduma.",
    ),
    card: {
      kind: "network",
      title: pickVoiceText(locale, "Line check", "Ukaguzi wa laini"),
      rows: [
        { label: pickVoiceText(locale, "Network", "Mtandao"), value: "4G · Dar es Salaam" },
        { label: pickVoiceText(locale, "Outage", "Hitilafu"), value: pickVoiceText(locale, "none detected", "hakuna") },
        { label: pickVoiceText(locale, "Session", "Kikao"), value: pickVoiceText(locale, "reset just now", "imeanzishwa upya sasa") },
      ],
      note: pickVoiceText(locale, "If it persists, say 'talk to a human'.", "Kama inaendelea, sema 'msaidizi'."),
      tone: "green",
    },
  };
}

export function creditCard(locale: VoiceLocale): { card: VoiceCard; spoken: string } {
  return {
    spoken: pickVoiceText(
      locale,
      "A credit above TZS 5,000 needs a human decision. I've queued case CR-2290 for TZS 12,000 with the duplicate-charge evidence. An agent will review it today and message you.",
      "Fidia inayozidi TZS 5,000 inahitaji uamuzi wa mtu. Nimeweka kesi CR-2290 ya TZS 12,000 pamoja na ushahidi wa malipo ya mara mbili. Msaidizi ataikagua leo na kukutumia ujumbe.",
    ),
    card: {
      kind: "credit",
      title: pickVoiceText(locale, "Credit request · approval needed", "Ombi la fidia · inahitaji idhini"),
      rows: [
        { label: pickVoiceText(locale, "Case", "Kesi"), value: "CR-2290" },
        { label: pickVoiceText(locale, "Amount", "Kiasi"), value: "TZS 12,000" },
        { label: pickVoiceText(locale, "Rule", "Kanuni"), value: pickVoiceText(locale, "above the agent limit", "juu ya kikomo cha wakala") },
      ],
      note: pickVoiceText(locale, "You keep the thread if we move to WhatsApp.", "Mazungumzo yanaendelea hata tukihamia WhatsApp."),
      tone: "amber",
    },
  };
}

export function transferCard(locale: VoiceLocale): { card: VoiceCard; spoken: string } {
  return {
    spoken: pickVoiceText(
      locale,
      "Connecting you to a care agent. You are second in the queue, about three minutes. I'm passing the whole thread so you won't repeat yourself.",
      "Ninakukungisha na msaidizi wa huduma. Uko nafasi ya pili kwenye foleni, takriban dakika tatu. Napitisha mazungumzo yote ili usirudie maelezo.",
    ),
    card: {
      kind: "transfer",
      title: pickVoiceText(locale, "Handing over", "Kukabidhi"),
      rows: [
        { label: pickVoiceText(locale, "Queue", "Foleni"), value: "2" },
        { label: pickVoiceText(locale, "Wait", "Muda"), value: pickVoiceText(locale, "about 3 minutes", "dakika 3 hivi") },
        { label: pickVoiceText(locale, "Context", "Muktadha"), value: pickVoiceText(locale, "full thread passed", "mazungumzo yote yamepitishwa") },
      ],
      note: pickVoiceText(locale, "The agent sees your balance check and the SIM-swap case.", "Msaidizi anaona ukaguzi wa salio na kesi ya SIM."),
    },
  };
}

export function resolveVoiceCard(
  kind: unknown,
  bundle: unknown,
  locale: VoiceLocale,
): VoiceCardResult {
  const receipt = (spoken: string, extra: Record<string, unknown> = {}) =>
    ({ shown: true, kind, spoken, locale, ...extra }) as Record<string, unknown>;

  switch (kind) {
    case "balance": {
      const { card, spoken } = balanceCard(locale);
      return { ok: true, card, spoken, receipt: receipt(spoken) };
    }
    case "bundles": {
      const { card, spoken } = bundlesCard(locale);
      return { ok: true, card, spoken, receipt: receipt(spoken) };
    }
    case "bundle_bought": {
      if (typeof bundle !== "string" || !(bundle in VOICE_BUNDLES)) {
        return { ok: false, error: 'kind "bundle_bought" needs bundle "1.5gb", "4gb" or "10gb"' };
      }
      const { card, spoken } = bundleBoughtCard(locale, bundle as BundleId);
      return { ok: true, card, spoken, receipt: receipt(spoken, { bundle }) };
    }
    case "sim_swap": {
      const { card, spoken } = simSwapCard(locale);
      return { ok: true, card, spoken, receipt: receipt(spoken) };
    }
    case "network": {
      const { card, spoken } = networkCard(locale);
      return { ok: true, card, spoken, receipt: receipt(spoken) };
    }
    case "credit": {
      const { card, spoken } = creditCard(locale);
      return { ok: true, card, spoken, receipt: receipt(spoken) };
    }
    case "transfer": {
      const { card, spoken } = transferCard(locale);
      return { ok: true, card, spoken, receipt: receipt(spoken) };
    }
    default:
      return {
        ok: false,
        error: `unknown kind "${String(kind)}"; expected balance, bundles, bundle_bought, sim_swap, network, credit or transfer`,
      };
  }
}
