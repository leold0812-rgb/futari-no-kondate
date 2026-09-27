import Link from "next/link";
import type { ButtonHTMLAttributes, ComponentProps } from "react";
import styles from "./button.module.css";

export type ButtonVariant = "primary" | "secondary" | "danger" | "ghost";
export type ButtonSize = "normal" | "large" | "small";

type StyleProps = { variant?: ButtonVariant; size?: ButtonSize; block?: boolean };

export function buttonClassName({ variant = "primary", size = "normal", block = false }: StyleProps, extra?: string) {
  return [
    styles.button,
    styles[variant],
    size === "large" ? styles.large : size === "small" ? styles.small : "",
    block ? styles.block : "",
    extra ?? "",
  ]
    .filter(Boolean)
    .join(" ");
}

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & StyleProps;

export function Button({ variant, size, block, className, type = "button", ...rest }: ButtonProps) {
  return <button type={type} className={buttonClassName({ variant, size, block }, className)} {...rest} />;
}

type LinkButtonProps = ComponentProps<typeof Link> & StyleProps;

export function LinkButton({ variant, size, block, className, ...rest }: LinkButtonProps) {
  return <Link className={buttonClassName({ variant, size, block }, className)} {...rest} />;
}
