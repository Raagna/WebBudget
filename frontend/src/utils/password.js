// Mirrors isValidPassword in backend/middleware/validate.js, so the forms
// can explain a problem before submitting. The server still decides.
//
// The limit is 72 BYTES because bcrypt ignores anything after that. Most
// letters are 1 byte, accented ones 2, emoji 4 - so a password can be
// rejected for length while being well under 72 characters.
export const MIN_PASSWORD_LENGTH = 8;
export const MAX_PASSWORD_BYTES = 72;

export function passwordProblem(password) {
  if (password.length < MIN_PASSWORD_LENGTH) return `Use at least ${MIN_PASSWORD_LENGTH} characters.`;
  if (new TextEncoder().encode(password).length > MAX_PASSWORD_BYTES) {
    return 'That password is too long. Keep it under 72 characters (accented letters and emoji count as 2–4).';
  }
  return '';
}
