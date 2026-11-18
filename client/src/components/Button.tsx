import type { ButtonHTMLAttributes } from "react";
import styles from "./Button.module.css";

type Variant = "primary" | "secondary" | "destructive";

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  small?: boolean;
}

/** The button look as a class string, for a router `Link` that should look like a button. */
export function buttonClass(variant: Variant = "primary", small = false, extra?: string): string {
  return [styles.button, styles[variant], small ? styles.small : "", extra ?? ""]
    .filter(Boolean)
    .join(" ");
}

export function Button({ variant = "primary", small, className, type = "button", ...rest }: Props) {
  return <button type={type} className={buttonClass(variant, small, className)} {...rest} />;
}
