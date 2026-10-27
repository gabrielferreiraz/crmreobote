import Image from "next/image";

export function ServopaLogo() {
  return (
    <Image
      src="/partner-logos/servopa.svg"
      alt="Consórcio Servopa"
      width={162}
      height={43}
      priority
      unoptimized
      className="h-[48px] w-auto object-contain"
    />
  );
}

export function ServopaSeal() {
  return (
    <Image
      src="/partner-logos/servopa-60-anos.png"
      alt="Servopa 60 anos"
      width={1402}
      height={1122}
      priority
      unoptimized
      className="h-[66px] w-auto object-contain"
    />
  );
}
