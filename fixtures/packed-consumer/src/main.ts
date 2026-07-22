import { Shell as CanonicalShell } from "@mantajs/medusa-dashboard/shell"
import { Shell as AliasedShell } from "@medusajs/dashboard/shell"
import { Shell as ConsumerShell } from "./admin/components/shell"

if (CanonicalShell !== AliasedShell) {
  throw new Error("canonical and aliased Shell exports do not share identity")
}
if (typeof ConsumerShell !== "function") {
  throw new Error("consumer Shell wrapper did not load")
}

document.querySelector("#app")?.setAttribute("data-packed-consumer", "ready")
