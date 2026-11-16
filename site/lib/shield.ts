import type { DemoGuardrail } from "@/data/demo";

export type ShieldDirection = "input" | "document" | "tool_result";

export type ShieldFinding = {
  label: string;
  phrase: string;
  rule: string;
  action: "block" | "log";
};

export type ShieldVerdict = {
  action: "allow" | "log" | "block";
  findings: ShieldFinding[];
  checked: number;
  score: number;
};

const HEURISTICS: { label: string; pattern: RegExp; rule: string }[] = [
  { label: "Instruction override", pattern: /ignore\s+(all\s+)?(previous|prior|above)\s+(instructions|rules)/i, rule: "prompt-injection-heuristic" },
  { label: "System-prompt disclosure", pattern: /(print|show|reveal|repeat)\s+(your\s+)?(system\s+prompt|hidden\s+instructions)/i, rule: "prompt-injection-heuristic" },
  { label: "Role change", pattern: /(you are now|pretend you are|developer mode|jailbreak|dan mode)/i, rule: "prompt-injection-heuristic" },
  { label: "Approval bypass", pattern: /(skip|bypass|waive)\s+(the\s+)?(approval|checks|policy|verification)/i, rule: "approval-bypass-heuristic" },
  { label: "Data exfiltration", pattern: /(send|forward|email|copy|post)\s+(all\s+)?(the\s+)?(customer|client)\s+(records|list|data)/i, rule: "exfiltration-heuristic" },
  { label: "Fake system turn", pattern: /(\[system\]|<system>|^system:)/im, rule: "prompt-injection-heuristic" },
];

export function evaluateShield(text: string, direction: ShieldDirection, guardrails: DemoGuardrail[]): ShieldVerdict {
  const findings: ShieldFinding[] = [];
  const active = guardrails.filter((guardrail) => guardrail.enabled);
  const haystack = text.toLowerCase();

  for (const guardrail of active) {
    const phrase = guardrail.phrases.find((candidate) => haystack.includes(candidate.toLowerCase()));
    if (phrase) {
      findings.push({
        label: guardrail.title,
        phrase,
        rule: `shield:${guardrail.id}`,
        action: guardrail.action,
      });
    }
  }

  for (const heuristic of HEURISTICS) {
    const match = text.match(heuristic.pattern);
    if (match && !findings.some((finding) => finding.rule === heuristic.rule)) {
      findings.push({
        label: heuristic.label,
        phrase: match[0],
        rule: heuristic.rule,
        action: "block",
      });
    }
  }

  const blocked = findings.some((finding) => finding.action === "block");
  const logged = findings.some((finding) => finding.action === "log");
  const score = blocked ? 0.98 : logged ? 0.72 : direction === "document" ? 0.18 : 0.05;

  return {
    action: blocked ? "block" : logged ? "log" : "allow",
    findings,
    checked: active.length,
    score,
  };
}
