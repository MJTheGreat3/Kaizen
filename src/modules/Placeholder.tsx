import { CheckCircle } from "@phosphor-icons/react";

import { Page, PageHeader } from "@/core/shell/PageHeader";
import type { ModuleDef } from "./registry";

/** Stand-in page for modules that later phases will build. */
export function Placeholder({ module }: { module: ModuleDef }) {
  const Icon = module.icon;
  return (
    <Page>
      <PageHeader title={module.title} description={module.summary} />

      <section className="mt-10 rounded-xl border border-dashed border-border px-6 py-10 md:px-10">
        <div className="flex flex-col gap-6 md:flex-row md:items-start md:gap-10">
          <div className="grid size-14 shrink-0 place-items-center rounded-2xl bg-accent-soft text-accent-soft-foreground">
            <Icon size={28} />
          </div>
          <div className="grid gap-4">
            <div>
              <h2 className="text-[17px] font-semibold tracking-tight">Arrives in phase {module.phase}</h2>
              <p className="mt-1 text-[14px] text-muted-foreground">Here's what this space will hold.</p>
            </div>
            <ul className="grid gap-2.5">
              {module.planned.map((item) => (
                <li key={item} className="flex items-start gap-2.5 text-[15px]">
                  <CheckCircle size={18} className="mt-0.5 shrink-0 text-muted-foreground" />
                  {item}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>
    </Page>
  );
}
