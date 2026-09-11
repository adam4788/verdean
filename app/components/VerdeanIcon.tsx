import type { SVGProps } from "react";

export type VerdeanIconName = "link" | "folder" | "check" | "warning" | "arrow" | "file";

type IconProps = Omit<SVGProps<SVGSVGElement>, "name"> & {
  name: VerdeanIconName;
};

export function VerdeanIcon({ name, className, ...props }: IconProps) {
  const common = {
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.75,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
  };

  return (
    <svg
      aria-hidden="true"
      className={`icon icon-${name}${className ? ` ${className}` : ""}`}
      focusable="false"
      viewBox="0 0 24 24"
      {...props}
    >
      {name === "link" && (
        <>
          <path {...common} d="M9.7 14.3 7.8 16.2a3.4 3.4 0 0 1-4.8-4.8l3-3a3.4 3.4 0 0 1 4.8 0" />
          <path {...common} d="m14.3 9.7 1.9-1.9a3.4 3.4 0 0 1 4.8 4.8l-3 3a3.4 3.4 0 0 1-4.8 0M8.6 15.4l6.8-6.8" />
        </>
      )}
      {name === "folder" && (
        <path {...common} d="M3.5 7.5h6l2-2h4.2a2 2 0 0 1 2 2v1h2.8v8.2a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2V7.5Zm0 1h14.2" />
      )}
      {name === "check" && <path {...common} d="m5 12.5 4.2 4.2L19 7.5" />}
      {name === "warning" && (
        <>
          <path {...common} d="M10.3 4.7 3.8 16a2 2 0 0 0 1.7 3h13a2 2 0 0 0 1.7-3L13.7 4.7a2 2 0 0 0-3.4 0Z" />
          <path {...common} d="M12 9v4.2M12 16.4h.01" />
        </>
      )}
      {name === "arrow" && <path {...common} d="M4 12h15m-5-5 5 5-5 5" />}
      {name === "file" && (
        <>
          <path {...common} d="M6 3.5h7l5 5v12H6v-17Z" />
          <path {...common} d="M13 3.5v5h5M9 13h6M9 16.5h4.5" />
        </>
      )}
    </svg>
  );
}
