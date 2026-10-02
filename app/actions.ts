"use server";

import { revalidatePath } from "next/cache";
import { createRecord } from "@/db";

// Bounds a single unauthenticated write. This action has no auth (the template ships no
// auth), so without a cap any visitor can post an unbounded string straight into the
// production table. Kept short because a title is a title.
const MAX_TITLE = 200;

export async function submitRecord(formData: FormData) {
  const title = String(formData.get("title") ?? "").trim();
  if (!title) return { ok: false, error: "title is required" };
  if (title.length > MAX_TITLE) {
    return { ok: false, error: `title must be ${MAX_TITLE} characters or fewer` };
  }
  try {
    await createRecord(title);
  } catch (err) {
    // Surfaced to the user rather than thrown, so a database outage shows the form's
    // own error state instead of the blank error boundary.
    console.error("submitRecord failed:", err);
    return { ok: false, error: "could not save: the database is unavailable right now" };
  }
  revalidatePath("/");
  return { ok: true };
}
