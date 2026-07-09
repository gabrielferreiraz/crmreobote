import { colorForName, initialsForName } from "@/lib/avatar-color";

const SIZES = {
  xs: "h-5 w-5 text-[10px]",
  sm: "h-6 w-6 text-[11px]",
  md: "h-8 w-8 text-xs",
  lg: "h-10 w-10 text-sm",
  xl: "h-20 w-20 text-2xl",
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
