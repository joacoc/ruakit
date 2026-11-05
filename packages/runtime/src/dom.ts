// Copyright 2026 RuaKit contributors. SPDX-License-Identifier: MIT
import {
  computeAccessibleDescription,
  computeAccessibleName,
  getRole,
} from 'dom-accessibility-api';
import type { ControlGroup, ControlState } from './types.js';

export type NativeField = HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;
export type ControlData = Omit<ControlState, 'target'>;

export const CONTROL_SELECTOR =
  'button, a[href], input:not([type="hidden"]):not([type="password"]):not([type="file"]), textarea, select, [contenteditable="true"], [contenteditable=""], [role="button"], [role="link"], [role="checkbox"], [role="radio"], [role="textbox"], [role="combobox"], [tabindex]';
const excluded = 'script, style, noscript, template, [data-ruakit-ignore], [data-ruakit-toolbar]';
const normalize = (value: string): string => value.replace(/\s+/g, ' ').trim();

/** Follow open shadow hosts as well as ordinary DOM ancestors. */
export function composedParent(element: HTMLElement): HTMLElement | null {
  if (element.parentElement) return element.parentElement;

  const root = element.getRootNode();
  return root instanceof element.ownerDocument.defaultView!.ShadowRoot
    ? (root.host as HTMLElement)
    : null;
}

export function contains(root: Document | HTMLElement, element: HTMLElement): boolean {
  for (let current: HTMLElement | null = element; current; current = composedParent(current)) {
    if (root.contains(current)) return true;
  }

  return false;
}

export function activeElement(document: Document): Element | null {
  let element = document.activeElement;
  while (element?.shadowRoot?.activeElement) element = element.shadowRoot.activeElement;
  return element;
}

/** Keep discovery within the configured root, including its open shadow trees. */
export function* controls(root: Document | HTMLElement | ShadowRoot): Generator<HTMLElement> {
  if (root.nodeType === 1 && (root as HTMLElement).matches(CONTROL_SELECTOR))
    yield root as HTMLElement;
  if (root.nodeType === 1 && (root as HTMLElement).shadowRoot)
    yield* controls((root as HTMLElement).shadowRoot!);

  for (const child of root.children) {
    if (child.matches(excluded)) continue;
    yield* controls(child as HTMLElement);
  }
}

export function isField(element: HTMLElement): element is NativeField {
  return ['INPUT', 'TEXTAREA', 'SELECT'].includes(element.tagName);
}

export function isVisible(element: HTMLElement): boolean {
  if (
    !element.isConnected ||
    !element.getClientRects().length ||
    element.closest(`${excluded}, [hidden], [inert], [aria-hidden="true"]`)
  ) {
    return false;
  }

  const view = element.ownerDocument.defaultView!;
  const current = view.getComputedStyle(element);
  if (current.visibility === 'hidden' || current.visibility === 'collapse') {
    return false;
  }

  for (let parent: HTMLElement | null = element; parent; parent = composedParent(parent)) {
    if (parent.matches(`${excluded}, [hidden], [inert], [aria-hidden="true"]`)) return false;
    const style = view.getComputedStyle(parent);
    if (style.display === 'none' || style.opacity === '0') {
      return false;
    }
  }

  return true;
}

/** Read rendered text without copying hidden content or field values into page prose. */
export function visibleText(root: Document | HTMLElement, limit: number): string {
  if (
    root.nodeType === 1 &&
    (root as HTMLElement).matches(`${excluded}, input, textarea, select`)
  ) {
    return '';
  }
  const document = root.ownerDocument ?? (root as Document);
  const view = document.defaultView!;
  const walker = document.createTreeWalker(
    root,
    view.NodeFilter.SHOW_ELEMENT | view.NodeFilter.SHOW_TEXT,
    {
      acceptNode(node) {
        if (node.nodeType === view.Node.ELEMENT_NODE) {
          const element = node as HTMLElement;
          if (element.matches(`${excluded}, input, textarea, select`)) {
            return view.NodeFilter.FILTER_REJECT;
          }
          // A descendant can override visibility:hidden. Its own text is checked below.
          const visibility = view.getComputedStyle(element).visibility;
          return isVisible(element) || visibility === 'hidden' || visibility === 'collapse'
            ? view.NodeFilter.FILTER_SKIP
            : view.NodeFilter.FILTER_REJECT;
        }
        return node.parentElement && isVisible(node.parentElement)
          ? view.NodeFilter.FILTER_ACCEPT
          : view.NodeFilter.FILTER_REJECT;
      },
    },
  );
  let result = '';
  while (walker.nextNode()) {
    const value = normalize(walker.currentNode.textContent ?? '');
    if (value) {
      result += (result ? ' ' : '') + value;
    }
    if (result.length >= limit) {
      break;
    }
  }
  return result;
}

function roleOf(element: HTMLElement): string {
  const explicit = element.getAttribute('role');
  if (explicit) {
    return explicit;
  }
  if (element.tagName === 'A') {
    return 'link';
  }
  if (element.tagName === 'BUTTON') {
    return 'button';
  }
  if (element.tagName === 'SELECT') {
    const select = element as HTMLSelectElement;
    return select.multiple || select.size > 1 ? 'listbox' : 'combobox';
  }
  if (element.tagName === 'INPUT') {
    const type = (element as HTMLInputElement).type;
    if (['button', 'submit', 'reset', 'image'].includes(type)) {
      return 'button';
    }
    if (['checkbox', 'radio'].includes(type)) {
      return type;
    }
  }
  return isField(element) ? 'textbox' : 'control';
}

