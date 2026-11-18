import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import '../lib/i18n';
import { OtpField } from './OtpField';

function Harness({ onComplete }: { onComplete: (v: string) => void }) {
  const [v, setV] = useState('');
  return <OtpField value={v} onChange={setV} onComplete={onComplete} />;
}

describe('OtpField', () => {
  it('keeps digits only, stops at 6 and reports completion', async () => {
    const done = vi.fn();
    render(<Harness onComplete={done} />);
    const input = screen.getByLabelText('6-digit code');
    expect(input).toHaveAttribute('autocomplete', 'one-time-code');
    await userEvent.type(input, '12a3 45678');
    expect(input).toHaveValue('123456');
    expect(done).toHaveBeenCalledWith('123456');
  });
});
