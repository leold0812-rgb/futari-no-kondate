import type { HTMLAttributes } from "react";
import styles from "./card.module.css";

type CardProps = HTMLAttributes<HTMLElement> & { as?: "section" | "div" | "article" | "li" };

export function Card({ as: Tag = "section", className, ...rest }: CardProps) {
  return <Tag className={[styles.card, className].filter(Boolean).join(" ")} {...rest} />;
}
