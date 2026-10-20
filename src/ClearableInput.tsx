import {forwardRef, useImperativeHandle, useRef, type ChangeEvent, type InputHTMLAttributes, type TextareaHTMLAttributes} from 'react';
import {X} from 'lucide-react';
import './clearable-fields.css';

const clearableTypes = new Set(['text', 'search', 'email', 'url', 'tel']);
function labelFor(element: HTMLInputElement | HTMLTextAreaElement, fallback?: string): string {
  return (element.getAttribute('aria-label') || fallback || element.name || element.closest('label')?.textContent?.replace(/×/g, '').trim() || 'الحقل').slice(0, 70);
}

const ClearableInput = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function ClearableInput(props, ref) {
  const inputRef = useRef<HTMLInputElement>(null);
  useImperativeHandle(ref, () => inputRef.current!);
  const visible = clearableTypes.has(props.type || 'text') && !props.disabled && !props.readOnly && !!String(props.value ?? '');
  const clear = () => {
    const input = inputRef.current;
    if (!input || !props.onChange) return;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(input, '');
    props.onChange({target: input, currentTarget: input, type: 'change'} as ChangeEvent<HTMLInputElement>);
    input.focus();
  };
  return <span className={`clearable-field ${visible ? 'has-clear' : ''}`}>
    <input {...props} ref={inputRef}/>
    {visible && props.onChange && <button type="button" className="field-clear" aria-label={`مسح ${props['aria-label'] || props.placeholder || props.name || 'الحقل'}`} title="مسح الحقل" onClick={event => {event.preventDefault(); event.stopPropagation(); clear();}} onFocus={event => {if (inputRef.current) event.currentTarget.setAttribute('aria-label', `مسح ${labelFor(inputRef.current, props.placeholder)}`);}}><X size={16} aria-hidden="true"/></button>}
  </span>;
});
export default ClearableInput;

export const ClearableTextarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(function ClearableTextarea(props, ref) {
  const inputRef = useRef<HTMLTextAreaElement>(null);
  useImperativeHandle(ref, () => inputRef.current!);
  const visible = !props.disabled && !props.readOnly && !!String(props.value ?? '');
  const clear = () => {
    const input = inputRef.current;
    if (!input || !props.onChange) return;
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set?.call(input, '');
    props.onChange({target: input, currentTarget: input, type: 'change'} as ChangeEvent<HTMLTextAreaElement>);
    input.focus();
  };
  return <span className={`clearable-field clearable-textarea ${visible ? 'has-clear' : ''}`}><textarea {...props} ref={inputRef}/>{visible && props.onChange && <button type="button" className="field-clear" aria-label={`مسح ${props['aria-label'] || props.placeholder || props.name || 'النص'}`} title="مسح النص" onClick={event => {event.preventDefault(); event.stopPropagation(); clear();}}><X size={16} aria-hidden="true"/></button>}</span>;
});
