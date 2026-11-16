/**
 * Native DOM adaptation of FCC forms.tsx Segmented/useRoving:
 * one tabbable radio, wrapping arrows, Home/End, selection before focus.
 * Button defaults/variants adapt FCC Button.tsx and design-demos shadcn
 * ui/button.tsx. Original source paths and source revision: lab README.
 * No framework runtime or simulator source is included.
 */

/**
 * @param {{ label: string, variant?: string, className?: string }} options
 * @returns {HTMLButtonElement}
 */
export function createButton({ label, variant = 'secondary', className = '' }) {
  const button = document.createElement('button');
  button.type = 'button';
  button.dataset.slot = 'button';
  button.dataset.variant = variant;
  button.className = `button button-${variant} ${className}`.trim();
  button.setAttribute('aria-label', label);
  return button;
}

/**
 * @param {HTMLElement} group
 * @param {{ attribute: string, value: string, onChange: (value: string) => void }} options
 * @returns {{ setValue: (value: string) => void, destroy: () => void }}
 */
export function bindRadioGroup(group, { attribute, value, onChange }) {
  const buttons = [...group.querySelectorAll(`button[${attribute}]`)];
  const values = buttons.map((button) => button.getAttribute(attribute));

  if (!buttons.length || values.some((item) => item === null) || new Set(values).size !== values.length) {
    throw new TypeError('Radio group requires unique button values.');
  }

  function setValue(next) {
    if (!values.includes(next)) throw new TypeError('Unknown radio group value.');
    value = next;
    buttons.forEach((button, index) => {
      const active = values[index] === value;
      button.setAttribute('role', 'radio');
      button.setAttribute('aria-checked', String(active));
      button.tabIndex = active ? 0 : -1;
    });
  }

  function select(index, moveFocus = false) {
    const button = buttons[index];
    const next = values[index];
    if (!button || next === null || next === undefined || button.disabled) return;
    setValue(next);
    onChange(next);
    if (moveFocus) button.focus();
  }

  const cleanups = buttons.map((button, index) => {
    const onClick = () => select(index);
    const onKeyDown = (event) => {
      const current = values.indexOf(value);
      let next = -1;
      if (event.key === 'ArrowRight' || event.key === 'ArrowDown') next = (current + 1) % values.length;
      else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') next = (current - 1 + values.length) % values.length;
      else if (event.key === 'Home') next = 0;
      else if (event.key === 'End') next = values.length - 1;
      if (next < 0) return;
      event.preventDefault();
      select(next, true);
    };
    button.addEventListener('click', onClick);
    button.addEventListener('keydown', onKeyDown);
    return () => {
      button.removeEventListener('click', onClick);
      button.removeEventListener('keydown', onKeyDown);
    };
  });

  group.setAttribute('role', 'radiogroup');
  setValue(value);
  return { setValue, destroy: () => cleanups.forEach((cleanup) => cleanup()) };
}
