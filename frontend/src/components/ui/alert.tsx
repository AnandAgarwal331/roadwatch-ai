import { cva, type VariantProps } from "class-variance-authority";
import { AlertTriangle, CheckCircle2, Info, XCircle } from "lucide-react";
import * as React from "react";

import { cn } from "@/lib/utils";

const alertVariants = cva(
  "relative flex w-full gap-3 rounded-lg border p-4 text-sm [&>svg]:size-[18px] [&>svg]:shrink-0 [&>svg]:mt-0.5",
  {
    variants: {
      variant: {
        default: "border-border bg-muted/50 text-foreground [&>svg]:text-muted-foreground",
        info: "border-primary/25 bg-primary/5 text-foreground [&>svg]:text-primary",
        success: "border-success/25 bg-success/5 text-foreground [&>svg]:text-success",
        warning: "border-warning/30 bg-warning/5 text-foreground [&>svg]:text-warning",
        destructive: "border-destructive/30 bg-destructive/5 text-foreground [&>svg]:text-destructive",
      },
    },
    defaultVariants: { variant: "default" },
  },
);

const ICONS = {
  default: Info,
  info: Info,
  success: CheckCircle2,
  warning: AlertTriangle,
  destructive: XCircle,
} as const;

export interface AlertProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof alertVariants> {
  title?: string;
  /** Set false when the surrounding layout already supplies an icon. */
  icon?: boolean;
}

function Alert({ className, variant = "default", title, icon = true, children, ...props }: AlertProps) {
  const Icon = ICONS[variant ?? "default"];
  // Errors and warnings must reach assistive tech as they appear.
  const live = variant === "destructive" || variant === "warning";

  return (
    <div
      role={live ? "alert" : "status"}
      className={cn(alertVariants({ variant }), className)}
      {...props}
    >
      {icon ? <Icon aria-hidden="true" /> : null}
      <div className="min-w-0 flex-1 space-y-1">
        {title ? <p className="font-medium leading-snug">{title}</p> : null}
        {children ? <div className="text-muted-foreground [&_p]:leading-relaxed">{children}</div> : null}
      </div>
    </div>
  );
}

export { Alert, alertVariants };
