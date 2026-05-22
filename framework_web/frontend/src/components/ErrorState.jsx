import React from 'react';
import { Icon } from './Icon.jsx';
import { Button } from './Button.jsx';

export function ErrorState({ title = 'Something went wrong', message = 'Unable to load data. Please try again.', onRetry = null }) {
  return (
    <div className="col-span-full flex flex-col items-center justify-center p-12 text-center">
      <Icon name="alert-circle" size={32} className="text-risk-high mb-3" />
      <h3 className="text-16 font-semibold text-text-primary mb-1">{title}</h3>
      <p className="text-14 text-text-secondary max-w-md mb-4">{message}</p>
      {onRetry && <Button label="Try again" variant="secondary" icon="refresh-cw" onClick={onRetry} />}
    </div>
  );
}