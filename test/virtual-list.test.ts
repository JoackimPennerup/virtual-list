import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import type { Mock } from 'vitest';

interface MockVirtualItem {
  index: number;
  start: number;
  size: number;
  end: number;
}

interface MockVirtualizerOptions {
  count: number;
  getScrollElement: () => HTMLDivElement | null;
  estimateSize: (index: number) => number;
  scrollToFn?: unknown;
  observeElementRect?: unknown;
  observeElementOffset?: unknown;
  measureElement?: (element: HTMLElement, entry?: ResizeObserverEntry) => number;
  onChange?: (instance: InstanceType<typeof MockVirtualizerClass>) => void;
  getItemKey?: (index: number) => unknown;
  overscan?: number;
  horizontal?: boolean;
  paddingStart?: number;
  paddingEnd?: number;
  scrollPaddingStart?: number;
  scrollPaddingEnd?: number;
}

const {
  MockVirtualizerClass,
  virtualizerInstances,
  elementScroll,
  observeElementRect,
  observeElementOffset,
} = vi.hoisted(() => {
  class MockVirtualizer {
    options: MockVirtualizerOptions;
    virtualItems: MockVirtualItem[] = [];
    totalSize = 0;
    didMountCleanupCalled = false;
    willUpdateCount = 0;
    measureCount = 0;
    measureElementCalls: HTMLElement[] = [];
    setOptionsCalls: MockVirtualizerOptions[] = [];

    constructor(options: MockVirtualizerOptions) {
      this.options = options;
      instances.push(this);
    }

    _willUpdate(): void {
      this.willUpdateCount += 1;
    }

    _didMount(): () => void {
      return () => {
        this.didMountCleanupCalled = true;
      };
    }

    setOptions(options: MockVirtualizerOptions): void {
      this.options = options;
      this.setOptionsCalls.push(options);
    }

    measure(): void {
      this.measureCount += 1;
    }

    getVirtualItems(): MockVirtualItem[] {
      return this.virtualItems;
    }

    getTotalSize(): number {
      return this.totalSize;
    }

    measureElement(element: HTMLElement): void {
      this.measureElementCalls.push(element);
    }

    setVirtualState(items: MockVirtualItem[], totalSize: number): void {
      this.virtualItems = items;
      this.totalSize = totalSize;
      this.options.onChange?.(this);
    }
  }

  const instances: InstanceType<typeof MockVirtualizer>[] = [];

  return {
    MockVirtualizerClass: MockVirtualizer,
    virtualizerInstances: instances,
    elementScroll: vi.fn(),
    observeElementRect: vi.fn(),
    observeElementOffset: vi.fn(),
  };
});

type MockVirtualizer = InstanceType<typeof MockVirtualizerClass>;

vi.mock('@tanstack/virtual-core', () => ({
  Virtualizer: MockVirtualizerClass,
  elementScroll,
  observeElementRect,
  observeElementOffset,
  measureElement: (element: HTMLElement) => element.getBoundingClientRect().height || element.offsetHeight,
}));

import { VirtualListElement } from '../src/virtual-list';

