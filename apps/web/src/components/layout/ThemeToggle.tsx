import { Monitor, Moon, Sun } from "lucide-react";
import { useTheme, type ThemeMode } from "../../stores/theme.js";

const OPTIONS: Array<{ value: ThemeMode; label: string; Icon: typeof Sun }> = [
  { value: "light", label: "Light", Icon: Sun },
  { value: "dark", label: "Dark", Icon: Moon },
  { value: "system", label: "System", Icon: Monitor },
];

export function ThemeToggle() {
  const { theme, setTheme } = useTheme();

  return (
    <div
      role="group"
      aria-label="Theme selection"
      className="inline-flex items-center rounded-lg border border-[var(--border)] bg-[var(--surface-elevated)] p-0.5"
    >
      {OPTIONS.map(({ value, label, Icon }) => {
        const active = theme === value;
        return (
          <button
            key={value}
            type="button"
            title={`${label} theme`}
            aria-label={`${label} theme`}
            aria-pressed={active}
            onClick={() => setTheme(value)}
            className={`inline-flex h-7 w-7 items-center justify-center rounded-md text-xs transition-colors cursor-pointer ${
              active
                ? "bg-[var(--surface)] text-[var(--fg)] shadow-xs"
                : "text-[var(--fg-muted)] hover:text-[var(--fg)]"
            }`}
          >
            <Icon className="h-3.5 w-3.5" />
          </button>
        );
      })}
    </div>
  );
}
