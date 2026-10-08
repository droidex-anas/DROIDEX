/** One create generation owns admission and any Canvas commit it has started. */
export class SessionCreateAdmission {
  private cancelled = false;
  private settle: (admitted: boolean) => void = () => undefined;
  readonly ready = new Promise<boolean>((resolve) => {
    this.settle = resolve;
  });
  private commitFinished?: Promise<void>;

  constructor(private readonly ownsRuntime: () => boolean) {}

  readonly isCurrent = (): boolean => !this.cancelled && this.ownsRuntime();

  readonly requireCurrent = (): void => {
    if (!this.isCurrent()) throw new Error('The session closed before its first turn.');
  };

  admit(): void {
    this.requireCurrent();
    this.settle(true);
  }

  cancel(): void {
    this.cancelled = true;
    this.settle(false);
  }

  async commit<T>(operation: (isCurrent: () => boolean) => Promise<T>): Promise<T> {
    this.requireCurrent();
    const pending = operation(this.isCurrent);
    this.commitFinished = pending.then(
      () => undefined,
      () => undefined,
    );
    const result = await pending;
    this.requireCurrent();
    return result;
  }

  // A commit past its rename must finish before a replacement can own the chat.
  async drain(): Promise<void> {
    await this.commitFinished;
  }
}
