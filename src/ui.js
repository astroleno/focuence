const iconPaths = {
  mark: ['M5 19V6a2 2 0 0 1 2-2h12', 'M5 11h11', 'M11 11v8'],
  layers: ['M4 5h16v14H4z', 'M4 9h16', 'M8 5v4'],
  folder: ['M3 7h7l2-3h8v16H3z', 'M3 7v-3h6l3 3'],
  clock: ['M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18', 'M12 7v5l3 2'],
  nodes: ['M8 6l8 1', 'M6 9l3 8', 'M17 10l-5 7', 'M3 6a3 3 0 1 0 6 0 3 3 0 0 0-6 0', 'M16 7a3 3 0 1 0 6 0 3 3 0 0 0-6 0', 'M7 20a3 3 0 1 0 6 0 3 3 0 0 0-6 0'],
  settings: ['M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8', 'M9 3h6l1 3 3 1 2 5-2 5-3 1-1 3H9l-1-3-3-1-2-5 2-5 3-1z'],
  shield: ['M12 3l8 3v6c0 5-8 9-8 9s-8-4-8-9V6z', 'M8 12l3 3 5-6'],
  pause: ['M8 5v14', 'M16 5v14'],
  play: ['M7 4l13 8-13 8z'],
  arrow: ['M5 12h14', 'M14 7l5 5-5 5'],
  chevron: ['M9 5l7 7-7 7'],
  refresh: ['M20 7v5h-5', 'M4 17v-5h5', 'M5.2 7a8 8 0 0 1 13-2L20 8', 'M4 16l1.8 3a8 8 0 0 0 13-2'],
  search: ['M10 3a7 7 0 1 0 0 14 7 7 0 0 0 0-14', 'M15 15l6 6'],
  plus: ['M12 5v14', 'M5 12h14'],
  spark: ['M12 3l2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5z'],
  undo: ['M8 5L3 10l5 5', 'M3 10h11a6 6 0 0 1 0 12'],
  save: ['M4 3h14l3 3v15H3V3z', 'M7 3v6h10V3', 'M7 21v-8h10v8'],
  close: ['M6 6l12 12', 'M18 6L6 18'],
  check: ['M4 12l5 5L20 6'],
  edit: ['M4 16l12-12 4 4L8 20H4z', 'M13 7l4 4'],
  trash: ['M3 6h18', 'M9 6V3h6v3', 'M6 6l1 15h10l1-15', 'M10 10v7', 'M14 10v7'],
  page: ['M6 3h8l4 4v14H6z', 'M14 3v5h4', 'M9 12h6', 'M9 16h6'],
  download: ['M12 3v12', 'M7 10l5 5 5-5', 'M4 17v4h16v-4'],
  lock: ['M5 10h14v11H5z', 'M8 10V7a4 4 0 0 1 8 0v3', 'M12 14v3'],
  info: ['M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18', 'M12 11v6', 'M12 7h.01'],
  external: ['M14 3h7v7', 'M21 3L10 14', 'M10 5H4v15h15v-6']
};
export function el(tag, attributes = {}, ...children) {
  const element = document.createElement(tag);
  for (const [key, value] of Object.entries(attributes)) {
    if (value === undefined || value === null || (value === false && !key.startsWith('aria-'))) continue;
    if (key === 'class') element.className = value;
    else if (key === 'style' && typeof value === 'object') {
      for (const [property, setting] of Object.entries(value)) {
        if (property.startsWith('--')) element.style.setProperty(property, setting);
        else element.style[property] = setting;
      }
    }
    else if (key === 'checked' || key === 'disabled' || key === 'selected') element[key] = Boolean(value);
    else if (key === 'value') element.value = value;
    else element.setAttribute(key, value === true && !key.startsWith('aria-') && !key.startsWith('data-') ? '' : String(value));
  }
  for (const child of children.flat(Infinity)) {
    if (child === undefined || child === null || child === false) continue;
    element.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return element;
}
export function svgEl(tag, attributes = {}, ...children) {
  const node = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, String(value));
  for (const child of children.flat(Infinity)) if (child != null) node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  return node;
}
export function icon(name) {
  return svgEl('svg', {viewBox: '0 0 24 24', class: 'icon', 'aria-hidden': 'true'}, (iconPaths[name] || iconPaths.page).map((d) => svgEl('path', {d})));
}
export function duration(ms, precise = false) {
  const seconds = Math.max(0, Math.round((Number(ms) || 0) / 1000));
  if (!seconds) return '0 分钟';
  if (seconds < 60) return precise ? seconds + ' 秒' : '< 1 分钟';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return minutes + ' 分钟';
  const hours = Math.floor(minutes / 60), rest = minutes % 60;
  return hours + ' 小时' + (rest ? ' ' + rest + ' 分' : '');
}
