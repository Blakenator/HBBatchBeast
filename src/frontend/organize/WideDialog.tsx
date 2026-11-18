import React, { forwardRef, type HTMLAttributes } from 'react';

export interface WideDialogProps extends HTMLAttributes<HTMLDivElement> {
  contentClassName?: string;
  centered?: boolean;
  /** CSS width applied to the dialog; the split editor needs more room. */
  width?: string;
}

/**
 * A Bootstrap modal dialog wider than the default. react-bootstrap passes its
 * own dialog props, which are consumed here so they never reach the DOM. The
 * `.modal-content` wrapper is required for the surface, padding and scrolling.
 */
export const WideDialog = forwardRef<HTMLDivElement, WideDialogProps>(
  (
    { className, style, contentClassName, centered, width, children, ...rest },
    ref,
  ) => {
    // `centered` is honoured by the class added below.
    void centered;
    const resolvedWidth = width ?? '80vw';
    return (
      <div
        {...rest}
        ref={ref}
        className={['modal-dialog', 'modal-dialog-centered', className]
          .filter(Boolean)
          .join(' ')}
        style={{
          width: resolvedWidth,
          maxWidth: resolvedWidth,
          ...style,
        }}
      >
        <div
          className={['modal-content', contentClassName]
            .filter(Boolean)
            .join(' ')}
        >
          {children}
        </div>
      </div>
    );
  },
);
WideDialog.displayName = 'WideDialog';
