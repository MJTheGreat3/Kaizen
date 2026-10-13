import type { ReactNode } from "react";
import type { Icon } from "@phosphor-icons/react";
import { motion } from "motion/react";

import { ModuleTile, Wash } from "@/components/visual";
import { rise, stagger } from "@/lib/motion";
import { cn } from "@/lib/utils";

export function PageHeader({
  title,
  description,
  actions,
  icon,
  hue,
  className,
}: {
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
  icon?: Icon;
  hue?: string;
  className?: string;
}) {
  return (
    <motion.header variants={rise} className={cn("flex flex-wrap items-end justify-between gap-4", className)}>
      <div className="flex items-center gap-4">
        {icon && hue ? <ModuleTile icon={icon} hue={hue} size="lg" className="hidden sm:grid" /> : null}
        <div className="grid gap-1">
          <h1 className="text-[30px] font-semibold leading-[1.1] tracking-[-0.025em] md:text-[34px]">{title}</h1>
          {description ? <p className="max-w-[60ch] text-[15px] text-muted-foreground">{description}</p> : null}
        </div>
      </div>
      {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
    </motion.header>
  );
}

/** Page container: centred column, optional colour wash, staggered entrance. */
export function Page({ children, className, hue }: { children: ReactNode; className?: string; hue?: string }) {
  return (
    <div className="relative">
      {hue ? <Wash hue={hue} /> : null}
      <motion.div
        variants={stagger}
        initial="hidden"
        animate="show"
        className={cn("relative mx-auto w-full max-w-[960px] px-4 py-6 md:px-10 md:py-12", className)}
      >
        {children}
      </motion.div>
    </div>
  );
}
