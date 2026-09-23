import "server-only";
import { revalidatePath } from "next/cache";

/** After an admin mutation: refresh the back office view. */
export function revalidateAdmin() {
  revalidatePath("/admin", "layout");
}

/** After a change that is visible on the storefront (catalog, CMS, settings). */
export function revalidateStore() {
  revalidatePath("/", "layout");
}
