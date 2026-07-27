import fs from 'fs';

const data = fs.readFileSync('balam/data.jsx', 'utf8');
const store = fs.readFileSync('balam/store.jsx', 'utf8');
const settings = fs.readFileSync('balam/settings.jsx', 'utf8');
const sellers = fs.readFileSync('balam/sellers.jsx', 'utf8');

let pass = 0;
let fail = 0;
const check = (name, condition) => {
  console.log(`${condition ? '✅' : '❌'} ${name}`);
  condition ? pass++ : fail++;
};

check('DATA conserva avatar al crear usuarios', /avatar:\s*u\.avatar\s*\|\|\s*null/.test(data));
check('Configuración guarda avatar en DATA', /D\.updateUser\([^;]+avatar:\s*f\.avatar\s*\|\|\s*null/.test(settings));
check('STORE envía avatar a avatar_url', /avatar_url:\s*s\.avatar\s*\|\|\s*null/.test(store));
check('STORE recupera avatar_url como avatar', /avatar:\s*r\.avatar_url\s*\|\|\s*null/.test(store));
check('Vendedores define representación compartida de fotografía', /function SellerAvatar\(/.test(sellers));
check('Tarjeta usa SellerAvatar', /SellerCard[\s\S]*?h\(SellerAvatar,[\s\S]*?function SellerList/.test(sellers));
check('Lista usa SellerAvatar', /SellerList[\s\S]*?h\(SellerAvatar,[\s\S]*?function SellerDetail/.test(sellers));
check('Detalle usa SellerAvatar', /SellerDetail[\s\S]*?h\(SellerAvatar,[\s\S]*?function stat/.test(sellers));
check('Resumen usa SellerAvatar', /eligibleSellers\.map\(s\s*=>\s*h\(SellerAvatar/.test(sellers));
check('Fotografía conserva respaldo de iniciales', /s\.avatar[\s\S]*?s\.iniciales/.test(sellers));

const componentMatch = sellers.match(/function SellerAvatar\(\{ s, className, fallbackClassName, fallbackStyle \}\)\s*\{([\s\S]*?)\n  \}/);
const element = (type, props, ...children) => ({ type, props: props || {}, children });
const renderAvatar = componentMatch
  ? new Function('h', 'props', `const { s, className, fallbackClassName, fallbackStyle } = props;${componentMatch[1]}`)
  : () => null;
const photo = renderAvatar(element, { s: { nombre: 'Ana', iniciales: 'AA', color: '#123', avatar: 'data:image/png;base64,avatar' }, className: 'size' });
const fallback = renderAvatar(element, { s: { nombre: 'Ana', iniciales: 'AA', color: '#123', avatar: null }, className: 'size', fallbackClassName: 'fallback' });
check('Avatar con foto renderiza img y conserva la fuente', photo && photo.type === 'img' && photo.props.src === 'data:image/png;base64,avatar');
check('Avatar con foto conserva texto alternativo', photo && photo.props.alt === 'Ana');
check('Avatar sin foto renderiza iniciales y color', fallback && fallback.type === 'span' && fallback.children[0] === 'AA' && fallback.props.style.background === '#123');

console.log(`\n════════ ${pass} pasaron, ${fail} fallaron ════════`);
process.exit(fail ? 1 : 0);
