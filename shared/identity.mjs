// Internal Firebase identifier only; this address is never used to send email.
export function usernameEmail(value) {
  if (typeof value !== "string" || !/^[a-zA-Z0-9_]{3,32}$/.test(value.trim()))
    throw new Error("帳號需為 3–32 個英文字母、數字或底線");
  return `${value.trim().toLowerCase()}@login.harbor.invalid`;
}
