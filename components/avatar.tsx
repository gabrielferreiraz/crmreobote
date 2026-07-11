import { colorForName, initialsForName } from "@/lib/avatar-color";

const SIZES = {
  "2xs": "h-3.5 w-3.5 text-[8px]",
  xs: "h-6 w-6 text-xs",
  sm: "h-7 w-7 text-xs",
  md: "h-9 w-9 text-sm",
  lg: "h-12 w-12 text-base",
  xl: "h-24 w-24 text-3xl",
};

export function Avatar({
  name,
  src,
  size = "sm",
  className = "",
}: {
  name: string;
  src?: string | null;
  size?: keyof typeof SIZES;
  className?: string;
}) {
  if (src) {
    // eslint-disable-next-line @next/next/no-img-element
    return (
      <img
        src={src}
        alt={name}
        title={name}
        className={`inline-block shrink-0 rounded-full object-cover ${SIZES[size]} ${className}`}
      />
    );
  }

  const { bg, fg } = colorForName(name);
  return (
    <span
      className={`inline-flex shrink-0 items-center justify-center rounded-full font-medium ${SIZES[size]} ${className}`}
      style={{ backgroundColor: bg, color: fg }}
      title={name}
    >
      {initialsForName(name)}
    </span>
  );
}
