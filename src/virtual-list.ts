import {
  Virtualizer,
  elementScroll,
  measureElement,
  observeElementOffset,
  observeElementRect,
} from '@tanstack/virtual-core';
import type { VirtualizerOptions } from '@tanstack/virtual-core';

type Orientation = 'vertical' | 'horizontal';

type InstanceGetter = () => Virtualizer<HTMLDivElement, HTMLElement>;

const DEFAULT_ESTIMATE = 48;
const DEFAULT_OVERSCAN = 2;

const NUMBER_ATTRIBUTES = new Set([
  'overscan',
  'estimate-size',
  'padding-start',
  'padding-end',
  'scroll-padding-start',
  'scroll-padding-end',
]);

export class VirtualListElement extends HTMLElement {
  static get observedAttributes(): string[] {
    return Array.from(NUMBER_ATTRIBUTES).concat('orientation');
  }

  #virtualizer: Virtualizer<HTMLDivElement, HTMLElement> | null = null;
  #virtualizerCleanup: (() => void) | null = null;
  #items: HTMLElement[] = [];
  #scrollElement: HTMLDivElement | null = null;
  #sizerElement: HTMLDivElement | null = null;
  #itemsContainer: HTMLDivElement | null = null;
  #initialized = false;
  #mutationObserver: MutationObserver | null = null;
  #orientation: Orientation = 'vertical';
  #estimateSize = DEFAULT_ESTIMATE;
  #overscan = DEFAULT_OVERSCAN;
  #paddingStart = 0;
  #paddingEnd = 0;
  #scrollPaddingStart = 0;
  #scrollPaddingEnd = 0;
  #rafId: number | null = null;

  constructor() {
    super();
  }

  connectedCallback(): void {
    if (!this.#initialized) {
      this.#initialize();
    } else {
      this.#startObservingLightDom();
      this.#mountVirtualizer();
    }
  }

  disconnectedCallback(): void {
    this.#stopObservingLightDom();
    this.#teardownVirtualizer();
  }

  attributeChangedCallback(name: string, oldValue: string | null, newValue: string | null): void {
    if (oldValue === newValue) {
      return;
    }

    if (name === 'orientation') {
      this.#orientation = newValue === 'horizontal' ? 'horizontal' : 'vertical';
    } else if (NUMBER_ATTRIBUTES.has(name)) {
      const parsed = newValue != null ? Number(newValue) : NaN;
      const fallback = this.#fallbackForAttribute(name);
      const next = Number.isFinite(parsed) ? parsed : fallback;
      switch (name) {
        case 'estimate-size':
          this.#estimateSize = next;
          break;
        case 'overscan':
          this.#overscan = Math.max(0, Math.floor(next));
          break;
        case 'padding-start':
          this.#paddingStart = Math.max(0, next);
          break;
        case 'padding-end':
          this.#paddingEnd = Math.max(0, next);
          break;
        case 'scroll-padding-start':
          this.#scrollPaddingStart = Math.max(0, next);
          break;
        case 'scroll-padding-end':
          this.#scrollPaddingEnd = Math.max(0, next);
          break;
      }
    }

    this.#updateVirtualizerOptions();
  }

