"use client";

import { Wifi, Signal, Battery } from "lucide-react";

export function PhonePreviewFrame({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto w-full max-w-[325px]">
      {/* Container do Celular com Borda Metálica Titanium e Sombra Realista */}
      <div className="relative rounded-[3.2rem] bg-gradient-to-b from-neutral-700 via-neutral-800 to-neutral-950 p-[9px] shadow-[0_25px_60px_-15px_rgba(0,0,0,0.9),0_0_30px_rgba(0,174,238,0.12)] ring-1 ring-white/20">
        
        {/* Botão de Ação / Volume no lado esquerdo */}
        <div className="absolute -left-[3px] top-24 h-7 w-[3px] rounded-l-sm bg-neutral-600" />
        <div className="absolute -left-[3px] top-36 h-11 w-[3px] rounded-l-sm bg-neutral-600" />
        <div className="absolute -left-[3px] top-50 h-11 w-[3px] rounded-l-sm bg-neutral-600" />
        
        {/* Botão de Ligar/Desligar no lado direito */}
        <div className="absolute -right-[3px] top-40 h-14 w-[3px] rounded-r-sm bg-neutral-600" />

        {/* Tela Interna com Proporção de Smartphone Elegante (19.5:9) */}
        <div className="relative flex h-[640px] flex-col overflow-hidden rounded-[2.5rem] bg-[#07080c] ring-1 ring-white/10">
          
          {/* Status Bar do Celular */}
          <div className="relative z-30 flex items-center justify-between px-5 pt-2 text-[10px] font-semibold text-white/90">
            <span>09:41</span>
            
            {/* Dynamic Island */}
            <div className="absolute left-1/2 top-2 z-40 flex h-4 w-22 -translate-x-1/2 items-center justify-between rounded-full bg-black px-2 shadow-md ring-1 ring-white/10">
              <div className="h-2 w-2 rounded-full bg-[#111] ring-1 ring-neutral-800" />
              <div className="flex items-center gap-1">
                <div className="h-1.5 w-1.5 rounded-full bg-emerald-500/80 animate-pulse" />
                <div className="h-2 w-2 rounded-full bg-[#0a192f] ring-1 ring-cyan-900" />
              </div>
            </div>

            <div className="flex items-center gap-1.5 text-white/80">
              <Signal className="h-2.5 w-2.5" strokeWidth={2.5} />
              <Wifi className="h-2.5 w-2.5" strokeWidth={2.5} />
              <Battery className="h-3 w-3" strokeWidth={2.5} />
            </div>
          </div>

          {/* Conteúdo do Cartão (Scroll estritamente vertical, sem movimento lateral) */}
          <div className="relative flex-1 overflow-y-auto overflow-x-hidden touch-pan-y [touch-action:pan-y] [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden">
            <div className="w-full max-w-full overflow-x-hidden px-3.5 pb-4 pt-2.5">{children}</div>
          </div>

          {/* Home Indicator Bar */}
          <div className="relative z-30 py-1 bg-gradient-to-t from-[#07080c] to-transparent">
            <div className="mx-auto h-1 w-28 rounded-full bg-white/30" />
          </div>

        </div>
      </div>
    </div>
  );
}


