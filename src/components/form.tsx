/** Shared dark form controls. */

export const inputClass =
  "block w-full rounded-lg border border-line bg-raised px-3 py-2.5 text-sm text-fg placeholder:text-fg-muted focus:border-teal focus:outline-none focus:ring-2 focus:ring-line-focus disabled:opacity-50";

export function Field({ label, hint, htmlFor, children }: { label: string; hint?: string; htmlFor?: string; children: React.ReactNode }) {
  return (
    <div>
      <label htmlFor={htmlFor} className="block text-xs font-medium uppercase tracking-wider text-fg-secondary">
        {label}
      </label>
      <div className="mt-2">{children}</div>
      {hint && <p className="mt-1.5 text-xs text-fg-muted">{hint}</p>}
    </div>
  );
}

export function Button({
  variant = "primary",
  className = "",
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "secondary" | "danger" }) {
  const styles = {
    primary: "bg-teal text-page hover:bg-teal-200",
    secondary: "border border-line bg-surface text-fg-secondary hover:border-line-focus hover:text-fg",
    danger: "border border-negative/50 bg-negative/10 text-negative hover:bg-negative/20",
  }[variant];
  return (
    <button
      {...props}
      className={`inline-flex items-center justify-center rounded-lg px-4 py-2.5 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-50 ${styles} ${className}`}
    />
  );
}

export function Notice({ tone, title, children }: { tone: "error" | "warning" | "success" | "info"; title?: string; children: React.ReactNode }) {
  const styles = {
    error: "border-negative/40 bg-negative/10 text-negative",
    warning: "border-line bg-raised text-fg-secondary",
    success: "border-teal-800 bg-teal-950 text-teal-100",
    info: "border-line-focus bg-teal-950/60 text-teal-100",
  }[tone];
  return (
    <div className={`rounded-lg border p-4 text-sm ${styles}`} role={tone === "error" ? "alert" : "status"}>
      {title && <p className="mb-1 font-semibold">{title}</p>}
      {children}
    </div>
  );
}
