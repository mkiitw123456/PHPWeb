import { test } from "node:test";
import assert from "node:assert/strict";
import { usernameEmail } from "../shared/identity.mjs";
test("usernames share one case-insensitive identity and never accept email/domain injection", () => {
  assert.equal(usernameEmail(" Ricky "), "ricky@login.harbor.invalid");
  assert.equal(usernameEmail("RICKY"), usernameEmail("ricky"));
  for (const value of [
    "ricky@example.com",
    "a",
    "user name",
    "a/b",
    "x".repeat(33),
    null,
    {},
  ])
    assert.throws(() => usernameEmail(value));
});
