import zxcvbn from 'zxcvbn';

// zxcvbn scores 0-4 (score N = roughly 10^(2N+2) guesses). Two floors by threat model
// The key export file can be brute-forced offline, the account password only faces online guessing against bcrypt
export const MinKeyExportPasswordScore = 3;
export const MinAccountPasswordScore = 2;

const labels = ['Very weak', 'Weak', 'Fair', 'Strong', 'Very strong'] as const;

export interface PasswordStrength {
    score: 0 | 1 | 2 | 3 | 4;
    label: (typeof labels)[number];
    hint: string; // zxcvbn's warning or first suggestion, empty when it has none
    acceptable: boolean;
}

/** `userInputs` (username/phone_number) are penalised so a password built from them rates as weak. */
export function checkPasswordStrength(password: string, userInputs: string[], minScore: number): PasswordStrength {
    const result = zxcvbn(password, userInputs.filter(Boolean));
    return {
        score: result.score,
        label: labels[result.score],
        hint: result.feedback.warning || result.feedback.suggestions[0] || '',
        acceptable: result.score >= minScore,
    };
}
