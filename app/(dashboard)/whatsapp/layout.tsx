import { WhatsAppSubNav } from "./whatsapp-subnav";

/** Conversas, Campanhas e Scripts moram todos sob uma aba só no menu — separados aqui por sub-navegação em vez de 3 itens no menu de cima. */
export default function WhatsAppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-full flex-col gap-3">
      <div className="hidden lg:block">
        <h1 className="text-xl font-semibold tracking-tight text-neutral-900 dark:text-neutral-100">WhatsApp</h1>
      </div>
      <WhatsAppSubNav />
      <div className="min-h-0 flex-1">{children}</div>
    </div>
  );
}
