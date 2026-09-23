import { notFound } from "next/navigation";

// Any unknown path under a locale renders the localised 404 (with status 404).
export default function CatchAll() {
  notFound();
}
