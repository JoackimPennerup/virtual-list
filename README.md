# virtual-list

A zero-dependency custom element that virtualizes long lists using [TanStack Virtual](https://tanstack.com/virtual) while keeping assistive technology happy. Drop `<virtual-list>` around large collections of children to let the component handle rendering only the visible items and automatically maintain `aria-posinset`/`aria-setsize` attributes.

## Getting started

```bash
npm install virtual-list
```

Importing the module automatically defines the `<virtual-list>` element. If you need to control the tag name, call `defineVirtualList()` manually.

```ts
import { defineVirtualList } from 'virtual-list';

defineVirtualList();
```

## Usage

```html
<virtual-list style="height: 320px;" overscan="4">
  <div class="row" data-estimate-size="56">Row 1</div>
  <div class="row" data-estimate-size="56">Row 2</div>
  <!-- ... lots of rows ... -->
</virtual-list>
```

Place any number of focusable elements inside the component. On connection, the element moves its light-DOM children into an internal pool and only renders the rows needed to fill the viewport. When rows are shown they receive up-to-date `aria-posinset` and `aria-setsize` values so assistive tech understands the total list length and the position of each visible item. Items are recycled to preserve event listeners and local state.

### Attributes

| Attribute | Type | Default | Description |
| --- | --- | --- | --- |
| `overscan` | number | `2` | Extra rows to render before and after the visible window. |
| `estimate-size` | number | `48` | Base size (in pixels) used by TanStack Virtual before items are measured. Individual items can override this by setting `data-estimate-size`. |
| `orientation` | `vertical` \| `horizontal` | `vertical` | Switches between vertical (default) and horizontal virtualization. |
| `padding-start` / `padding-end` | number | `0` | Adds virtual padding before/after the list content. |
| `scroll-padding-start` / `scroll-padding-end` | number | `0` | Passed through to the virtualizer for aligning scroll-to-index/offset calls. |

### Styling

The component exposes several [shadow parts](https://developer.mozilla.org/en-US/docs/Web/CSS/::part) for customization:

- `scroll` – the scroll container (`overflow: auto`).
- `sizer` – the element that mirrors the virtual height/width.
- `items` – the absolutely positioned wrapper that holds the currently rendered children.

Example:

```css
virtual-list::part(scroll) {
  border: 1px solid color-mix(in srgb, currentColor 20%, transparent);
}

virtual-list::part(items) > * {
  padding: 0.5rem 0.75rem;
  border-bottom: 1px solid #e0e0e0;
}
```

### Adding or removing items after mount

Appending new child elements directly to `<virtual-list>` will move them into the virtualized pool automatically. Removing an item via DOM APIs updates the virtualizer and aria metadata on the next frame.

## License

[MIT](./LICENSE)
