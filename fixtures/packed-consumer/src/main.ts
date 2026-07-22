import { Shell as CanonicalShell } from "@mantajs/medusa-dashboard/shell"
import { Shell as AliasedShell } from "@medusajs/dashboard/shell"

if (CanonicalShell !== AliasedShell) {
  throw new Error("canonical and aliased Shell exports do not share identity")
}

document.querySelector("#app")?.setAttribute("data-packed-consumer", "ready")
