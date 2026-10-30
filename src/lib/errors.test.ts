import test from "node:test";
import assert from "node:assert/strict";
import { friendlyError, isMissingTable } from "./errors";

test("database and network errors become the plain fallback; messages for people pass through", () => {
  const fallback = "Your activities couldn’t load right now.";
  for (const raw of [
    { message: "Could not find the table 'public.activities' in the schema cache", code: "PGRST205" },
    { message: 'relation "public.gear_items" does not exist', code: "42P01" },
    { message: "permission denied for table ski_areas" },
    { message: "new row violates row-level security policy for table \"favorite_trails\"" },
    { message: "JWT expired" },
    new TypeError("Failed to fetch"),
    { message: "Request failed with status code 500" },
    { message: "No suitable key or wrong key type" },
    { message: 'invalid input syntax for type uuid: "123"' },
    "",
    null,
  ]) assert.equal(friendlyError(raw, fallback), fallback, JSON.stringify(raw));
  assert.equal(friendlyError(new Error("Choose a start and an end."), fallback), "Choose a start and an end.");
  assert.equal(friendlyError({ message: "Invalid login credentials" }, fallback), "Invalid login credentials");
});

test("a missing table is recognised so pages can show an empty state instead of an error", () => {
  assert.ok(isMissingTable({ code: "PGRST205", message: "Could not find the table 'public.activities' in the schema cache" }));
  assert.ok(isMissingTable({ code: "42P01", message: 'relation "x" does not exist' }));
  assert.ok(!isMissingTable({ code: "42501", message: "permission denied" }));
  assert.ok(!isMissingTable(null));
});
