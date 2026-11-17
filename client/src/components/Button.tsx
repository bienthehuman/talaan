import type { ButtonHTMLAttributes } from "react";

type Variant = "primary" | "secondary" | "destructive";

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  small?: boolean;
}

export function Button({ variant = "primary", small, className, type = "button", ...rest }: Props) {
  const classes = ["btn", `btn--${variant}`, small ? "btn--small" : "", className ?? ""]
    .filter(Boolean)
    .join(" ");
  return <button type={type} className={classes} {...rest} />;
}