const groupRoles = new Set<ControlGroup['role']>([
  'form',
  'group',
  'radiogroup',
  'region',
  'dialog',
  'alertdialog',
]);

/** Preserve group names without copying complete forms, field values or surrounding page prose. */
function observeGroups(
  element: HTMLElement,
  root: Document | HTMLElement,
): Pick<ControlData, 'groups' | 'groupsTruncated'> {
  const groups: ControlGroup[] = [];
  const ancestors = new Set<HTMLElement>();
  let truncated = false;

  const add = (container: HTMLElement): void => {
    if (container.closest(`${excluded}, [hidden], [inert], [aria-hidden="true"]`)) {
      return;
    }
    const role = getRole(container) as ControlGroup['role'] | null;
    if (!role || !groupRoles.has(role)) {
      return;
    }
    let name = normalize(computeAccessibleName(container));
    if (!name) {
      // A direct visible heading also identifies an otherwise unnamed section or group.
      const heading = [...container.children].find(
        (child): child is HTMLElement =>
          child instanceof element.ownerDocument.defaultView!.HTMLElement &&
          child.matches('h1, h2, h3, h4, h5, h6, [role="heading"]') &&
          isVisible(child),
      );
      if (heading) {
        name = visibleText(heading, 201);
      }
    }
    if (!name) {
      return;
    }
    if (groups.length === 4) {
      truncated = true;
      return;
    }
    truncated ||= name.length > 200;
    groups.push({ role, name: name.slice(0, 200) });
  };

  const ownerForm =
    isField(element) || element.tagName === 'BUTTON'
      ? (element as NativeField | HTMLButtonElement).form
      : null;

  for (
    let parent = composedParent(element);
    parent && contains(root, parent);
    parent = composedParent(parent)
  ) {
    ancestors.add(parent);
    // A form attribute can associate a field with a different form from its DOM ancestor.
    if (parent.tagName !== 'FORM' || !ownerForm || parent === ownerForm) {
      add(parent);
    }
  }

  if (ownerForm && contains(root, ownerForm) && !ancestors.has(ownerForm)) {
    add(ownerForm);
  }

  return {
    ...(groups.length ? { groups: groups.reverse() } : {}),
    ...(truncated ? { groupsTruncated: true } : {}),
  };
}

export function observeControl(element: HTMLElement, root: Document | HTMLElement): ControlData {
  const editable = element.matches('[contenteditable="true"], [contenteditable=""]');
  const field = isField(element) ? element : undefined;
  const type = element.tagName === 'INPUT' ? (element as HTMLInputElement).type : '';
  const select = element.tagName === 'SELECT' ? (element as HTMLSelectElement) : undefined;
  const row = element.closest<HTMLElement>('tr, li, article, [role="row"], [role="listitem"]');
  const description = normalize(computeAccessibleDescription(element)).slice(0, 1000);
  const placeholder = element.matches('input, textarea')
    ? normalize(element.getAttribute('placeholder') ?? '').slice(0, 1000)
    : '';

  const data: ControlData = {
    tag: element.tagName.toLowerCase(),
    role: editable ? 'textbox' : roleOf(element),
    ...(editable
      ? { contentEditable: true, value: element.innerText ?? element.textContent ?? '' }
      : {}),
    ...(field ? { type: type || element.tagName.toLowerCase() } : {}),
    label: normalize(computeAccessibleName(element)).slice(0, 1000),
    ...(description ? { description } : {}),
    ...(placeholder ? { placeholder } : {}),
    ...observeGroups(element, root),
    context: row && contains(root, row) ? visibleText(row, 1000).slice(0, 1000) : '',
    enabled: !element.matches(':disabled') && !element.closest('[aria-disabled="true"], [inert]'),
    readOnly:
      element.getAttribute('aria-readonly') === 'true' ||
      Boolean(field && 'readOnly' in field && field.readOnly),
  };

  if (field) {
    data.value = field.value;
    data.valid = field.validity.valid && element.getAttribute('aria-invalid') !== 'true';
  }

  if (type === 'checkbox' || type === 'radio') {
    data.checked = (element as HTMLInputElement).checked;
  } else if (element.hasAttribute('aria-checked')) {
    data.checked = element.getAttribute('aria-checked') === 'true';
  }

  if (element.hasAttribute('aria-expanded')) {
    data.expanded = element.getAttribute('aria-expanded') === 'true';
  }

  if (select) {
    data.selectedValues = [...select.selectedOptions].map((option) => option.value);
    data.options = [...select.options].map((option) => ({
      value: option.value,
      label: option.label,
      enabled: !option.disabled && !option.closest('optgroup[disabled]'),
    }));
  }

  return data;
}

export function configuration(element: HTMLElement): string {
  return JSON.stringify(
    [
      'type',
      'name',
      'href',
      'role',
      'form',
      'required',
      'min',
      'max',
      'step',
      'pattern',
      'minlength',
      'maxlength',
      'multiple',
    ].map((name) => element.getAttribute(name)),
  );
}
