export function droidErrorDetails(message: string): {
  text: string;
  isError: true;
  errorKind?: 'usage_limit';
} {
  // Droid exposes these account-limit refusals only as HTTP error text.
  const usageLimit = /\b429\b[\s\S]*\b(?:Weekly|Monthly) Limit Exhausted\b/i.test(message);
  return {
    text: message,
    isError: true,
    ...(usageLimit ? { errorKind: 'usage_limit' } : {}),
  };
}
