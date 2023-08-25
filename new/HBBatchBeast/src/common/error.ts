const APP_ERROR_TYPENAME = 'AppError';

export class AppError extends Error {
  _typename = APP_ERROR_TYPENAME;

  inner: AppError | Error | any;
  context?: any;

  constructor(
    message: string,
    extra?: { inner?: Error | any; context?: any; stack?: any },
  ) {
    super(message);
    this.context = extra?.context;
    this.inner = extra?.inner;
    this.stack = extra?.stack;
  }

  toJSON() {
    return {
      message: this.message,
      context: this.context,
      stack: this.stack,
      inner:
        this.inner && this.inner._typename !== APP_ERROR_TYPENAME
          ? {
              message: this.inner.message,
              stack: this.inner.stack,
            }
          : this.inner,
    };
  }

  static fromJSON(json: string): AppError {
    try {
      const parsed = JSON.parse(json);
      return new AppError(parsed.message, {
        inner: parsed.inner,
        context: parsed.context,
        stack: parsed.stack,
      });
    } catch (err) {
      throw new AppError('Error occurred while parsing AppError from JSON', {
        inner: err,
      });
    }
  }
}
