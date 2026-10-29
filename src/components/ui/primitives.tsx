import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

/* shadcn/ui-style primitives, adapted to the AgentArena dark theme. */

export const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-lg text-sm font-medium transition-colors disabled:pointer-events-none disabled:opacity-50 [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        primary:
          "bg-gradient-to-r from-violet to-electric-deep text-white shadow-[0_0_0_1px_rgb(139_92_246/0.4),0_8px_24px_-8px_rgb(139_92_246/0.6)] hover:brightness-110",
        secondary: "bg-ink-800 text-ink-100 ring-1 ring-ink-600 hover:bg-ink-700",
        ghost: "text-ink-300 hover:bg-ink-800 hover:text-ink-100",
        danger: "bg-danger/10 text-danger ring-1 ring-danger/30 hover:bg-danger/20",
      },
      size: { sm: "h-8 px-3", md: "h-10 px-4", lg: "h-11 px-6 text-base" },
    },
    defaultVariants: { variant: "secondary", size: "md" },
  },
);

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(({ className, variant, size, asChild, ...props }, ref) => {
  const Comp = asChild ? Slot : "button";
  return <Comp ref={ref} className={cn(buttonVariants({ variant, size }), className)} {...props} />;
});
Button.displayName = "Button";

export function Card({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("rounded-xl border border-ink-700/80 bg-ink-900/80 backdrop-blur-sm", className)} {...props} />;
}

export function CardHeader({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("flex items-start justify-between gap-4 border-b border-ink-700/60 px-5 py-4", className)} {...props} />;
}

export function CardTitle({ className, ...props }: React.HTMLAttributes<HTMLHeadingElement>) {
  return <h2 className={cn("text-sm font-semibold tracking-tight text-ink-100", className)} {...props} />;
}

export function CardDescription({ className, ...props }: React.HTMLAttributes<HTMLParagraphElement>) {
  return <p className={cn("mt-0.5 text-xs text-ink-400", className)} {...props} />;
}

export function CardContent({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("px-5 py-4", className)} {...props} />;
}

const badgeVariants = cva("inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset", {
  variants: {
    tone: {
      neutral: "bg-ink-800 text-ink-300 ring-ink-600",
      violet: "bg-violet/10 text-violet-soft ring-violet/30",
      blue: "bg-electric/10 text-electric ring-electric/30",
      success: "bg-success/10 text-success ring-success/30",
      warning: "bg-warning/10 text-warning ring-warning/30",
      danger: "bg-danger/10 text-danger ring-danger/30",
    },
  },
  defaultVariants: { tone: "neutral" },
});

export function Badge({ className, tone, ...props }: React.HTMLAttributes<HTMLSpanElement> & VariantProps<typeof badgeVariants>) {
  return <span className={cn(badgeVariants({ tone }), className)} {...props} />;
}

const fieldBase =
  "w-full rounded-lg border border-ink-600 bg-ink-850 px-3 text-sm text-ink-100 placeholder:text-ink-500 transition-colors hover:border-ink-500 focus:border-electric focus:outline-none disabled:opacity-60";

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(({ className, ...props }, ref) => (
  <input ref={ref} className={cn(fieldBase, "h-10", className)} {...props} />
));
Input.displayName = "Input";

export const Textarea = React.forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(({ className, ...props }, ref) => (
  <textarea ref={ref} className={cn(fieldBase, "min-h-24 py-2 leading-relaxed", className)} {...props} />
));
Textarea.displayName = "Textarea";

export const Select = React.forwardRef<HTMLSelectElement, React.SelectHTMLAttributes<HTMLSelectElement>>(({ className, ...props }, ref) => (
  <select ref={ref} className={cn(fieldBase, "h-10 appearance-none bg-[length:16px] bg-[right_10px_center] bg-no-repeat pr-9", className)} style={{ backgroundImage: "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 24 24' stroke='%23737a94' stroke-width='2'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E\")" }} {...props} />
));
Select.displayName = "Select";

export function Label({ className, ...props }: React.LabelHTMLAttributes<HTMLLabelElement>) {
  return <label className={cn("mb-1.5 block text-xs font-medium text-ink-300", className)} {...props} />;
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn("animate-pulse-soft rounded-md bg-ink-800", className)} aria-hidden />;
}

export function EmptyState({ icon, title, description, action }: { icon?: React.ReactNode; title: string; description?: string; action?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-14 text-center">
      {icon && <div className="mb-3 rounded-xl bg-ink-800 p-3 text-ink-400 ring-1 ring-ink-700">{icon}</div>}
      <p className="text-sm font-medium text-ink-200">{title}</p>
      {description && <p className="mt-1 max-w-sm text-xs text-ink-400">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function Callout({ tone = "neutral", icon, children, className }: { tone?: "neutral" | "warning" | "danger" | "info"; icon?: React.ReactNode; children: React.ReactNode; className?: string }) {
  const styles = {
    neutral: "border-ink-600 bg-ink-850 text-ink-300",
    warning: "border-warning/30 bg-warning/5 text-warning",
    danger: "border-danger/30 bg-danger/5 text-danger",
    info: "border-electric/30 bg-electric/5 text-electric",
  }[tone];
  return (
    <div role={tone === "danger" ? "alert" : "note"} className={cn("flex gap-2.5 rounded-lg border px-3.5 py-2.5 text-xs leading-relaxed", styles, className)}>
      {icon && <span className="mt-0.5 shrink-0 [&_svg]:size-3.5">{icon}</span>}
      <div className="min-w-0">{children}</div>
    </div>
  );
}
