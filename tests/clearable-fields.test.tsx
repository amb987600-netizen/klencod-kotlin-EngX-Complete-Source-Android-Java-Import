// @vitest-environment jsdom
import React, {act, useState} from 'react';
import {createRoot, type Root} from 'react-dom/client';
import {afterEach, beforeEach, expect, it, vi} from 'vitest';
import ClearableInput, {ClearableTextarea} from '../src/ClearableInput';
let host: HTMLDivElement, root: Root;
beforeEach(() => {Object.assign(globalThis, {IS_REACT_ACT_ENVIRONMENT: true}); host = document.createElement('div'); document.body.append(host); root = createRoot(host);});
afterEach(() => {act(() => root.unmount()); host.remove();});
function Input({type = 'text', disabled = false}: {type?: string; disabled?: boolean}) {const [value, setValue] = useState('sample'); return <ClearableInput aria-label="البحث" type={type} disabled={disabled} value={value} onChange={e => setValue(e.target.value)}/>;}
it('clears controlled search text, keeps focus, and does not submit', () => {
  const submit = vi.fn();
  act(() => root.render(<form onSubmit={submit}><Input type="search"/></form>));
  const input = host.querySelector('input')!;
  expect(input.value).toBe('sample');
  act(() => (host.querySelector('button') as HTMLButtonElement).click());
  expect(input.value).toBe(''); expect(document.activeElement).toBe(input); expect(host.querySelector('button')).toBeNull(); expect(submit).not.toHaveBeenCalled();
});
it('does not add clear controls to passwords or disabled fields', () => {
  act(() => root.render(<Input type="password"/>)); expect(host.querySelector('button')).toBeNull();
  act(() => root.render(<Input disabled/>)); expect(host.querySelector('button')).toBeNull();
});
it('clears controlled multi-line fields', () => {
  function Text() {const [value, setValue] = useState('notes'); return <ClearableTextarea aria-label="ملاحظات" value={value} onChange={e => setValue(e.target.value)}/>;}
  act(() => root.render(<Text/>)); act(() => (host.querySelector('button') as HTMLButtonElement).click());
  expect(host.querySelector('textarea')?.value).toBe('');
});
