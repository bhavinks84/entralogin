import { useRef, useEffect } from 'react';
import clsx from 'clsx';

/**
 * 6-cell OTP input with auto-focus, paste support, and backspace navigation.
 */
export default function OTPInput({ value = '', onChange, disabled = false }) {
  // Single ref object holding all 6 input elements — avoids calling useRef()
  // inside a callback (which violates React's Rules of Hooks).
  const inputRefs = useRef([]);

  useEffect(() => {
    if (value === '') inputRefs.current[0]?.focus();
  }, [value]);

  const handleChange = (index, char) => {
    if (!/^\d?$/.test(char)) return; // digits only
    // Build a clean 6-slot array so every position is always defined
    const slots = Array.from({ length: 6 }, (_, i) => value[i] || '');
    slots[index] = char;
    onChange(slots.join('').trimEnd());
    if (char && index < 5) inputRefs.current[index + 1]?.focus();
  };

  const handleKeyDown = (index, e) => {
    if (e.key === 'Backspace' && !value[index] && index > 0) {
      inputRefs.current[index - 1]?.focus();
    }
  };

  const handlePaste = (e) => {
    e.preventDefault();
    const pasted = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, 6);
    onChange(pasted);
    inputRefs.current[Math.min(pasted.length, 5)]?.focus();
  };

  return (
    <div className="flex gap-3 justify-center" onPaste={handlePaste}>
      {Array.from({ length: 6 }).map((_, i) => (
        <input
          key={i}
          ref={(el) => { inputRefs.current[i] = el; }}
          type="text"
          inputMode="numeric"
          maxLength={1}
          value={value[i] || ''}
          onChange={(e) => handleChange(i, e.target.value)}
          onKeyDown={(e) => handleKeyDown(i, e)}
          disabled={disabled}
          className={clsx(
            'h-12 w-12 rounded-lg border-2 text-center text-xl font-semibold focus:outline-none',
            'transition focus:border-primary-600',
            disabled
              ? 'cursor-not-allowed bg-gray-100 text-gray-400'
              : 'border-gray-300 bg-white text-gray-900',
            value[i] && 'border-primary-500'
          )}
        />
      ))}
    </div>
  );
}
