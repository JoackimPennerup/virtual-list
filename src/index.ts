import { VirtualListElement } from './virtual-list';

export { VirtualListElement };

export const defineVirtualList = (tagName = 'virtual-list'): void => {
  if (typeof window === 'undefined' || typeof customElements === 'undefined') {
    return;
  }

  if (!customElements.get(tagName)) {
    customElements.define(tagName, VirtualListElement);
  }
};

if (typeof window !== 'undefined') {
  defineVirtualList();
}
