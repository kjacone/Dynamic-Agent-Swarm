import {
  Activity,
  Bot,
  Boxes,
  Database,
  FlaskConical,
  Gauge,
  GraduationCap,
  KeyRound,
  LibraryBig,
  Settings as SettingsIcon,
  Sparkles,
  Users,
} from "lucide-react";

export const NAV = [
  { id: "overview", label: "Overview", icon: Gauge },
  { id: "agents", label: "Agents", icon: Bot },
  { id: "subagents", label: "Subagents", icon: Users },
  { id: "prompts", label: "Prompts", icon: Sparkles },
  { id: "tools", label: "Tools", icon: Boxes },
  { id: "knowledge", label: "Knowledge", icon: LibraryBig },
  { id: "models", label: "Models", icon: Database },
  { id: "training", label: "Training", icon: GraduationCap },
  { id: "evals", label: "Evaluations", icon: FlaskConical },
  { id: "observability", label: "Observability", icon: Activity },
  { id: "settings", label: "Settings", icon: SettingsIcon },
] as const;

export type TabId = (typeof NAV)[number]["id"];
export type TabIcon = typeof KeyRound;