describe('VirtualListElement', () => {
  beforeAll(() => {
    if (!customElements.get('virtual-list')) {
      customElements.define('virtual-list', VirtualListElement);
    }
  });

  beforeEach(() => {
    virtualizerInstances.length = 0;
    document.body.innerHTML = '';
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const createItem = (text: string, id?: string): HTMLElement => {
    const div = document.createElement('div');
    div.textContent = text;
    if (id) {
      div.id = id;
    }
    return div;
  };

  const connect = (element: VirtualListElement): MockVirtualizer => {
    document.body.appendChild(element);
    element.connectedCallback();
    const instance = virtualizerInstances.at(-1);
    if (!instance) {
      throw new Error('Virtualizer instance was not created');
    }
    return instance;
  };

  it('captures light DOM children and renders them inside the items container', () => {
    const element = document.createElement('virtual-list') as VirtualListElement;
    element.append(createItem('a', 'first'), document.createTextNode('ignore'), createItem('b', 'second'));

    const instance = connect(element);

    expect(element.childElementCount).toBe(0);

    const itemsContainer = element.shadowRoot!.querySelector('.items') as HTMLDivElement;
    expect(itemsContainer.children.length).toBe(0);

    instance.setVirtualState(
      [
        { index: 0, start: 0, size: 24, end: 24 },
        { index: 1, start: 24, size: 24, end: 48 },
      ],
      96,
    );

    expect(itemsContainer.children).toHaveLength(2);
    expect(itemsContainer.children[0]).toBeInstanceOf(HTMLElement);
    expect(itemsContainer.children[0]!.id).toBe('first');
    expect(itemsContainer.children[1]!.id).toBe('second');
    expect(itemsContainer.children[0]!.getAttribute('aria-setsize')).toBe('2');
    expect(itemsContainer.children[0]!.getAttribute('aria-posinset')).toBe('1');
    expect(element.getAttribute('role')).toBe('list');
    expect(itemsContainer.parentElement!.style.height).toBe('96px');
    expect(itemsContainer.style.transform).toBe('translate3d(0, 0px, 0)');
  });

  it('tears down virtualizer and cancels scheduled animation frame on disconnect', () => {
    vi.useFakeTimers();
    const raf = vi.spyOn(globalThis, 'requestAnimationFrame' as keyof typeof globalThis);
    const caf = vi.spyOn(globalThis, 'cancelAnimationFrame' as keyof typeof globalThis);
    (raf as Mock<[FrameRequestCallback], number>).mockImplementation((cb) => {
      return setTimeout(() => cb(0), 16) as unknown as number;
    });

    const element = document.createElement('virtual-list') as VirtualListElement;
    element.append(createItem('one'), createItem('two'));

    const instance = connect(element);

    instance.setVirtualState(
      [
        { index: 0, start: 12, size: 24, end: 36 },
        { index: 1, start: 36, size: 24, end: 60 },
      ],
      96,
    );

    element.disconnectedCallback();

    expect(caf).toHaveBeenCalled();
    expect(instance.didMountCleanupCalled).toBe(true);
  });

  it('parses numeric attributes and falls back for invalid values', () => {
    const element = document.createElement('virtual-list') as VirtualListElement;
    element.setAttribute('overscan', '3');
    element.setAttribute('estimate-size', '64');
    element.setAttribute('padding-start', '4');
    element.setAttribute('padding-end', '8');
    element.setAttribute('scroll-padding-start', '1');
    element.setAttribute('scroll-padding-end', '2');

    const instance = connect(element);

    expect(instance.options.overscan).toBe(3);
    expect(instance.options.paddingStart).toBe(4);
    expect(instance.options.paddingEnd).toBe(8);
    expect(instance.options.scrollPaddingStart).toBe(1);
    expect(instance.options.scrollPaddingEnd).toBe(2);
    expect(instance.options.estimateSize?.(0)).toBe(64);

    element.setAttribute('overscan', '-5');
    element.setAttribute('estimate-size', 'foo');

    const latestOptions = instance.setOptionsCalls.at(-1);
    expect(latestOptions?.overscan).toBe(0);
    expect(latestOptions?.count).toBe(0);
    expect(instance.options.overscan).toBe(0);
    expect(instance.options.estimateSize?.(0)).toBe(48);
  });

  it('switches orientation and updates translation axis', () => {
    const element = document.createElement('virtual-list') as VirtualListElement;
    element.append(createItem('alpha'), createItem('beta'), createItem('gamma'));

    const instance = connect(element);

    element.setAttribute('orientation', 'horizontal');
    instance.setVirtualState(
      [
        { index: 0, start: 10, size: 30, end: 40 },
        { index: 1, start: 40, size: 30, end: 70 },
      ],
      140,
    );

    const sizer = element.shadowRoot!.querySelector('.sizer') as HTMLDivElement;
    const itemsContainer = element.shadowRoot!.querySelector('.items') as HTMLDivElement;

    expect(instance.options.horizontal).toBe(true);
    expect(sizer.style.width).toBe('140px');
    expect(itemsContainer.style.transform).toBe('translate3d(10px, 0, 0)');
  });

  it('updates aria metadata when items change via mutations', async () => {
    const element = document.createElement('virtual-list') as VirtualListElement;
    const initial = [createItem('first'), createItem('second')];
    element.append(...initial);

    const instance = connect(element);
    instance.setVirtualState(
      [
        { index: 0, start: 0, size: 24, end: 24 },
        { index: 1, start: 24, size: 24, end: 48 },
      ],
      96,
    );

    const newItem = createItem('third', 'third');
    const previousCallCount = instance.setOptionsCalls.length;
    element.appendChild(newItem);

    await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(element.childNodes.length).toBe(0);
    expect(instance.setOptionsCalls.length).toBeGreaterThan(previousCallCount);
    expect(instance.setOptionsCalls.at(-1)?.count).toBe(3);
    expect(instance.options.count).toBe(3);
    expect(newItem.getAttribute('role')).toBe('listitem');

    instance.setVirtualState(
      [
        { index: 0, start: 0, size: 24, end: 24 },
        { index: 1, start: 24, size: 24, end: 48 },
        { index: 2, start: 48, size: 24, end: 72 },
      ],
      120,
    );

    const itemsContainer = element.shadowRoot!.querySelector('.items') as HTMLDivElement;
    const lastChild = itemsContainer.lastElementChild as HTMLElement;
    expect(lastChild.getAttribute('aria-posinset')).toBe('3');
    expect(lastChild.getAttribute('aria-setsize')).toBe('3');

    const callsBeforeRemoval = instance.setOptionsCalls.length;
    element.removeChild(newItem);
    await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(instance.setOptionsCalls.length).toBeGreaterThan(callsBeforeRemoval);
    expect(instance.setOptionsCalls.at(-1)?.count).toBe(2);
    expect(instance.options.count).toBe(2);
  });

  it('ignores non-element nodes appended to the light DOM', async () => {
    const element = document.createElement('virtual-list') as VirtualListElement;
    element.append(createItem('only'));

    const instance = connect(element);
    instance.setVirtualState([{ index: 0, start: 0, size: 24, end: 24 }], 48);

    element.appendChild(document.createTextNode('text node'));
    element.appendChild(document.createComment('comment'));

    await Promise.resolve();
    await Promise.resolve();

    expect(element.childNodes.length).toBe(0);
    const latestOptions = instance.setOptionsCalls.at(-1);
    expect(latestOptions?.count).toBe(1);
  });

  it('schedules measurement using requestAnimationFrame without duplicating frames', () => {
    vi.useFakeTimers();

    const rafSpy = vi.spyOn(globalThis, 'requestAnimationFrame' as keyof typeof globalThis);
    const cafSpy = vi.spyOn(globalThis, 'cancelAnimationFrame' as keyof typeof globalThis);

    let rafId = 0;
    const callbacks: FrameRequestCallback[] = [];
    const scheduledIds: number[] = [];

    (rafSpy as Mock<[FrameRequestCallback], number>).mockImplementation((cb) => {
      callbacks.push(cb);
      rafId += 1;
      scheduledIds.push(rafId);
      return rafId;
    });

    const element = document.createElement('virtual-list') as VirtualListElement;
    element.append(createItem('one'), createItem('two'));

    const instance = connect(element);

    const initialCallbacks = callbacks.length;
    const initialCancelCount = cafSpy.mock.calls.length;

    instance.setVirtualState(
      [
        { index: 0, start: 0, size: 24, end: 24 },
        { index: 1, start: 24, size: 24, end: 48 },
      ],
      96,
    );

    expect(callbacks.length).toBe(initialCallbacks + 1);

    instance.setVirtualState(
      [
        { index: 0, start: 0, size: 24, end: 24 },
        { index: 1, start: 24, size: 24, end: 48 },
      ],
      96,
    );

    expect(cafSpy.mock.calls.length).toBeGreaterThan(initialCancelCount);
    expect(cafSpy.mock.calls.at(-1)?.[0]).toBe(scheduledIds.at(-2));
    expect(callbacks.length).toBe(initialCallbacks + 2);

    const itemsContainer = element.shadowRoot!.querySelector('.items') as HTMLDivElement;
    instance.measureElementCalls.length = 0;
    const latestCallback = callbacks.at(-1);
    latestCallback?.(0);

    expect(instance.measureElementCalls).toEqual(Array.from(itemsContainer.children));
  });
});

describe('defineVirtualList', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it('no-ops when customElements is unavailable', async () => {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'customElements');
    Object.defineProperty(globalThis, 'customElements', {
      value: undefined,
      configurable: true,
      writable: true,
    });

    vi.resetModules();
    const mod = await import('../src/index');
    expect(() => mod.defineVirtualList('virtual-list-test')).not.toThrow();

    if (descriptor) {
      Object.defineProperty(globalThis, 'customElements', descriptor);
    } else {
      delete (globalThis as Record<string, unknown>).customElements;
    }
  });

  it('registers the element only once per tag name', async () => {
    const defineSpy = vi.spyOn(customElements, 'define');
    const tagName = `virtual-list-test-${Date.now()}`;

    vi.resetModules();
    const { defineVirtualList: register } = await import('../src/index');
    register(tagName);

    expect(defineSpy).toHaveBeenCalledTimes(1);

    register(tagName);

    expect(defineSpy).toHaveBeenCalledTimes(1);
  });
});
