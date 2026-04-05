import sharp from 'sharp';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const publicDir = 'c:\\Users\\Home\\Documents\\App\\Dev\\chamaDudu_proj\\chamaDudu_Website\\apps\\web\\public';
const sourceImage = path.join(publicDir, 'images', 'logo.png');

const icons = [
  { name: 'favicon.png', size: 64 },
  { name: 'icon-192.png', size: 192 },
  { name: 'icon-512.png', size: 512 },
  { name: 'apple-touch-icon.png', size: 180 }
];

async function generate() {
  for (const icon of icons) {
    console.log(`Generating ${icon.name}...`);
    await sharp(sourceImage)
      .resize(icon.size, icon.size)
      .toFile(path.join(publicDir, icon.name));
  }
  
  // favicon.ico is a bit special, sharp doesn't do .ico directly without plugins normally
  // but we can generate a 32x32 png as fallback or just use the .png links in nuxt.config
  console.log('All icons generated successfully!');
}

generate().catch(err => {
  console.error('Error generating icons:', err);
  process.exit(1);
});
