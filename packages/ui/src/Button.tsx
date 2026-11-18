import type { ButtonHTMLAttributes } from "react";
import { cn } from "./cn.js";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
export type ButtonSize = "sm" | "md" | "lg";

const VARIANT_CLASSES: Record<ButtonVariant, string> = {
  primary:
    "bg-[var(--accent)] text-[var(--accent-fg)] hover:opacity-90 shadow-sm focus-visible:ring-2 focus-visible:ring-[var(--accent)]",
  secondary:
    "border border-[var(--border)] bg-[var(--surface-elevated)] text-[var(--fg)] hover:bg-[var(--surface-hover)] focus-visible:ring-2 focus-visible:ring-[var(--accent)]",
  ghost:
    "text-[var(--fg-muted)] hover:bg-[var(--surface-hover)] hover:text-[var(--fg)] focus-visible:ring-2 focus-visible:ring-[var(--accent)]",
  danger:
    "bg-rose-600 text-white hover:bg-rose-500 shadow-sm focus-visible:ring-2 focus-visible:ring-rose-500",
};

const SIZE_CLASSES: Record<ButtonSize, string> = {
  sm: "h-8 px-3 text-xs",
  md: "h-9 px-4 text-sm",
  lg: "h-10 px-5 text-sm",
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
}

export function Button({
  className,
  variant = "primary",
  size = "md",
  loading = false,
  disabled,
  children,
  type = "button",
  ...props
}: ButtonProps) {
  return (
    <button
      type={type}
      disabled={disabled || loading}
      className={cn(
        "inline-flex items-center justify-center gap-2 rounded-lg font-medium transition-colors focus-visible:outline-none focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg)] disabled:pointer-events-none disabled:opacity-50 cursor-pointer",
        VARIANT_CLASSES[variant],
        SIZE_CLASSES[size],
        className,
      )}
      {...props}
    >
      {loading && (
        <span
          aria-hidden="true"
          className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent"
        />
      )}
      {children}
    </button>
  );
}
