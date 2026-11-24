import Image from "next/image";

/**
 * Logo oficial do CRM (public/logo-crm.png). Fica no código, como arquivo
 * estático — não é configuração da organização nem vem do banco. Para trocar,
 * substitua o arquivo em public/.
 */
export const CRM_LOGO_SRC = "/logo-crm.png";

export function CrmLogo({ size = 28, className = "" }: { size?: number; className?: string }) {
  return (
    <Image
      src={CRM_LOGO_SRC}
      alt="Amplitude"
      width={size}
      height={size}
      priority
      className={`shrink-0 rounded-lg ${className}`}
      style={{ width: size, height: size }}
    />
  );
}
