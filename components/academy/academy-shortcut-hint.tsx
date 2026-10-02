"use client";

import { useCallback, useState } from "react";
import { HelpTour } from "@/components/help/help-tour";
import type { HelpTour as HelpTourDefinition } from "@/lib/help/types";

const ACADEMY_SHORTCUT_TOUR: HelpTourDefinition = {
  id: "academy-shortcut",
  title: "Reobote Academy",
  steps: [
    {
      target: "academy",
      title: "Suas aulas ficam aqui",
      body: "Use este atalho sempre que quiser voltar à Academy. No celular, abra Mais e toque em Treinamento.",
    },
  ],
};

export function AcademyShortcutHint() {
  const [open, setOpen] = useState(true);

  const close = useCallback(() => {
    setOpen(false);
    fetch("/api/academy/onboarding/hint-seen", {
      method: "POST",
      keepalive: true,
    }).catch(() => {
      // Sem confirmar no servidor, a dica reaparece no proximo acesso.
    });
  }, []);

  return open ? <HelpTour tour={ACADEMY_SHORTCUT_TOUR} onClose={close} /> : null;
}
