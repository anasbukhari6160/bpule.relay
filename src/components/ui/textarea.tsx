import * as React from "react"
import { cn } from "cn"

function Textarea({
  className,
  error,
  "aria-invalid": ariaInvalid,
  ...props
}: React.ComponentProps<"textarea"> & { error?: boolean }) {
  return (
    <textarea
      data-slot="textarea"
      aria-invalid={error ? true : ariaInvalid}
      className={cn(
        "flex field-sizing-content min-h-14 w-full rounded-md border border-line bg-bone-raised px-3 py-2 text-[13px] transition-all duration-150 outline-none",
        "placeholder:text-stone/70",
        "focus-visible:border-orange/40 focus-visible:ring-2 focus-visible:ring-orange/15",
        "disabled:cursor-not-allowed disabled:bg-bone disabled:opacity-50",
        "aria-invalid:border-status-danger/40 aria-invalid:ring-2 aria-invalid:ring-status-danger/15",
        className
      )}
      {...props}
    />
  )
}

export { Textarea }
