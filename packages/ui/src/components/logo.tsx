import { ComponentProps } from "solid-js"

export const Mark = (props: { class?: string }) => {
  return (
    <svg
      data-component="logo-mark"
      classList={{ [props.class ?? ""]: !!props.class }}
      viewBox="0 0 16 20"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      {/* Block-letter C mark */}
      <path data-slot="logo-mark-shadow" d="M12 16H4V8H12V12H8V12Z" fill="var(--icon-weak-base)" />
      <path data-slot="logo-mark-c" d="M4 4H16V8H8V12H16V16H4V4ZM0 0H16V4H0V0ZM0 16H16V20H0V16ZM0 0V20H4V0H0Z" fill="var(--icon-strong-base)" />
    </svg>
  )
}

export const Splash = (props: Pick<ComponentProps<"svg">, "ref" | "class">) => {
  return (
    <svg
      ref={props.ref}
      data-component="logo-splash"
      classList={{ [props.class ?? ""]: !!props.class }}
      viewBox="0 0 80 100"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      {/* Block-letter C splash */}
      <path d="M60 80H20V40H60V60H40V60Z" fill="var(--icon-base)" />
      <path d="M20 20H80V40H40V60H80V80H20V20ZM0 0H80V20H0V0ZM0 80H80V100H0V80ZM0 0V100H20V0H0Z" fill="var(--icon-strong-base)" />
    </svg>
  )
}

export const Logo = (props: { class?: string }) => {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 186 36"
      fill="none"
      classList={{ [props.class ?? ""]: !!props.class }}
    >
      <g>
        {/* C */}
        <path d="M18 24H6V12H18V18Z" fill="var(--icon-weak-base)" />
        <path d="M6 6H24V12H12V24H24V30H6V6ZM0 6H6V30H0V6Z" fill="var(--icon-base)" />
        {/* R */}
        <path d="M48 18H36V12H48V18Z" fill="var(--icon-weak-base)" />
        <path d="M36 6H48V18H36V6ZM30 6H36V30H30V6ZM48 6H54V18H48V6ZM42 18H48V24L54 30H48L42 24V18Z" fill="var(--icon-base)" />
        {/* E */}
        <path d="M78 18V24H66V18H78Z" fill="var(--icon-weak-base)" />
        <path d="M78 18H66V24H78V30H60V6H78V18ZM66 12H72V12H66V12Z" fill="var(--icon-base)" />
        <path d="M66 12H72V6H78V12H72V18H66V12Z" fill="var(--icon-base)" />
        {/* W */}
        <path d="M96 24H90V12H96V24Z" fill="var(--icon-weak-base)" />
        <path d="M108 24H102V12H108V24Z" fill="var(--icon-weak-base)" />
        <path d="M84 6H90V24H96V6H102V24H108V6H114V30H84V6Z" fill="var(--icon-base)" />
        {/* U */}
        <path d="M138 24H126V12H138V24Z" fill="var(--icon-weak-base)" />
        <path d="M126 6V24H138V6H144V30H120V6H126Z" fill="var(--icon-base)" />
        {/* P */}
        <path d="M168 18H156V12H168V18Z" fill="var(--icon-weak-base)" />
        <path d="M156 6H168V18H156V6ZM150 6H156V30H150V6ZM168 6H174V18H168V6Z" fill="var(--icon-strong-base)" />
      </g>
    </svg>
  )
}
