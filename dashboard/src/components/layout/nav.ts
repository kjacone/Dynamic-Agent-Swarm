import {
  Activity,
  Bot,
  Boxes,
  ClipboardCheck,
  Database,
  FlaskConical,
  Gauge,
  GraduationCap,
  KeyRound,
  LibraryBig,
  Package,
  Plug,
  ScrollText,
  Settings as SettingsIcon,
  ShieldCheck,
  Sparkles,
  Users,
  Workflow,
} from "lucide-react";

/** section "platform" = builder tools (admin-token / platform_admin); "enterprise" = governed operations (RBAC per `perm`). */
export const NAV = [
  { id: "overview", label: "Overview", icon: Gauge, section: "products" , perm: "overview:read"},
  { id: "solutions", label: "Solutions", icon: Package, section: "products", perm: "solutions:read" },
  { id: "agents", label: "Agents", icon: Bot, section: "platform" },
  { id: "subagents", label: "Subagents", icon: Users, section: "platform" },
  { id: "prompts", label: "Prompts", icon: Sparkles, section: "platform" },
  { id: "tools", label: "Tools", icon: Boxes, section: "platform" },
  { id: "knowledge", label: "Knowledge", icon: LibraryBig, section: "platform" },
  { id: "models", label: "Models", icon: Database, section: "platform" },
  { id: "training", label: "Training", icon: GraduationCap, section: "platform" },
  { id: "evals", label: "Evaluations", icon: FlaskConical, section: "platform" },
  { id: "observability", label: "Observability", icon: Activity, section: "platform" },
  { id: "settings", label: "Settings", icon: SettingsIcon, section: "platform" },
  { id: "approvals", label: "Approvals", icon: ClipboardCheck, section: "enterprise", perm: "approvals:read" },
  { id: "workflows", label: "Workflows", icon: Workflow, section: "enterprise", perm: "workflows:read" },
  { id: "connectors", label: "Connectors", icon: Plug, section: "enterprise", perm: "connectors:read" },
  { id: "audit", label: "Audit trail", icon: ScrollText, section: "enterprise", perm: "audit:read" },
  { id: "governance", label: "Governance", icon: ShieldCheck, section: "enterprise", perm: "compliance:read" },
] as const;

export type NavItem = (typeof NAV)[number];
export type TabId = NavItem["id"];
export type TabIcon = typeof KeyRound;
