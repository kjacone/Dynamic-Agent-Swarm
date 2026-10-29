import { Monitor, Moon, Sun } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useTheme, type ThemeMode } from "@/lib/useTheme";

const ICONS: Record<ThemeMode, typeof Sun> = {
  auto: Monitor,
  light: Sun,
  dark: Moon,
};

const LABELS: Record<ThemeMode, string> = {
  auto: "Auto",
  light: "Light",
  dark: "Dark",
};

export function ThemeToggle() {
  const { mode, toggle } = useTheme();
  const Icon = ICONS[mode];
  const label = LABELS[mode];

  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={toggle}
      title={"Theme: " + label + " (click to cycle)"}
      aria-label={"Theme: " + label}
    >
      <Icon className="h-4 w-4" />
      <span className="ml-2 hidden text-xs sm:inline">{label}</span>
    </Button>
  );
}