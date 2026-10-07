function createCredentialCaptureGuard(entry, contents, submittedUrl) {
  const origin = new URL(submittedUrl).origin;
  return () =>
    entry.contents === contents &&
    !contents.isDestroyed() &&
    URL.canParse(contents.getURL()) &&
    new URL(contents.getURL()).origin === origin;
}

module.exports = { createCredentialCaptureGuard };