  #fallbackForAttribute(name: string): number {
    switch (name) {
      case 'estimate-size':
        return DEFAULT_ESTIMATE;
      case 'overscan':
        return DEFAULT_OVERSCAN;
      default:
        return 0;
    }
  }

  #initialize(): void {
    this.#initialized = true;

    if (!this.hasAttribute('role')) {
      this.setAttribute('role', 'list');
    }

    this.#captureChildren();
    this.#setupShadowDom();
    this.#applyInitialAttributes();
    this.#startObservingLightDom();
    this.#mountVirtualizer();
  }

  #captureChildren(): void {
    const nodes = Array.from(this.childNodes);
    const items: HTMLElement[] = [];

    for (const node of nodes) {
      if (node.nodeType === Node.ELEMENT_NODE) {
        const element = node as HTMLElement;
        items.push(element);
        if (!element.hasAttribute('role')) {
          element.setAttribute('role', 'listitem');
        }
      }
      this.removeChild(node);
    }

    this.#items = items;
  }

  #startObservingLightDom(): void {
    if (!this.#mutationObserver) {
      this.#mutationObserver = new MutationObserver((mutations) => {
        this.#handleLightDomMutations(mutations);
      });
    } else {
      this.#mutationObserver.disconnect();
    }

    this.#mutationObserver.observe(this, { childList: true });
  }

  #stopObservingLightDom(): void {
    if (this.#mutationObserver) {
      this.#mutationObserver.disconnect();
      this.#mutationObserver = null;
    }
  }

  #handleLightDomMutations(mutations: MutationRecord[]): void {
    const additions: HTMLElement[] = [];
    let changed = false;

    for (const mutation of mutations) {
      mutation.addedNodes.forEach((node) => {
        if (node.nodeType === Node.ELEMENT_NODE) {
          additions.push(node as HTMLElement);
        } else if (node.parentNode === this) {
          this.removeChild(node);
        }
      });

      mutation.removedNodes.forEach((node) => {
        if (node.nodeType === Node.ELEMENT_NODE) {
          const element = node as HTMLElement;
          const index = this.#items.indexOf(element);
          if (index !== -1) {
            this.#items.splice(index, 1);
            changed = true;
          }
        }
      });
    }

    if (additions.length > 0) {
      for (const element of additions) {
        if (!element.hasAttribute('role')) {
          element.setAttribute('role', 'listitem');
        }
        if (element.parentNode === this) {
          this.removeChild(element);
        }
        this.#items.push(element);
      }
      changed = true;
    }

    if (changed) {
      this.#updateVirtualizerOptions();
    }
  }

  #setupShadowDom(): void {
    const shadow = this.shadowRoot ?? this.attachShadow({ mode: 'open' });
    shadow.innerHTML = '';

    const style = document.createElement('style');
    style.textContent = `
      :host {
        display: block;
        position: relative;
        overflow: hidden;
        contain: content;
      }

      :host([hidden]) {
        display: none !important;
      }

      .scroll {
        overflow: auto;
        height: 100%;
        width: 100%;
        box-sizing: border-box;
        position: relative;
        will-change: scroll-position;
      }

      .sizer {
        position: relative;
        width: 100%;
        min-height: 100%;
      }

      .items {
        position: absolute;
        top: 0;
        left: 0;
        right: 0;
        will-change: transform;
      }

      :host([orientation="horizontal"]) .sizer {
        min-height: auto;
        height: 100%;
      }

      :host([orientation="horizontal"]) .items {
        height: 100%;
        display: flex;
      }
    `;

    const scroll = document.createElement('div');
    scroll.className = 'scroll';
    scroll.part = 'scroll';

    const sizer = document.createElement('div');
    sizer.className = 'sizer';
    sizer.part = 'sizer';

    const itemsContainer = document.createElement('div');
    itemsContainer.className = 'items';
    itemsContainer.part = 'items';

    sizer.appendChild(itemsContainer);
    scroll.appendChild(sizer);

    shadow.append(style, scroll);

    this.#scrollElement = scroll;
    this.#sizerElement = sizer;
    this.#itemsContainer = itemsContainer;
  }

  #applyInitialAttributes(): void {
    const orientation = this.getAttribute('orientation');
    this.#orientation = orientation === 'horizontal' ? 'horizontal' : 'vertical';
    for (const name of NUMBER_ATTRIBUTES) {
      const value = this.getAttribute(name);
      if (value != null) {
        this.attributeChangedCallback(name, null, value);
      }
    }
  }

  #mountVirtualizer(): void {
    if (!this.#scrollElement || !this.#itemsContainer) {
      return;
    }

    if (this.#virtualizer) {
      this.#virtualizer._willUpdate();
      this.#virtualizer.setOptions(this.#createOptions(() => this.#virtualizer!));
      this.#virtualizer.measure();
      this.#render();
      return;
    }

    const options = this.#createOptions(() => this.#virtualizer!);
    const virtualizer = new Virtualizer<HTMLDivElement, HTMLElement>(options);
    this.#virtualizer = virtualizer;
    virtualizer._willUpdate();
    this.#virtualizerCleanup = virtualizer._didMount();
    this.#render();
  }

  #teardownVirtualizer(): void {
    if (this.#rafId !== null && typeof cancelAnimationFrame === 'function') {
      cancelAnimationFrame(this.#rafId);
      this.#rafId = null;
    }

    if (this.#virtualizerCleanup) {
      this.#virtualizerCleanup();
      this.#virtualizerCleanup = null;
    }

    if (this.#virtualizer) {
      this.#virtualizer = null;
    }
  }

  #createOptions(instanceGetter: InstanceGetter): VirtualizerOptions<
    HTMLDivElement,
    HTMLElement
  > {
    return {
      count: this.#items.length,
      getScrollElement: () => this.#scrollElement,
      estimateSize: (index: number) => this.#getEstimatedSize(index),
      scrollToFn: elementScroll,
      observeElementRect,
      observeElementOffset,
      measureElement: (element: HTMLElement, entry?: ResizeObserverEntry) => {
        const instance = instanceGetter();
        return instance ? measureElement(element, entry, instance) : element.offsetHeight;
      },
      onChange: (instance: Virtualizer<HTMLDivElement, HTMLElement>) => {
        if (instance === this.#virtualizer) {
          this.#render();
        }
      },
      getItemKey: (index: number) => {
        const item = this.#items[index];
        return item?.id ?? index;
      },
      overscan: this.#overscan,
      horizontal: this.#orientation === 'horizontal',
      paddingStart: this.#paddingStart,
      paddingEnd: this.#paddingEnd,
      scrollPaddingStart: this.#scrollPaddingStart,
      scrollPaddingEnd: this.#scrollPaddingEnd,
    };
  }

  #getEstimatedSize(index: number): number {
    const item = this.#items[index];
    const attr = item?.getAttribute('data-estimate-size');
    if (attr) {
      const parsed = Number(attr);
      if (Number.isFinite(parsed)) {
        return parsed;
      }
    }
    return this.#estimateSize;
  }

  #updateVirtualizerOptions(): void {
    if (!this.#virtualizer) {
      return;
    }

    this.#virtualizer._willUpdate();
    this.#virtualizer.setOptions(this.#createOptions(() => this.#virtualizer!));
    this.#virtualizer.measure();
    this.#render();
  }

  #render(): void {
    if (!this.#virtualizer || !this.#itemsContainer || !this.#sizerElement) {
      return;
    }

    const virtualItems = this.#virtualizer.getVirtualItems();
    const totalSize = this.#virtualizer.getTotalSize();
    const horizontal = this.#orientation === 'horizontal';

    if (horizontal) {
      this.#sizerElement.style.width = `${totalSize}px`;
      this.#sizerElement.style.height = '100%';
    } else {
      this.#sizerElement.style.height = `${totalSize}px`;
      this.#sizerElement.style.width = '100%';
    }

    const fragment = document.createDocumentFragment();

    let firstStart = 0;
    if (virtualItems.length > 0) {
      firstStart = virtualItems[0]!.start;
    }

    for (const virtualItem of virtualItems) {
      const item = this.#items[virtualItem.index];
      if (!item) {
        continue;
      }

      item.setAttribute('aria-setsize', String(this.#items.length));
      item.setAttribute('aria-posinset', String(virtualItem.index + 1));

      fragment.appendChild(item);
    }

    this.#itemsContainer.replaceChildren(fragment);

    if (horizontal) {
      this.#itemsContainer.style.transform = `translate3d(${firstStart}px, 0, 0)`;
    } else {
      this.#itemsContainer.style.transform = `translate3d(0, ${firstStart}px, 0)`;
    }

    this.#scheduleMeasurement();
  }

  #scheduleMeasurement(): void {
    if (!this.#virtualizer || !this.#itemsContainer) {
      return;
    }

    const measure = () => {
      this.#rafId = null;
      if (!this.#virtualizer || !this.#itemsContainer) {
        return;
      }
      const children = Array.from(this.#itemsContainer.children);
      for (const child of children) {
        if (child instanceof HTMLElement) {
          this.#virtualizer.measureElement(child);
        }
      }
    };

    if (typeof requestAnimationFrame === 'function') {
      if (this.#rafId !== null) {
        cancelAnimationFrame(this.#rafId);
      }
      this.#rafId = requestAnimationFrame(measure);
    } else {
      queueMicrotask(measure);
    }
  }
}
