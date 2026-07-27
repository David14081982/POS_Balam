import { readFileSync } from 'node:fs';
import vm from 'node:vm';

let pass = 0;
let fail = 0;
const check = (name, value) => {
  console.log(`${value ? '✅' : '❌'} ${name}`);
  value ? pass++ : fail++;
};

const canvases = [];
class FileReaderStub {
  readAsDataURL(file) {
    if (file.failRead) {
      this.onerror();
      return;
    }
    this.result = file.data || 'data:image/source;base64,ok';
    this.onload();
  }
}
class ImageStub {
  constructor() {
    this.width = 800;
    this.height = 400;
  }
  set src(value) {
    if (value === 'decode-failure') this.onerror();
    else this.onload();
  }
}

const context = {
  console,
  FileReader: FileReaderStub,
  Image: ImageStub,
  document: {
    createElement(tag) {
      if (tag !== 'canvas') throw new Error(`Elemento inesperado: ${tag}`);
      const canvas = {
        width: 0,
        height: 0,
        draw: null,
        type: null,
        quality: null,
        getContext: () => ({
          drawImage(...args) { canvas.draw = args; },
        }),
        toDataURL(type, quality) {
          canvas.type = type;
          canvas.quality = quality;
          return `data:${type};base64,result`;
        },
      };
      canvases.push(canvas);
      return canvas;
    },
  },
  React: {
    useState() {},
    useEffect() {},
    useRef() {},
    createElement() {},
  },
  window: {},
};
vm.createContext(context);
vm.runInContext(readFileSync('balam/shared.jsx', 'utf8'), context);
const resize = context.window.UI.resizeImageFile;

const png = await resize({ type: 'image/png' }, { max: 200, type: 'image/png' });
check('PNG conserva proporción y limita el lado mayor', (
  png.startsWith('data:image/png')
  && canvases[0].width === 200
  && canvases[0].height === 100
  && canvases[0].quality === undefined
));

const jpeg = await resize({ type: 'image/jpeg' }, {
  max: 600,
  type: 'image/jpeg',
  quality: 0.85,
});
check('JPEG conserva tamaño y calidad de foto de producto', (
  jpeg.startsWith('data:image/jpeg')
  && canvases[1].width === 600
  && canvases[1].height === 300
  && canvases[1].quality === 0.85
));

await resize({ type: 'text/plain' }).then(
  () => check('rechaza archivos que no son imagen', false),
  error => check('rechaza archivos que no son imagen', error.message === 'invalid_image'),
);
await resize({ type: 'image/png', failRead: true }).then(
  () => check('propaga fallo de lectura', false),
  error => check('propaga fallo de lectura', error.message === 'image_read_failed'),
);
await resize({ type: 'image/png', data: 'decode-failure' }).then(
  () => check('propaga fallo de decodificación', false),
  error => check('propaga fallo de decodificación', error.message === 'image_decode_failed'),
);

console.log(`\n════════ ${pass} pasaron, ${fail} fallaron ════════`);
process.exit(fail ? 1 : 0);
