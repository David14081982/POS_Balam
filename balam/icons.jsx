// icons.jsx — Tabler-style line icons. Stroke hereda currentColor.
(function () {
  const S = ({ size = 18, children, ...p }) =>
    React.createElement('svg', {
      width: size, height: size, viewBox: '0 0 24 24', fill: 'none',
      stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round',
      strokeLinejoin: 'round', ...p
    }, children);
  const P = (d) => React.createElement('path', { d, key: d });
  const E = (tag, attrs) => React.createElement(tag, { ...attrs, key: JSON.stringify(attrs) });

  const Icons = {
    pos: (p) => S({ ...p, children: [P('M3 9l1-5h16l1 5'), P('M4 9v10a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1V9'), P('M9 13h6')] }),
    box: (p) => S({ ...p, children: [P('M12 3l8 4.5v9L12 21l-8-4.5v-9z'), P('M12 12l8-4.5'), P('M12 12v9'), P('M12 12L4 7.5')] }),
    users: (p) => S({ ...p, children: [E('circle', { cx: 9, cy: 7, r: 3 }), P('M3 21v-1a5 5 0 0 1 5-5h2a5 5 0 0 1 5 5v1'), P('M16 3.5a3 3 0 0 1 0 6'), P('M21 21v-1a5 5 0 0 0-3-4.5')] }),
    badge: (p) => S({ ...p, children: [E('circle', { cx: 12, cy: 9, r: 5 }), P('M9 13.5L8 21l4-2 4 2-1-7.5')] }),
    chart: (p) => S({ ...p, children: [P('M4 19V5'), P('M4 19h16'), P('M8 16v-4'), P('M12 16V9'), P('M16 16v-7')] }),
    gear: (p) => S({ ...p, children: [E('circle', { cx: 12, cy: 12, r: 3 }), P('M19.4 13a7.5 7.5 0 0 0 0-2l2-1.5-2-3.5-2.4 1a7.5 7.5 0 0 0-1.7-1l-.4-2.5h-4l-.4 2.5a7.5 7.5 0 0 0-1.7 1l-2.4-1-2 3.5 2 1.5a7.5 7.5 0 0 0 0 2l-2 1.5 2 3.5 2.4-1a7.5 7.5 0 0 0 1.7 1l.4 2.5h4l.4-2.5a7.5 7.5 0 0 0 1.7-1l2.4 1 2-3.5z')] }),
    search: (p) => S({ ...p, children: [E('circle', { cx: 11, cy: 11, r: 7 }), P('M21 21l-4-4')] }),
    barcode: (p) => S({ ...p, children: [P('M4 6v12'), P('M7 6v12'), P('M10 6v12'), P('M13 6v12'), P('M16 6v12'), P('M20 6v12')] }),
    scan: (p) => S({ ...p, children: [P('M4 7V5a1 1 0 0 1 1-1h2'), P('M17 4h2a1 1 0 0 1 1 1v2'), P('M20 17v2a1 1 0 0 1-1 1h-2'), P('M7 20H5a1 1 0 0 1-1-1v-2'), P('M4 12h16')] }),
    plus: (p) => S({ ...p, children: [P('M12 5v14'), P('M5 12h14')] }),
    minus: (p) => S({ ...p, children: [P('M5 12h14')] }),
    x: (p) => S({ ...p, children: [P('M6 6l12 12'), P('M18 6L6 18')] }),
    trash: (p) => S({ ...p, children: [P('M4 7h16'), P('M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2'), P('M6 7l1 13a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1l1-13')] }),
    check: (p) => S({ ...p, children: [P('M5 12l5 5L20 7')] }),
    chevDown: (p) => S({ ...p, children: [P('M6 9l6 6 6-6')] }),
    chevRight: (p) => S({ ...p, children: [P('M9 6l6 6-6 6')] }),
    chevLeft: (p) => S({ ...p, children: [P('M15 6l-6 6 6 6')] }),
    arrowUp: (p) => S({ ...p, children: [P('M12 19V5'), P('M6 11l6-6 6 6')] }),
    arrowUpRight: (p) => S({ ...p, children: [P('M7 17L17 7'), P('M8 7h9v9')] }),
    cash: (p) => S({ ...p, children: [E('rect', { x: 2, y: 6, width: 20, height: 12, rx: 2 }), E('circle', { cx: 12, cy: 12, r: 2.5 }), P('M6 9v6'), P('M18 9v6')] }),
    card: (p) => S({ ...p, children: [E('rect', { x: 2, y: 5, width: 20, height: 14, rx: 2 }), P('M2 10h20'), P('M6 15h4')] }),
    transfer: (p) => S({ ...p, children: [P('M4 9h13'), P('M14 6l3 3-3 3'), P('M20 15H7'), P('M10 12l-3 3 3 3')] }),
    split: (p) => S({ ...p, children: [P('M8 3H5a2 2 0 0 0-2 2v3'), P('M3 16v3a2 2 0 0 0 2 2h3'), P('M16 3h3a2 2 0 0 1 2 2v3'), P('M21 16v3a2 2 0 0 1-2 2h-3'), P('M9 12h6')] }),
    clock: (p) => S({ ...p, children: [E('circle', { cx: 12, cy: 12, r: 8 }), P('M12 8v4l3 2')] }),
    phone: (p) => S({ ...p, children: [P('M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L20 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2z')] }),
    user: (p) => S({ ...p, children: [E('circle', { cx: 12, cy: 8, r: 3.5 }), P('M5 21v-1a6 6 0 0 1 6-6h2a6 6 0 0 1 6 6v1')] }),
    tag: (p) => S({ ...p, children: [P('M3 12V5a2 2 0 0 1 2-2h7l9 9-9 9z'), E('circle', { cx: 8, cy: 8, r: 1.4 })] }),
    filter: (p) => S({ ...p, children: [P('M3 5h18l-7 8v6l-4 2v-8z')] }),
    bell: (p) => S({ ...p, children: [P('M6 9a6 6 0 0 1 12 0c0 5 2 6 2 6H4s2-1 2-6'), P('M10 20a2 2 0 0 0 4 0')] }),
    print: (p) => S({ ...p, children: [P('M7 8V4h10v4'), P('M6 18H5a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2h-1'), E('rect', { x: 7, y: 15, width: 10, height: 6, rx: 1 })] }),
    receipt: (p) => S({ ...p, children: [P('M5 3v18l2-1.2 2 1.2 2-1.2 2 1.2 2-1.2 2 1.2V3l-2 1.2L16 3l-2 1.2L12 3l-2 1.2L8 3 6 4.2z'), P('M8 8h8'), P('M8 12h8'), P('M8 16h5')] }),
    dots: (p) => S({ ...p, children: [E('circle', { cx: 5, cy: 12, r: 1.4 }), E('circle', { cx: 12, cy: 12, r: 1.4 }), E('circle', { cx: 19, cy: 12, r: 1.4 })] }),
    grid: (p) => S({ ...p, children: [E('rect', { x: 4, y: 4, width: 7, height: 7, rx: 1 }), E('rect', { x: 13, y: 4, width: 7, height: 7, rx: 1 }), E('rect', { x: 4, y: 13, width: 7, height: 7, rx: 1 }), E('rect', { x: 13, y: 13, width: 7, height: 7, rx: 1 })] }),
    list: (p) => S({ ...p, children: [P('M8 6h12'), P('M8 12h12'), P('M8 18h12'), P('M4 6h.01'), P('M4 12h.01'), P('M4 18h.01')] }),
    shirt: (p) => S({ ...p, children: [P('M8 3L4 6l2 3 2-1v10h8V8l2 1 2-3-4-3-2 2H10z')] }),
    alert: (p) => S({ ...p, children: [P('M12 3l9 16H3z'), P('M12 10v4'), P('M12 17h.01')] }),
    edit: (p) => S({ ...p, children: [P('M4 20h4l10-10-4-4L4 16z'), P('M14 6l4 4')] }),
    download: (p) => S({ ...p, children: [P('M12 4v10'), P('M8 11l4 4 4-4'), P('M5 19h14')] }),
    logout: (p) => S({ ...p, children: [P('M14 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2v-2'), P('M9 12h12'), P('M18 9l3 3-3 3')] }),
    calendar: (p) => S({ ...p, children: [E('rect', { x: 4, y: 5, width: 16, height: 16, rx: 2 }), P('M4 9h16'), P('M8 3v4'), P('M16 3v4')] }),
    star: (p) => S({ ...p, children: [P('M12 3l2.6 5.4 5.9.8-4.3 4.1 1 5.9L12 16.8 6.8 19.2l1-5.9L3.5 9.2l5.9-.8z')] }),
    truck: (p) => S({ ...p, children: [P('M3 6h11v9H3z'), P('M14 9h4l3 3v3h-7'), E('circle', { cx: 7, cy: 18, r: 1.6 }), E('circle', { cx: 17, cy: 18, r: 1.6 })] }),
    repeat: (p) => S({ ...p, children: [P('M4 9l3-3 3 3'), P('M7 6v8a3 3 0 0 0 3 3h7'), P('M20 15l-3 3-3-3'), P('M17 18v-8a3 3 0 0 0-3-3H7')] }),
    sparkle: (p) => S({ ...p, children: [P('M12 4l1.6 4.4L18 10l-4.4 1.6L12 16l-1.6-4.4L6 10l4.4-1.6z')] }),
  };

  window.Icon = function Icon({ name, ...p }) {
    const fn = Icons[name];
    return fn ? fn(p) : null;
  };
  window.Icons = Icons;
})();
