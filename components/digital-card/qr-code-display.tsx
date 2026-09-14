"use client";

import { useEffect, useState } from "react";
import QRCode from "qrcode";
import { Loader2 } from "lucide-react";

/**
 * QR Code do cartão — SEMPRE aponta só pra URL pública permanente
 * (/c/[slug]), nunca vCard/telefone direto (pedido explícito: trocar
 * foto/telefone/cargo depois não deve exigir gerar outro QR Code).
 */
export function QrCodeDisplay({ url, size = 240 }: { url: string; size?: number }) {
  const [dataUrl, setDataUrl] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    QRCode.toDataURL(url, { width: size, margin: 2, color: { dark: "#0a0b10", light: "#ffffff" } })
      .then((d) => {
        if (!cancelled) setDataUrl(d);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [url, size]);

  return (
    <div
      className="flex items-center justify-center rounded-2xl bg-white p-4"
      style={{ width: size + 32, height: size + 32 }}
    >
      {dataUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={dataUrl} alt="QR Code do cartão" width={size} height={size} />
      ) : (
        <Loader2 className="h-6 w-6 animate-spin text-neutral-300" strokeWidth={2.5} />
      )}
    </div>
  );
}
